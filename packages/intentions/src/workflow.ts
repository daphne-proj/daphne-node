import { createContextEngine } from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import { runEvaluatorOptimizer } from '@daphne/evaluator-optimizer';
import { ModelError } from '@daphne/llm';
import type {
  IntentionsInput,
  IntentionsOptions,
  IntentionsProposal,
  IntentionsResult,
  IntentionEvaluation,
} from './contracts.js';
import {
  assembleEvidence,
  captureInput,
  initialLimitations,
  retainDiff,
  retrievalLimitations,
} from './context.js';
import {
  checkIntentionCancellation,
  createIntentionConversation,
  runIntentionConversation,
} from './conversation.js';
import type { IntentionCandidate } from './conversation.js';
import { intentionsLimits } from './limits.js';
import { correctionInstructions, intentionsInstructions } from './prompts.js';
import { validateIntentions } from './proposal.js';
import { intentionsSchema } from './schema.js';
import { reviewIntentionCandidate } from './review/review.js';
import type {
  IntentionReview,
  IntentionReviewTurnNumbers,
} from './review/contracts.js';
import { createIntentionRuntime } from './runtime.js';

type IntentionFeedback =
  | { kind: 'structural'; diagnostics: string[] }
  | {
      kind: 'semantic';
      reviewTurnNumbers: IntentionReviewTurnNumbers;
      report: IntentionReview;
      evidenceIds: string[];
    };

interface IntentionAcceptance {
  proposal: IntentionsProposal;
  writerTurnNumber: number;
  reviewTurnNumbers: IntentionReviewTurnNumbers;
}

type IntentionsProgress = Omit<
  IntentionsResult,
  'status' | 'proposal' | 'response' | 'acceptedCandidate' | 'error'
>;

/*
 * Investigate one supplied comparison using the host's budget and borrowed tools.
 * The shared runner counts terminal writer proposals; tool continuations retain
 * their own turns without consuming candidate slots. Every structurally valid
 * draft receives a fresh semantic review. Failure and cancellation retain completed work
 * while returning null accepted output; the host owns cleanup and publication.
 */
export async function runIntentions(
  input: IntentionsInput,
  options: IntentionsOptions,
): Promise<IntentionsResult> {
  const { budget, maxInputTokens } = options;
  const { signal, maxCandidates, deadlineAt } = budget;

  let engine: ContextEngine | null = null;

  const progress: IntentionsProgress = {
    comparison: null,
    budget: { maxCandidates, deadlineAt },
    limits: { ...intentionsLimits, maxInputTokens },
    evidence: null,
    hunks: [],
    attempts: [],
    tools: [],
    turns: [],
    limitations: [],
    diagnostics: [],
    calls: { count: 0, generate: 0, tools: 0 },
  };

  function collected(): IntentionsProgress {
    const evidence = engine?.getEvidenceSnapshot() ?? null;

    return {
      ...progress,
      evidence,
      calls: { ...progress.calls },
      limitations: [
        ...progress.limitations,
        ...(evidence ? retrievalLimitations(evidence) : []),
      ],
    };
  }

  try {
    checkIntentionCancellation(signal);

    if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) {
      throw new ModelError(
        'The input token limit must be a positive safe integer.',
      );
    }

    const captured = captureInput(input);
    progress.comparison = {
      identity: captured.identity,
      changes: captured.changes,
      pr: captured.pr,
    };

    engine = createContextEngine(captured.identity, {
      maxContextBytes: intentionsLimits.maxContextBytes,
      maxRetainedBytes: intentionsLimits.maxRetainedBytes,
    });

    progress.limitations = initialLimitations(captured.changes);
    retainDiff(captured, engine, progress.hunks);
    checkIntentionCancellation(signal);

    if (captured.changes.length === 0) {
      return {
        ...collected(),
        status: 'complete',
        proposal: { intentions: [], warnings: [] },
        response: null,
        acceptedCandidate: null,
      };
    }

    const initial = assembleEvidence(
      engine,
      progress.hunks.flatMap((hunk) => hunk.evidenceIds),
    );
    const writer = createIntentionConversation(
      {
        role: 'writer',
        conversationId: 'writer',
        candidateNumber: 1,
        instructions: intentionsInstructions,
        schema: { name: 'intentions_proposal', schema: intentionsSchema },
        history: [
          {
            role: 'user',
            content: JSON.stringify({
              pr: captured.pr,
              identity: engine.identity,
              changes: captured.changes,
              hunks: progress.hunks,
              limitations: progress.limitations,
              context: initial.renderedContext,
            }),
          },
        ],
      },
      initial.includedEvidenceIds,
    );

    const runtime = createIntentionRuntime(options, engine, progress);
    const writerRuntime = runtime.forConversation(writer);
    const evaluations = new Map<number, IntentionEvaluation>();

    const result = await runEvaluatorOptimizer<
      IntentionCandidate,
      IntentionFeedback,
      IntentionAcceptance
    >({
      budget,
      async produce(production, { number }) {
        writer.candidateNumber = number;

        if (production.kind === 'revision') {
          const feedback = production.feedback;
          let context: string | undefined;

          if (feedback.kind === 'semantic') {
            const packet = assembleEvidence(
              runtime.engine,
              feedback.evidenceIds,
            );
            context = packet.renderedContext;
            writer.pendingDeliveries.push({
              kind: 'review_feedback',
              reviewTurnNumbers: feedback.reviewTurnNumbers,
              evidenceIds: packet.includedEvidenceIds,
            });
          }

          writer.history.push({
            role: 'user',
            content: JSON.stringify({
              instruction: correctionInstructions,
              feedback,
              context,
            }),
          });
        }

        const reply = await runIntentionConversation(writer, writerRuntime);

        return {
          writerTurnNumber: reply.turnNumber,
          deliveredEvidenceIds: reply.deliveredEvidenceIds,
        };
      },
      async evaluate(candidate, { number }) {
        const turn = progress.turns[candidate.writerTurnNumber - 1];

        if (!turn || turn.role !== 'writer') {
          throw new ModelError(
            'The intentions candidate has no recorded writer turn.',
          );
        }

        const validation = validateIntentions(turn.reply.text, {
          identity: captured.identity,
          changes: captured.changes,
          pr: captured.pr,
          sources: runtime.engine.getEvidenceSnapshot().sources,
          deliveredEvidenceIds: candidate.deliveredEvidenceIds,
        });
        turn.validation = validation;

        if (validation.status === 'invalid') {
          progress.diagnostics.push(...validation.diagnostics);
          evaluations.set(number, {
            kind: 'structural',
            status: 'revise',
            diagnostics: validation.diagnostics,
          });

          return {
            status: 'revise',
            feedback: {
              kind: 'structural',
              diagnostics: validation.diagnostics,
            },
          };
        }

        const review = await reviewIntentionCandidate(candidate, {
          runtime,
          input: captured,
          hunks: progress.hunks,
          limitations: [
            ...progress.limitations,
            ...retrievalLimitations(runtime.engine.getEvidenceSnapshot()),
          ],
        });
        const reviewTurnNumbers = review.reviewTurnNumbers;
        evaluations.set(number, {
          kind: 'semantic',
          status: review.decision.status,
          report: review.report,
          reviewTurnNumbers,
        });

        switch (review.decision.status) {
          case 'accept':
            return {
              status: 'accept',
              value: {
                proposal: validation.proposal,
                writerTurnNumber: turn.number,
                reviewTurnNumbers,
              },
            };
          case 'stop':
            return review.decision;
          case 'revise':
            return {
              status: 'revise',
              feedback: {
                kind: 'semantic',
                reviewTurnNumbers,
                report: review.report,
                /* Send source bytes the reviewer discovered, including evidence for proposal-wide omissions. */
                evidenceIds: review.deliveredEvidenceIds.filter(
                  (id) => !candidate.deliveredEvidenceIds.includes(id),
                ),
              },
            };
        }
      },
    });

    progress.attempts = result.attempts.map((attempt) => ({
      number: attempt.number,
      ...attempt.candidate,
      evaluation:
        attempt.evaluation === null
          ? null
          : (evaluations.get(attempt.number) ?? null),
    }));

    switch (result.status) {
      case 'accepted': {
        checkIntentionCancellation(signal);
        const { proposal, writerTurnNumber, reviewTurnNumbers } = result.value;
        const turn = progress.turns[writerTurnNumber - 1];

        if (!turn || turn.role !== 'writer') {
          throw new ModelError(
            'The accepted proposal has no recorded writer turn.',
          );
        }

        return {
          ...collected(),
          status: 'complete',
          proposal,
          response: turn.reply.response,
          acceptedCandidate: {
            candidateNumber: turn.candidateNumber,
            writerTurnNumber,
            reviewTurnNumbers,
          },
        };
      }
      case 'failed':
        progress.diagnostics.push('Intentions ' + result.stage + ' failed.');
        throw result.error;
      case 'cancelled':
        throw new ModelError(
          'The intentions investigation was cancelled or timed out.',
          { cause: result.cause === null ? result.reason : result.cause },
        );
      case 'stopped':
        throw new ModelError(
          'The intentions proposal stopped: ' + result.reason,
        );
      case 'exhausted':
        throw new ModelError(
          'The intentions proposal remained invalid after ' +
            String(result.attempts.length) +
            ' candidates; the configured run ceiling was reached.',
        );
    }
  } catch (error) {
    /* Keep completed replies, tool results and evidence even when no output can be accepted. */
    progress.diagnostics.push(
      error instanceof Error
        ? error.message
        : 'The intentions investigation failed.',
    );

    return {
      ...collected(),
      status: 'failed',
      proposal: null,
      response: null,
      acceptedCandidate: null,
      error,
    };
  }
}

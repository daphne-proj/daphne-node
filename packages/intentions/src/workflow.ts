import { createContextEngine } from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import { runEvaluatorOptimizer } from '@daphne/evaluator-optimizer';
import { createOpenAI, ModelError } from '@daphne/llm';
import type {
  IntentionsInput,
  IntentionsOptions,
  IntentionsProposal,
  IntentionsResult,
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
import type {
  IntentionCandidate,
  IntentionConversation,
  IntentionConversationRuntime,
} from './conversation.js';
import { intentionsLimits } from './limits.js';
import { correctionInstructions, intentionsInstructions } from './prompts.js';
import { validateIntentions } from './proposal.js';
import { intentionsSchema } from './schema.js';

type IntentionsProgress = Omit<
  IntentionsResult,
  'status' | 'proposal' | 'response' | 'error'
>;

/*
 * Investigate one supplied comparison using the host's budget and borrowed tools.
 * The shared runner counts terminal writer proposals; tool continuations retain
 * their own turns without consuming candidate slots. Structural validation is
 * the acceptance criterion here. Failure and cancellation retain completed work
 * while returning null accepted output; the host owns cleanup and publication.
 */
export async function runIntentions(
  input: IntentionsInput,
  options: IntentionsOptions,
): Promise<IntentionsResult> {
  const {
    apiKey,
    model: modelName,
    budget,
    maxInputTokens,
    executeTool,
    onModelCall,
  } = options;
  const { signal, maxCandidates, deadlineAt } = budget;
  const model = createOpenAI(apiKey, modelName, signal, onModelCall);

  let engine: ContextEngine | null = null;
  let writerConversation: IntentionConversation | null = null;

  const progress: IntentionsProgress = {
    comparison: null,
    budget: { maxCandidates, deadlineAt },
    limits: { ...intentionsLimits, maxInputTokens },
    evidence: null,
    hunks: [],
    deliveredEvidenceIds: [],
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
      deliveredEvidenceIds: [
        ...(writerConversation?.deliveredEvidenceIds ?? []),
      ],
      calls: { ...model.calls, tools: progress.calls.tools },
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
    writerConversation = writer;

    const runtime: IntentionConversationRuntime = {
      model,
      engine,
      executeTool,
      budget,
      maxInputTokens,
      progress,
    };

    const result = await runEvaluatorOptimizer<
      IntentionCandidate,
      string[],
      { proposal: IntentionsProposal; response: Record<string, unknown> }
    >({
      budget,
      async produce(production, { number }) {
        writer.candidateNumber = number;

        if (production.kind === 'revision') {
          writer.history.push({
            role: 'user',
            content: JSON.stringify({
              instruction: correctionInstructions,
              diagnostics: production.feedback,
            }),
          });
        }

        const reply = await runIntentionConversation(writer, runtime);

        return {
          writerTurnNumber: reply.turnNumber,
          deliveredEvidenceIds: reply.deliveredEvidenceIds,
        };
      },
      evaluate(candidate) {
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

        if (validation.status === 'valid') {
          return {
            status: 'accept',
            value: {
              proposal: validation.proposal,
              response: turn.reply.response,
            },
          };
        }

        progress.diagnostics.push(...validation.diagnostics);
        return { status: 'revise', feedback: validation.diagnostics };
      },
    });

    switch (result.status) {
      case 'accepted':
        checkIntentionCancellation(signal);
        return { ...collected(), status: 'complete', ...result.value };
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
      error,
    };
  }
}

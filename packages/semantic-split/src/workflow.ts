import {
  initialLimitations,
  retrievalLimitations,
} from '@daphne/context-engine';
import {
  createContextEngine,
  ContextInputError,
  retainDiff,
} from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import { runEvaluatorOptimizer } from '@daphne/evaluator-optimizer';
import { ModelError } from '@daphne/llm';
import type { ModelClient } from '@daphne/llm';
import type {
  SemanticSplitInput,
  SemanticSplitOptions,
  SemanticSplitResult,
} from './contracts.js';
import { assembleEvidence, captureSplitInput } from './context.js';
import {
  checkSplitCancellation,
  createSplitConversation,
  runSplitConversation,
} from './conversation.js';
import type { SplitCandidate } from './conversation.js';
import { createSplitRunRuntime } from './runtime.js';
import { splitLimits } from './limits.js';
import { correctionInstructions, groupingInstructions } from './prompts.js';
import { getExpectedUnitIds, validateProposal } from './proposal.js';
import type { Proposal, ProposalValidation } from './proposal.js';
import { proposalSchema } from './schema.js';

type SplitProgress = Omit<
  SemanticSplitResult,
  'status' | 'proposal' | 'response' | 'acceptedCandidate' | 'error'
>;
type InvalidProposal = Exclude<ProposalValidation, { status: 'valid' }>;

/*
 * Investigate the complete captured diff in one continuing conversation. Tools
 * borrow the host's pinned repository and shared cancellation signal. Only terminal
 * drafts consume candidates; invalid drafts receive deterministic diagnostics.
 * Keep completed work on all exits, including cancellation after a valid reply.
 */
export async function runSemanticSplit(
  value: SemanticSplitInput,
  options: SemanticSplitOptions,
): Promise<SemanticSplitResult> {
  const { budget, maxInputTokens } = options;
  const { signal, maxCandidates, deadlineAt } = budget;
  let engine: ContextEngine | null = null;
  let model: ModelClient | null = null;

  const progress: SplitProgress = {
    comparison: null,
    budget: { maxCandidates, deadlineAt },
    limits: { ...splitLimits, maxInputTokens },
    evidence: null,
    hunks: [],
    attempts: [],
    tools: [],
    turns: [],
    limitations: [],
    diagnostics: [],
    calls: { count: 0, generate: 0, tools: 0 },
  };

  function collected(): SplitProgress {
    const evidence = engine?.getEvidenceSnapshot() ?? null;

    return {
      ...progress,
      evidence,
      calls: {
        count: model?.calls.count ?? 0,
        generate: model?.calls.generate ?? 0,
        tools: progress.calls.tools,
      },
      limitations: [
        ...progress.limitations,
        ...(evidence ? retrievalLimitations(evidence) : []),
      ],
    };
  }

  try {
    checkSplitCancellation(signal);

    if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) {
      throw new ModelError(
        'The input token limit must be a positive safe integer.',
      );
    }

    const input = captureSplitInput(value);
    progress.comparison = {
      identity: input.identity,
      changes: input.changes,
      pr: input.pr,
    };
    engine = createContextEngine(input.identity, {
      maxContextBytes: splitLimits.maxContextBytes,
      maxRetainedBytes: splitLimits.maxRetainedBytes,
    });
    progress.limitations = initialLimitations(input.changes);
    const expectedUnitIds = getExpectedUnitIds(input.changes);
    retainDiff(input, engine, progress.hunks);

    /* Coverage and later lookups share this captured comparison, never the expanding tool ledger. */
    const originalUnits = new Map(
      input.hunks.map((hunk) => [
        `${hunk.change.id}:${hunk.hunkIndex === null ? 'metadata' : String(hunk.hunkIndex)}`,
        hunk,
      ]),
    );

    checkSplitCancellation(signal);

    if (expectedUnitIds.size === 0) {
      return {
        ...collected(),
        status: 'complete',
        proposal: { groups: [], warnings: [] },
        response: null,
        acceptedCandidate: null,
      };
    }

    const initial = assembleEvidence(
      engine,
      progress.hunks.flatMap((hunk) => hunk.evidenceIds),
    );
    const writer = createSplitConversation(
      {
        candidateNumber: 1,
        instructions: groupingInstructions,
        schema: { name: 'split_proposal', schema: proposalSchema },
        history: [
          {
            role: 'user',
            content: JSON.stringify({
              ...progress.comparison,
              units: progress.hunks.map((hunk) => ({
                unitId: `${hunk.changeId}:${hunk.hunkIndex === null ? 'metadata' : String(hunk.hunkIndex)}`,
                ...hunk,
              })),
              limitations: progress.limitations,
              context: initial.renderedContext,
            }),
          },
        ],
      },
      initial.includedEvidenceIds,
    );
    const runtime = createSplitRunRuntime(options, engine, progress, writer);
    model = runtime.model;
    const validations = new Map<number, ProposalValidation>();

    const result = await runEvaluatorOptimizer<
      SplitCandidate,
      InvalidProposal,
      { proposal: Proposal; writerTurnNumber: number }
    >({
      budget,
      async produce(production, { number }) {
        writer.candidateNumber = number;

        if (production.kind === 'revision') {
          writer.history.push({
            role: 'user',
            content: JSON.stringify({
              instruction: correctionInstructions,
              validation: production.feedback,
            }),
          });
        }

        const reply = await runSplitConversation(writer, runtime);

        return { writerTurnNumber: reply.turnNumber };
      },
      evaluate(candidate, { number }) {
        const turn = progress.turns[candidate.writerTurnNumber - 1];

        if (!turn) {
          throw new ModelError(
            'The split candidate has no recorded writer turn.',
          );
        }

        const validation = validateProposal(turn.reply.text, expectedUnitIds);
        validations.set(number, validation);

        if (validation.status !== 'valid') {
          progress.diagnostics.push(JSON.stringify(validation));
          return { status: 'revise', feedback: validation };
        }

        for (const group of validation.proposal.groups) {
          for (const unitId of group.unitIds) {
            if (!originalUnits.has(unitId)) {
              throw new ContextInputError(
                'An accepted unit has no original hunk in this comparison.',
              );
            }
          }
        }

        return {
          status: 'accept',
          value: {
            proposal: validation.proposal,
            writerTurnNumber: turn.number,
          },
        };
      },
    });

    progress.attempts = result.attempts.map((attempt) => ({
      number: attempt.number,
      writerTurnNumber: attempt.candidate.writerTurnNumber,
      validation: validations.get(attempt.number) ?? null,
    }));

    switch (result.status) {
      case 'accepted': {
        checkSplitCancellation(signal);
        const turn = progress.turns[result.value.writerTurnNumber - 1];

        if (!turn) {
          throw new ModelError(
            'The accepted split has no recorded writer turn.',
          );
        }

        return {
          ...collected(),
          status: 'complete',
          proposal: result.value.proposal,
          response: turn.reply.response,
          acceptedCandidate: {
            candidateNumber: turn.candidateNumber,
            writerTurnNumber: turn.number,
          },
        };
      }
      case 'failed':
        progress.diagnostics.push('Split ' + result.stage + ' failed.');
        throw result.error;
      case 'cancelled':
        throw result.cause === null ? result.reason : result.cause;
      case 'stopped':
        throw new ModelError('The split proposal stopped: ' + result.reason);
      case 'exhausted':
        throw new ModelError(
          'The split proposal remained invalid after ' +
            String(result.attempts.length) +
            ' candidates; the configured run ceiling was reached.',
        );
    }
  } catch (error) {
    progress.diagnostics.push(
      error instanceof Error
        ? error.message
        : 'The split investigation failed.',
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

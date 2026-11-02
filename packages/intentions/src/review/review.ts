import * as z from 'zod';
import { ContextLimitError } from '@daphne/context-engine';
import { ModelError } from '@daphne/llm';
import type { ContextNotice } from '@daphne/review-evidence/contracts';
import type { IntentionHunkEvidence, IntentionsInput } from '../contracts.js';
import { assembleEvidence } from '../context.js';
import {
  checkIntentionCancellation,
  createIntentionConversation,
  runIntentionConversation,
} from '../conversation.js';
import { intentionsLimits } from '../limits.js';
import type { IntentionCandidate } from '../conversation.js';
import { intentionReviewerInstructions } from './prompts.js';
import { combineIntentionReviews } from './combine.js';
import type { IntentionRuntime } from '../runtime.js';
import type {
  IntentionReviewer,
  IntentionReviewTurnNumbers,
} from './contracts.js';
import { toIntentionProposalInput } from './input.js';
import { intentionReviewers, intentionReviewerSchemas } from './schema.js';
import {
  deriveIntentionReviewDecision,
  parseIntentionReviewerReport,
} from './validation.js';

export interface IntentionReviewRuntime {
  runtime: IntentionRuntime;
  input: IntentionsInput;
  hunks: IntentionHunkEvidence[];
  limitations: ContextNotice[];
}

/*
 * Evaluate a fixed writer candidate in three isolated conversations concurrently.
 * Initial packets contain exactly the writer-delivered sources; tool results remain
 * local until confirmed in that conversation. On failure abort model siblings and
 * drain all queued tools before returning, preserving completed diagnostics.
 * Only three valid reports can reach the unchanged acceptance policy.
 */
export async function reviewIntentionCandidate(
  candidate: IntentionCandidate,
  input: IntentionReviewRuntime,
) {
  const { runtime } = input;
  const writer = runtime.progress.turns[candidate.writerTurnNumber - 1];

  if (
    !writer ||
    writer.role !== 'writer' ||
    writer.validation?.status !== 'valid'
  ) {
    throw new ModelError(
      'Semantic review requires a retained, structurally valid writer proposal.',
    );
  }

  const diffIds = new Set(input.hunks.flatMap((hunk) => hunk.evidenceIds));
  const deliveredIds = new Set(candidate.deliveredEvidenceIds);

  if (
    deliveredIds.size !== candidate.deliveredEvidenceIds.length ||
    [...diffIds].some((id) => !deliveredIds.has(id))
  ) {
    throw new ModelError(
      'Review evidence must contain every initial diff source without duplicate IDs.',
    );
  }

  const initial = assembleEvidence(runtime.engine, [...diffIds], []);
  const supplemental = assembleEvidence(
    runtime.engine,
    candidate.deliveredEvidenceIds.filter((id) => !diffIds.has(id)),
  );

  if (
    initial.byteCount + supplemental.byteCount >
    intentionsLimits.maxContextBytes
  ) {
    throw new ContextLimitError(
      'packet',
      'Combined reviewer evidence exceeds the context packet capacity.',
    );
  }

  const includedIds = new Set([
    ...initial.includedEvidenceIds,
    ...supplemental.includedEvidenceIds,
  ]);

  if (
    includedIds.size !== deliveredIds.size ||
    candidate.deliveredEvidenceIds.some((id) => !includedIds.has(id))
  ) {
    throw new ModelError(
      'Reviewer packets must contain exactly the writer-delivered evidence.',
    );
  }

  const history = [
    {
      role: 'user',
      content: JSON.stringify({
        identity: input.input.identity,
        pr: input.input.pr,
        changes: input.input.changes,
        hunks: input.hunks,
        context: initial.renderedContext,
      }),
    },
    {
      role: 'user',
      content: JSON.stringify({
        limitations: input.limitations,
        proposal: toIntentionProposalInput(writer.validation.proposal),
        context: supplemental.renderedContext,
      }),
    },
  ];
  const controller = new AbortController();
  const signal = AbortSignal.any([runtime.budget.signal, controller.signal]);
  const failures: unknown[] = [];
  const proposal = writer.validation.proposal;
  const results = await Promise.allSettled(
    intentionReviewers.map(async (reviewer) => {
      try {
        const conversation = createIntentionConversation(
          {
            role: 'reviewer',
            conversationId: `reviewer-${reviewer}-${String(writer.candidateNumber)}`,
            candidateNumber: writer.candidateNumber,
            instructions: intentionReviewerInstructions(reviewer),
            schema: {
              name: `intention_review_${reviewer}`,
              schema: z.toJSONSchema(intentionReviewerSchemas[reviewer], {
                reused: 'ref',
              }),
            },
            history: [...history],
          },
          candidate.deliveredEvidenceIds,
        );
        const reply = await runIntentionConversation(
          conversation,
          runtime.forConversation(conversation, signal),
        );
        checkIntentionCancellation(signal);
        const turn = runtime.progress.turns[reply.turnNumber - 1];

        if (!turn || turn.role !== 'reviewer') {
          throw new ModelError(
            'The semantic review has no recorded reviewer turn.',
          );
        }

        const value: unknown = JSON.parse(turn.reply.text);
        const report = parseIntentionReviewerReport(value, reviewer, {
          hunks: input.hunks,
          proposal,
          changes: input.input.changes,
          deliveredEvidenceIds: reply.deliveredEvidenceIds,
          sources: runtime.engine.getEvidenceSnapshot().sources,
        });
        turn.review = report;

        return { turn, report };
      } catch (error) {
        failures.push(error);
        controller.abort(error);
        throw error;
      }
    }),
  );

  if (failures.length > 0) {
    throw failures[0];
  }

  checkIntentionCancellation(signal);
  const reviews = results.flatMap((result) =>
    result.status === 'fulfilled' ? [result.value] : [],
  );
  const deliveredEvidenceIds = [
    ...new Set(reviews.flatMap(({ turn }) => turn.deliveredEvidenceIds)),
  ];
  const report = combineIntentionReviews(
    reviews.map((review) => review.report),
    {
      hunks: input.hunks,
      proposal,
      changes: input.input.changes,
      deliveredEvidenceIds,
      sources: runtime.engine.getEvidenceSnapshot().sources,
    },
  );

  function turnNumber(reviewer: IntentionReviewer): number {
    const review = reviews.find((entry) => entry.report.reviewer === reviewer);

    if (!review) {
      throw new ModelError(`Missing completed ${reviewer} review.`);
    }

    return review.turn.number;
  }

  const reviewTurnNumbers: IntentionReviewTurnNumbers = {
    accuracy: turnNumber('accuracy'),
    issues: turnNumber('issues'),
    completeness: turnNumber('completeness'),
  };

  return {
    report,
    reviewTurnNumbers,
    deliveredEvidenceIds,
    decision: deriveIntentionReviewDecision(report),
  };
}

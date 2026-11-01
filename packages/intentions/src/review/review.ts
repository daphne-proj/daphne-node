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
import type {
  IntentionCandidate,
  IntentionConversationRuntime,
} from '../conversation.js';
import { intentionReviewInstructions } from './prompts.js';
import { toReviewProposal } from './input.js';
import { intentionReviewSchema } from './schema.js';
import {
  deriveIntentionReviewDecision,
  parseIntentionReview,
} from './validation.js';

export interface IntentionReviewRuntime extends IntentionConversationRuntime {
  input: IntentionsInput;
  hunks: IntentionHunkEvidence[];
  limitations: ContextNotice[];
}

/*
 * Evaluate one structurally valid writer candidate in a fresh conversation using
 * the same client, evidence store and budget. Seed actual writer-delivered source
 * content, not its reasoning or prior verdicts. A malformed/failed review throws
 * without retry; the conversation has already retained completed replies/tools.
 * Keep the initial diff in a stable first message and the current candidate in
 * the next one. Both packets must fit the same context allowance together, and
 * their sources must exactly match the candidate's delivery snapshot.
 */
export async function reviewIntentionCandidate(
  candidate: IntentionCandidate,
  runtime: IntentionReviewRuntime,
) {
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

  const diffIds = new Set(runtime.hunks.flatMap((hunk) => hunk.evidenceIds));
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

  const conversation = createIntentionConversation(
    {
      role: 'reviewer',
      conversationId: `reviewer-${String(writer.candidateNumber)}`,
      candidateNumber: writer.candidateNumber,
      instructions: intentionReviewInstructions,
      schema: { name: 'intention_review', schema: intentionReviewSchema },
      history: [
        {
          role: 'user',
          content: JSON.stringify({
            identity: runtime.input.identity,
            pr: runtime.input.pr,
            changes: runtime.input.changes,
            hunks: runtime.hunks,
            context: initial.renderedContext,
          }),
        },
        {
          role: 'user',
          content: JSON.stringify({
            limitations: runtime.limitations,
            proposal: toReviewProposal(writer.validation.proposal),
            context: supplemental.renderedContext,
          }),
        },
      ],
    },
    candidate.deliveredEvidenceIds,
  );

  const reply = await runIntentionConversation(conversation, runtime);
  checkIntentionCancellation(runtime.budget.signal);
  const turn = runtime.progress.turns[reply.turnNumber - 1];

  if (!turn || turn.role !== 'reviewer') {
    throw new ModelError('The semantic review has no recorded reviewer turn.');
  }

  const value: unknown = JSON.parse(turn.reply.text);
  const report = parseIntentionReview(value, {
    hunks: runtime.hunks,
    proposal: writer.validation.proposal,
    changes: runtime.input.changes,
    deliveredEvidenceIds: reply.deliveredEvidenceIds,
  });
  turn.review = report;

  return { turn, report, decision: deriveIntentionReviewDecision(report) };
}

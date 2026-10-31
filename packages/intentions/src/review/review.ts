import { ModelError } from '@daphne/llm';
import type { ContextNotice } from '@daphne/review-evidence/contracts';
import type { IntentionHunkEvidence, IntentionsInput } from '../contracts.js';
import { assembleEvidence } from '../context.js';
import {
  checkIntentionCancellation,
  createIntentionConversation,
  runIntentionConversation,
} from '../conversation.js';
import type {
  IntentionCandidate,
  IntentionConversationRuntime,
} from '../conversation.js';
import { intentionReviewInstructions } from './prompts.js';
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

  const initial = assembleEvidence(
    runtime.engine,
    candidate.deliveredEvidenceIds,
  );
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
            limitations: runtime.limitations,
            proposal: writer.validation.proposal,
            context: initial.renderedContext,
          }),
        },
      ],
    },
    initial.includedEvidenceIds,
  );

  const reply = await runIntentionConversation(conversation, runtime);
  checkIntentionCancellation(runtime.budget.signal);
  const turn = runtime.progress.turns[reply.turnNumber - 1];

  if (!turn || turn.role !== 'reviewer') {
    throw new ModelError('The semantic review has no recorded reviewer turn.');
  }

  const value: unknown = JSON.parse(turn.reply.text);
  const report = parseIntentionReview(value, {
    proposal: writer.validation.proposal,
    changes: runtime.input.changes,
    deliveredEvidenceIds: reply.deliveredEvidenceIds,
  });
  turn.review = report;

  return { turn, report, decision: deriveIntentionReviewDecision(report) };
}

import { isDeepStrictEqual } from 'node:util';
import {
  combineIntentionReviews,
  deriveIntentionReviewDecision,
  intentionReviewers,
  parseIntentionReviewerReport,
} from '@daphne/intentions';
import type {
  IntentionReviewTurnNumbers,
  IntentionsProposal,
} from '@daphne/intentions';
import type { DeliveredIntentionTurn } from './artifact-delivery.js';
import type { IntentionArtifactContext } from './artifact-trace.js';
import * as parse from '../parse.js';

/* A batch names exactly three distinct terminal turns; saved extra roles cannot be ignored. */
export function parseReviewTurnNumbers(
  value: unknown,
): IntentionReviewTurnNumbers {
  const object = parse.object(value, 'reviewTurnNumbers');
  const numbers = {
    accuracy: parse.integer(object.accuracy, 'reviewTurnNumbers.accuracy'),
    issues: parse.integer(object.issues, 'reviewTurnNumbers.issues'),
    completeness: parse.integer(
      object.completeness,
      'reviewTurnNumbers.completeness',
    ),
  };

  if (
    Object.keys(object).length !== 3 ||
    Object.values(numbers).some((number) => number < 1) ||
    new Set(Object.values(numbers)).size !== 3
  ) {
    throw new parse.EvaluationError(
      'Expected exactly three distinct review turn references.',
    );
  }

  return numbers;
}

/* Reconstruct a candidate's interleaved review batch from raw replies and receipts.
 * Validate each role before combining sources, then recompute the host decision.
 * This prevents a valid peer receipt or forged saved aggregate from authorizing a finding. */
export function parseCandidateReviews(
  turns: readonly DeliveredIntentionTurn[],
  writer: DeliveredIntentionTurn,
  proposal: IntentionsProposal,
  numbers: IntentionReviewTurnNumbers,
  context: IntentionArtifactContext,
) {
  const last = Math.max(...Object.values(numbers));
  const batch = turns.slice(writer.number, last);

  if (
    batch.length === 0 ||
    batch.some(
      (turn) =>
        turn.role !== 'reviewer' ||
        turn.candidateNumber !== writer.candidateNumber,
    )
  ) {
    throw new parse.EvaluationError(
      'Expected this candidate’s complete reviewer batch after its writer.',
    );
  }

  const reviews = intentionReviewers.map((reviewer) => {
    const conversationId = `reviewer-${reviewer}-${String(writer.candidateNumber)}`;
    const conversation = batch.filter(
      (turn) => turn.conversationId === conversationId,
    );
    const terminal = conversation.at(-1);

    if (
      !terminal ||
      terminal.number !== numbers[reviewer] ||
      terminal.reply.functionCalls.length > 0 ||
      conversation
        .slice(0, -1)
        .some(
          (turn) =>
            turn.reply.functionCalls.length === 0 || turn.review !== null,
        )
    ) {
      throw new parse.EvaluationError(
        `Missing, extra or inconsistent ${reviewer} review turns.`,
      );
    }

    const value: unknown = JSON.parse(terminal.reply.text);
    const parsed = parseIntentionReviewerReport(value, reviewer, {
      ...context,
      proposal,
      deliveredEvidenceIds: terminal.deliveredEvidenceIds,
    });

    if (!isDeepStrictEqual(terminal.review, parsed)) {
      throw new parse.EvaluationError(
        'Saved scoped review differs from its validated raw reply.',
      );
    }

    return { terminal, parsed };
  });
  const deliveredEvidenceIds = [
    ...new Set(
      reviews.flatMap(({ terminal }) => terminal.deliveredEvidenceIds),
    ),
  ];
  const report = combineIntentionReviews(
    reviews.map(({ parsed }) => parsed),
    {
      ...context,
      proposal,
      deliveredEvidenceIds,
    },
  );

  return {
    last,
    report,
    decision: deriveIntentionReviewDecision(report),
    evidenceIds: deliveredEvidenceIds.filter(
      (id) => !writer.deliveredEvidenceIds.includes(id),
    ),
  };
}

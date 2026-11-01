import { isDeepStrictEqual } from 'node:util';
import {
  deriveIntentionReviewDecision,
  parseIntentionReview,
  validateIntentions,
} from '@daphne/intentions';
import type {
  IntentionsProposal,
  IntentionsValidationContext,
  IntentionHunkEvidence,
} from '@daphne/intentions';
import { parseDeliveredTurns } from './artifact-delivery.js';
import type { IntentionDeliveryContext } from './artifact-delivery.js';
import { parseRunBudget } from '../run-budget.js';
import * as parse from '../parse.js';

export interface IntentionArtifactContext extends IntentionDeliveryContext {
  changes: IntentionsValidationContext['changes'];
  pr: IntentionsValidationContext['pr'];
  hunks: readonly IntentionHunkEvidence[];
}

export interface ParsedIntentionTrace {
  proposal: IntentionsProposal;
  response: Record<string, unknown> | null;
  deliveredEvidenceIds: readonly string[];
}

/*
 * Resolve the accepted writer and re-run both acceptance gates from raw replies.
 * Delivery is reconstructed before validating citations; every replacement has
 * its own checks and review. Saved reports, proposals and references are claims
 * to verify, not authority. Only the current review contract is supported.
 * Invalid complete traces throw; callers reject failed host runs before this parser.
 */
export function parseIntentionTrace(
  value: unknown,
  context: IntentionArtifactContext,
): ParsedIntentionTrace {
  const investigation = parse.object(value, 'investigation');
  const budget = parseRunBudget(investigation.budget);
  const attempts = parse.array(
    investigation.attempts,
    'investigation.attempts',
  );
  const turns = parseDeliveredTurns(investigation, context);
  const calls = parse.object(investigation.calls, 'investigation.calls');

  if (
    'deliveredEvidenceIds' in investigation ||
    (budget.maxCandidates !== null && attempts.length > budget.maxCandidates) ||
    calls.count !== turns.length ||
    calls.generate !== turns.length ||
    calls.tools !==
      parse.array(investigation.tools, 'investigation.tools').length
  ) {
    throw new parse.EvaluationError(
      'The investigation has obsolete delivery state or inconsistent budget/call accounting.',
    );
  }

  if (context.changes.length === 0) {
    if (
      turns.length > 0 ||
      attempts.length > 0 ||
      investigation.acceptedCandidate !== null ||
      investigation.response !== null
    ) {
      throw new parse.EvaluationError(
        'Empty comparisons require zero calls, no attempts and no accepted candidate.',
      );
    }

    return {
      proposal: { intentions: [], warnings: [] },
      response: null,
      deliveredEvidenceIds: [],
    };
  }

  let cursor = 0;
  let accepted: ParsedIntentionTrace | null = null;
  let previousReview: { number: number; evidenceIds: string[] } | null = null;

  for (const [index, value] of attempts.entries()) {
    const attempt = parse.object(value, 'attempt');
    const number = index + 1;
    const writerNumber = parse.integer(
      attempt.writerTurnNumber,
      'attempt.writerTurnNumber',
    );
    const writer = turns[writerNumber - 1];
    const writerTurns = turns.slice(cursor, writerNumber);

    if (
      attempt.number !== number ||
      !writer ||
      writer.role !== 'writer' ||
      writer.candidateNumber !== number ||
      writer.reply.functionCalls.length > 0 ||
      writerTurns.length === 0 ||
      writerTurns.some(
        (turn) => turn.role !== 'writer' || turn.candidateNumber !== number,
      ) ||
      writerTurns
        .slice(0, -1)
        .some(
          (turn) =>
            turn.reply.functionCalls.length === 0 || turn.validation !== null,
        ) ||
      !isDeepStrictEqual(
        attempt.deliveredEvidenceIds,
        writer.deliveredEvidenceIds,
      )
    ) {
      throw new parse.EvaluationError(
        'An attempt must reference its consecutive terminal writer draft and exact delivery snapshot.',
      );
    }

    const feedback = writerTurns
      .flatMap((turn) =>
        turn.deliveries.map((value) => parse.object(value, 'delivery')),
      )
      .filter((receipt) => receipt.kind === 'review_feedback');
    const expectedFeedback =
      previousReview === null
        ? []
        : [
            {
              kind: 'review_feedback',
              reviewTurnNumber: previousReview.number,
              evidenceIds: previousReview.evidenceIds,
            },
          ];

    const lateFeedback = writerTurns
      .slice(1)
      .some((turn) =>
        turn.deliveries.some(
          (value) => parse.object(value, 'delivery').kind === 'review_feedback',
        ),
      );

    if (lateFeedback || !isDeepStrictEqual(feedback, expectedFeedback)) {
      throw new parse.EvaluationError(
        'Writer feedback receipts disagree with the previous semantic review.',
      );
    }

    const validation = validateIntentions(writer.reply.text, {
      ...context,
      deliveredEvidenceIds: writer.deliveredEvidenceIds,
    });

    if (!isDeepStrictEqual(writer.validation, validation)) {
      throw new parse.EvaluationError(
        'Saved writer validation differs from its raw proposal.',
      );
    }

    const evaluation = parse.object(attempt.evaluation, 'attempt.evaluation');
    const kind = parse.choice(
      evaluation.kind,
      ['structural', 'semantic'],
      'evaluation.kind',
    );
    const status = parse.choice(
      evaluation.status,
      ['accept', 'revise', 'stop'],
      'evaluation.status',
    );
    cursor = writerNumber;
    previousReview = null;

    if (kind === 'structural') {
      if (
        status !== 'revise' ||
        validation.status !== 'invalid' ||
        !isDeepStrictEqual(evaluation.diagnostics, validation.diagnostics)
      ) {
        throw new parse.EvaluationError(
          'Structural feedback disagrees with the writer validation.',
        );
      }
    } else {
      const reviewNumber = parse.integer(
        evaluation.reviewTurnNumber,
        'evaluation.reviewTurnNumber',
      );
      const reviewer = turns[reviewNumber - 1];
      const reviewerTurns = turns.slice(cursor, reviewNumber);

      if (
        validation.status !== 'valid' ||
        !reviewer ||
        reviewer.role !== 'reviewer' ||
        reviewer.candidateNumber !== number ||
        reviewer.reply.functionCalls.length > 0 ||
        reviewerTurns.length === 0 ||
        reviewerTurns.some(
          (turn) => turn.role !== 'reviewer' || turn.candidateNumber !== number,
        ) ||
        reviewerTurns
          .slice(0, -1)
          .some(
            (turn) =>
              turn.reply.functionCalls.length === 0 || turn.review !== null,
          )
      ) {
        throw new parse.EvaluationError(
          'Semantic evaluation requires this writer’s completed review conversation.',
        );
      }

      const rawReport: unknown = JSON.parse(reviewer.reply.text);
      const report = parseIntentionReview(rawReport, {
        proposal: validation.proposal,
        changes: context.changes,
        deliveredEvidenceIds: reviewer.deliveredEvidenceIds,
        hunks: context.hunks,
      });
      const decision = deriveIntentionReviewDecision(report);

      if (
        !isDeepStrictEqual(reviewer.review, report) ||
        decision.status !== status
      ) {
        throw new parse.EvaluationError(
          'Saved review or evaluation differs from the parsed raw review policy.',
        );
      }

      cursor = reviewNumber;
      previousReview = {
        number: reviewNumber,
        evidenceIds: reviewer.deliveredEvidenceIds.filter(
          (id) => !writer.deliveredEvidenceIds.includes(id),
        ),
      };

      if (status === 'accept') {
        if (
          !isDeepStrictEqual(investigation.acceptedCandidate, {
            candidateNumber: number,
            writerTurnNumber: writerNumber,
            reviewTurnNumber: reviewNumber,
          })
        ) {
          throw new parse.EvaluationError(
            'Accepted candidate references differ from the accepting attempt.',
          );
        }

        accepted = {
          proposal: validation.proposal,
          response: writer.reply.response,
          deliveredEvidenceIds: writer.deliveredEvidenceIds,
        };
      }
    }

    if (status !== (index === attempts.length - 1 ? 'accept' : 'revise')) {
      throw new parse.EvaluationError(
        'A complete investigation requires revisions followed by one final acceptance.',
      );
    }
  }

  if (!accepted || cursor !== turns.length) {
    throw new parse.EvaluationError(
      'A complete nonempty investigation requires an accepting final attempt with no extra turns.',
    );
  }

  return accepted;
}

import { getExpectedUnitIds, validateProposal } from '@daphne/semantic-split';
import type {
  PairRate,
  PairScore,
  SplitCase,
  SplitScoreInput,
  SplitScores,
  PreparedSplitCase,
  SplitTrial,
} from './contracts.js';
import { EvaluationError } from '../parse.js';

export const splitScorerVersion = 'split-pairs-v2';

export function scoreSplitTrial(
  caseData: PreparedSplitCase,
  trial: SplitTrial,
): SplitScores {
  if (
    trial.caseId !== caseData.definition.id ||
    trial.inputHash !== caseData.inputHash
  ) {
    throw new EvaluationError(
      'Trial identity or frozen evidence does not match the reviewed case.',
    );
  }

  const attemptTexts = trial.result.attempts.map(({ text }) => text);
  return scoreSplitResult(
    caseData.definition,
    trial.result.status === 'complete'
      ? {
          status: 'complete',
          proposalText: JSON.stringify(trial.result.proposal),
          attemptTexts,
        }
      : { status: 'failed', attemptTexts },
  );
}

function pairRate(
  pairs: PairScore[],
  relation: 'together' | 'separate',
  accepted: boolean,
): PairRate {
  const selected = pairs.filter(({ label }) => label.relation === relation);
  const total = selected.length;

  if (!accepted) {
    return { satisfied: null, total, rate: null };
  }

  const satisfied = selected.filter(({ score }) => score === 1).length;

  return { satisfied, total, rate: total === 0 ? null : satisfied / total };
}

/* Draft labels are allowed only when a caller explicitly requests provisional scoring. */
export function scoreSplitResult(
  definition: SplitCase,
  result: SplitScoreInput,
  reviewPolicy: 'reviewed' | 'allow-draft' = 'reviewed',
): SplitScores {
  if (definition.review.status !== 'reviewed' && reviewPolicy === 'reviewed') {
    throw new EvaluationError('Scoring requires a reviewed case.');
  }

  const expected = getExpectedUnitIds(definition.evidence.changes);
  const completed = result.status === 'complete';
  const validation =
    result.status === 'complete'
      ? validateProposal(result.proposalText, expected)
      : null;
  const accepted = validation?.status === 'valid';
  const membership = new Map<string, number>();

  if (validation?.status === 'valid') {
    validation.proposal.groups.forEach((group, index) => {
      for (const id of group.unitIds) {
        membership.set(id, index);
      }
    });
  }

  const pairs = definition.labels.map((label): PairScore => {
    if (!accepted) {
      return { label, actualRelation: null, score: null };
    }

    const actualRelation =
      membership.get(label.leftUnitId) === membership.get(label.rightUnitId)
        ? 'together'
        : 'separate';

    if (label.relation === 'unknown') {
      return { label, actualRelation, score: null };
    }

    return {
      label,
      actualRelation,
      score: actualRelation === label.relation ? 1 : 0,
    };
  });

  const violatedPairs = pairs
    .filter(({ score }) => score === 0)
    .map(({ label }) => label);

  const firstText = result.attemptTexts[0];
  let firstReply: SplitScores['firstReply'] = 'no_reply';

  if (firstText !== undefined) {
    firstReply =
      validateProposal(firstText, expected).status === 'valid'
        ? 'valid'
        : 'invalid';
  } else if (accepted && expected.size === 0) {
    firstReply = 'not_required';
  }

  return {
    completed,
    accepted,
    constraintsPassed:
      accepted &&
      pairs.some(({ score }) => score !== null) &&
      violatedPairs.length === 0,
    firstReply,
    recovered: firstReply === 'invalid' && accepted,
    attempts: result.attemptTexts.length,
    corrections: Math.max(0, result.attemptTexts.length - 1),
    together: pairRate(pairs, 'together', accepted),
    separate: pairRate(pairs, 'separate', accepted),
    pairs,
    violatedPairs,
    validation,
  };
}

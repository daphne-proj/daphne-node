import type { IntentionJudgePacket } from './artifact.js';
import type { IntentionGoldCase } from './gold-case.js';
import type { IntentionJudgment } from './judgment.js';
import * as parse from '../parse.js';
import {
  issueAccuracy,
  issueRelevance,
  issueConsequence,
} from './gold-issues-schema.js';

function fields(value: unknown, names: readonly string[], label: string) {
  const input = parse.object(value, label);

  if (
    Object.keys(input).length !== names.length ||
    names.some((name) => !Object.hasOwn(input, name))
  ) {
    throw new parse.EvaluationError(`${label}: unexpected or missing fields.`);
  }

  return input;
}

/* Counts accompany every rate so abstention and empty output cannot look like perfect precision. */
function rate(passed: number, rejected: number, unassessed: number) {
  const assessed = passed + rejected;
  return {
    passed,
    rejected,
    assessed,
    unassessed,
    rate: assessed === 0 ? null : passed / assessed,
  };
}

/*
 * Validate gold issue judgments against current candidate indexes and frozen label IDs.
 * For example, an identified issue needs an exact issues[index].text quote and a
 * supported, relevant, material assessment. Missing labels never invalidate novel
 * supported issues. Invalid references or contradictory judgments throw before any
 * metrics are published; this checks report integrity, not the judge's reasoning.
 */
export function parseGoldIssues(
  value: unknown,
  gold: IntentionGoldCase,
  packet: IntentionJudgePacket,
  judgment: IntentionJudgment,
) {
  const input = fields(
    value,
    ['reported', 'expected', 'controls'],
    'issueEvaluation',
  );
  const knownEvidence = new Set(
    packet.sources.map((source) => source.evidenceId),
  );
  const reported = parse
    .array(input.reported, 'reported issues')
    .map((value) => {
      const item = fields(
        value,
        [
          'cardIndex',
          'issueIndex',
          'accuracy',
          'relevance',
          'consequence',
          'explanation',
          'evidenceIds',
        ],
        'reported issue',
      );
      const cardIndex = parse.integer(item.cardIndex, 'issue.cardIndex');
      const issueIndex = parse.integer(item.issueIndex, 'issue.issueIndex');

      if (!packet.proposal.intentions[cardIndex]?.issues[issueIndex]) {
        throw new parse.EvaluationError(
          'Issue assessment must target a current observation.',
        );
      }

      const evidenceIds = parse
        .array(item.evidenceIds, 'issue.evidenceIds')
        .map((id) => parse.text(id, 'issue.evidenceId'));

      if (
        new Set(evidenceIds).size !== evidenceIds.length ||
        evidenceIds.some((id) => !knownEvidence.has(id))
      ) {
        throw new parse.EvaluationError(
          'Issue assessment has duplicate or unknown evidence IDs.',
        );
      }

      return {
        cardIndex,
        issueIndex,
        accuracy: parse.choice(item.accuracy, issueAccuracy, 'issue.accuracy'),
        relevance: parse.choice(
          item.relevance,
          issueRelevance,
          'issue.relevance',
        ),
        consequence: parse.choice(
          item.consequence,
          issueConsequence,
          'issue.consequence',
        ),
        explanation: parse.text(item.explanation, 'issue.explanation'),
        evidenceIds,
      };
    });
  const byTarget = new Map(
    reported.map((issue) => [
      `${String(issue.cardIndex)}:${String(issue.issueIndex)}`,
      issue,
    ]),
  );
  const total = packet.proposal.intentions.reduce(
    (count, card) => count + card.issues.length,
    0,
  );

  if (byTarget.size !== reported.length || reported.length !== total) {
    throw new parse.EvaluationError(
      'Assess every reported issue exactly once.',
    );
  }

  function rejected(issue: (typeof reported)[number]) {
    return (
      issue.accuracy === 'contradicted' ||
      issue.relevance === 'irrelevant' ||
      issue.consequence === 'immaterial'
    );
  }

  function onPoint(issue: (typeof reported)[number]) {
    return (
      issue.accuracy === 'supported' &&
      issue.relevance === 'relevant' &&
      issue.consequence === 'material'
    );
  }

  /* Detailed judgments must agree; usefulness defects need not be false factual claims. */
  for (const issue of reported) {
    const findings =
      judgment.cards
        .find((card) => card.index === issue.cardIndex)
        ?.findings.filter(
          (finding) =>
            finding.field === 'issue' &&
            finding.issueIndex === issue.issueIndex,
        ) ?? [];

    for (const [negative, problem] of [
      [issue.accuracy === 'contradicted', 'contradicted'],
      [issue.relevance === 'irrelevant', 'irrelevant'],
      [issue.consequence === 'immaterial', 'immaterial'],
    ] as const) {
      if (
        negative !== findings.some((finding) => finding.problem === problem)
      ) {
        throw new parse.EvaluationError(
          'Issue assessment disagrees with its targeted findings.',
        );
      }
    }

    const unresolved = findings.some(
      (finding) => finding.problem === 'insufficient_evidence',
    );

    if (onPoint(issue) && unresolved) {
      throw new parse.EvaluationError(
        'An on-point issue cannot have an unresolved finding.',
      );
    }

    if (!rejected(issue) && !onPoint(issue) && !unresolved) {
      throw new parse.EvaluationError(
        'An unassessed issue needs an insufficient-evidence finding.',
      );
    }
  }

  function labels<const T extends string>(
    value: unknown,
    known: { id: string }[],
    statuses: readonly T[],
    matchedStatus: T,
    field: string,
  ) {
    const entries = parse.array(value, field).map((value) => {
      const item = fields(
        value,
        ['id', 'status', 'explanation', 'matches'],
        field,
      );
      const id = parse.text(item.id, `${field}.id`);
      const status = parse.choice(item.status, statuses, `${field}.status`);

      if (!known.some((label) => label.id === id)) {
        throw new parse.EvaluationError(`${field}: unknown label ID.`);
      }

      const matched = parse
        .array(item.matches, `${field}.matches`)
        .map((value) => {
          const match = fields(
            value,
            ['cardIndex', 'issueIndex', 'quote'],
            'issue match',
          );
          const cardIndex = parse.integer(match.cardIndex, 'match.cardIndex');
          const issueIndex = parse.integer(
            match.issueIndex,
            'match.issueIndex',
          );
          const quote = parse.text(match.quote, 'match.quote');
          const assessment = byTarget.get(
            `${String(cardIndex)}:${String(issueIndex)}`,
          );

          if (
            !assessment ||
            !packet.proposal.intentions[cardIndex]?.issues[
              issueIndex
            ]?.text.includes(quote)
          ) {
            throw new parse.EvaluationError(
              'Issue matches must quote an existing observation exactly.',
            );
          }

          if (
            matchedStatus === 'identified'
              ? !onPoint(assessment)
              : !rejected(assessment)
          ) {
            throw new parse.EvaluationError(
              'Issue match disagrees with the observation assessment.',
            );
          }

          return { cardIndex, issueIndex, quote };
        });
      const unique = new Set(
        matched.map(
          (match) => `${String(match.cardIndex)}:${String(match.issueIndex)}`,
        ),
      );

      if (
        unique.size !== matched.length ||
        (status === matchedStatus) !== matched.length > 0
      ) {
        throw new parse.EvaluationError(
          `${field}: invalid match count or duplicate issue target.`,
        );
      }

      return {
        id,
        status,
        explanation: parse.text(item.explanation, `${field}.explanation`),
        matches: matched,
      };
    });

    if (
      entries.length !== known.length ||
      new Set(entries.map((item) => item.id)).size !== entries.length
    ) {
      throw new parse.EvaluationError(
        `${field}: assess every label exactly once.`,
      );
    }

    return entries;
  }

  const expected = labels(
    input.expected,
    gold.expectedIssues,
    ['identified', 'missing', 'unassessed'],
    'identified',
    'expected issues',
  );
  const controls = labels(
    input.controls,
    gold.falseAlarmControls,
    ['violated', 'avoided', 'unassessed'],
    'violated',
    'false-alarm controls',
  );

  function dimension(
    field: 'accuracy' | 'relevance' | 'consequence',
    positive: string,
  ) {
    const passed = reported.filter((issue) => issue[field] === positive).length;
    const unassessed = reported.filter(
      (issue) => issue[field] === 'unassessed',
    ).length;
    return rate(passed, total - passed - unassessed, unassessed);
  }

  const useful = reported.filter(onPoint).length;
  const rejectedCount = reported.filter(rejected).length;
  const identified = expected.filter(
    (issue) => issue.status === 'identified',
  ).length;
  const missing = expected.filter((issue) => issue.status === 'missing').length;
  const unknownExpected = expected.length - identified - missing;
  const violated = controls.filter(
    (control) => control.status === 'violated',
  ).length;
  const avoided = controls.filter(
    (control) => control.status === 'avoided',
  ).length;

  return {
    reported,
    expected,
    controls,
    metrics: {
      reported: {
        total,
        accuracy: dimension('accuracy', 'supported'),
        relevance: dimension('relevance', 'relevant'),
        consequence: dimension('consequence', 'material'),
        onPoint: rate(useful, rejectedCount, total - useful - rejectedCount),
      },
      expected: {
        total: expected.length,
        identified,
        missing,
        unassessed: unknownExpected,
        rate:
          expected.length === 0 || unknownExpected > 0
            ? null
            : identified / expected.length,
      },
      controls: {
        total: controls.length,
        violated,
        avoided,
        unassessed: controls.length - violated - avoided,
        falseAlarmRate:
          violated + avoided === 0 ? null : violated / (violated + avoided),
      },
    },
  };
}

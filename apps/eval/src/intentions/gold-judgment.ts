import type { IntentionJudgePacket } from './artifact.js';
import type { IntentionGoldCase } from './gold-case.js';
import { judgmentSchema, parseJudgment } from './judgment.js';
import { summarizeIntentionQuality } from './quality.js';
import { parseGoldIssues } from './gold-issues.js';
import { goldIssuesSchema } from './gold-issues-schema.js';
import * as parse from '../parse.js';

const statuses = [
  'covered',
  'partial',
  'missing',
  'contradicted',
  'unassessed',
] as const;

function record(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/* Keep ordinary matches on the assessed revision; issue narratives may explain either side. */
function sideSchema(field: 'before' | 'after') {
  return record({
    status: { type: 'string', enum: statuses },
    explanation: { type: 'string', minLength: 1 },
    matches: {
      type: 'array',
      items: {
        anyOf: [
          record({
            cardIndex: { type: 'integer', minimum: 0 },
            field: { type: 'string', enum: [field] },
            quote: { type: 'string', minLength: 1 },
          }),
          record({
            cardIndex: { type: 'integer', minimum: 0 },
            field: { type: 'string', enum: ['issue'] },
            issueIndex: { type: 'integer', minimum: 0 },
            quote: { type: 'string', minLength: 1 },
          }),
        ],
      },
    },
  });
}

/* Gold grading adds explicit before/after matches to the existing independent rubric. */
export const goldJudgmentSchema = record({
  judgment: judgmentSchema,
  issueEvaluation: goldIssuesSchema,
  behaviors: {
    type: 'array',
    items: record({
      id: { type: 'string' },
      before: sideSchema('before'),
      after: sideSchema('after'),
    }),
  },
});

function fields(value: unknown, names: string[], label: string) {
  const input = parse.object(value, label);

  if (
    Object.keys(input).length !== names.length ||
    names.some((name) => !Object.hasOwn(input, name))
  ) {
    throw new parse.EvaluationError(`${label}: unexpected or missing fields.`);
  }

  return input;
}

/*
 * Validate a model's matches before computing gold coverage. Each behavior must
 * appear exactly once, and matches quote the corresponding behavior field or
 * a current issue narrative. For example, an after assessment cannot quote before;
 * an issue quote must still explain the assessed revision's behavior semantically.
 * A quote proves location, not entailment; human calibration remains necessary.
 * Missing required coverage cannot be hidden by a clean ordinal coverage score.
 */
export function parseGoldJudgment(
  value: unknown,
  gold: IntentionGoldCase,
  packet: IntentionJudgePacket,
) {
  const input = fields(
    value,
    ['judgment', 'behaviors', 'issueEvaluation'],
    'gold judgment',
  );
  const judgment = parseJudgment(input.judgment, packet);
  const issueEvaluation = parseGoldIssues(
    input.issueEvaluation,
    gold,
    packet,
    judgment,
  );
  const known = new Map(
    gold.behaviors.map((behavior) => [behavior.id, behavior]),
  );

  function side(value: unknown, field: 'before' | 'after') {
    const input = fields(value, ['status', 'explanation', 'matches'], field);
    const status = parse.choice(input.status, statuses, `${field}.status`);
    const matches = parse
      .array(input.matches, `${field}.matches`)
      .map((value) => {
        const target = parse.choice(
          parse.object(value, 'match').field,
          ['before', 'after', 'issue'],
          'match.field',
        );
        const names = ['cardIndex', 'field', 'quote'];
        const match = fields(
          value,
          target === 'issue' ? [...names, 'issueIndex'] : names,
          'match',
        );
        const cardIndex = parse.integer(match.cardIndex, 'match.cardIndex');
        const quote = parse.text(match.quote, 'match.quote');
        const card = packet.proposal.intentions[cardIndex];

        if (target === 'issue') {
          const issueIndex = parse.integer(
            match.issueIndex,
            'match.issueIndex',
          );

          if (!card?.issues[issueIndex]?.text.includes(quote)) {
            throw new parse.EvaluationError(
              'Gold match must quote an existing issue narrative exactly.',
            );
          }

          return { cardIndex, field: target, issueIndex, quote };
        }

        if (target !== field || !card?.[target].text.includes(quote)) {
          throw new parse.EvaluationError(
            'Gold match must quote the referenced before/after field exactly.',
          );
        }

        return { cardIndex, field: target, quote };
      });

    if (
      (status === 'covered' ||
        status === 'partial' ||
        status === 'contradicted') &&
      matches.length === 0
    ) {
      throw new parse.EvaluationError(
        'Covered, partial or contradicted behaviors need matching text.',
      );
    }

    if (status === 'missing' && matches.length > 0) {
      throw new parse.EvaluationError(
        'Missing behavior cannot also have matches.',
      );
    }

    return {
      status,
      explanation: parse.text(input.explanation, `${field}.explanation`),
      matches,
    };
  }

  const behaviors = parse.array(input.behaviors, 'behaviors').map((value) => {
    const item = fields(value, ['id', 'before', 'after'], 'behavior');
    const id = parse.text(item.id, 'behavior.id');

    if (!known.has(id)) {
      throw new parse.EvaluationError('Unknown gold behavior ID.');
    }

    return {
      id,
      before: side(item.before, 'before'),
      after: side(item.after, 'after'),
    };
  });

  if (
    behaviors.length !== known.size ||
    new Set(behaviors.map((behavior) => behavior.id)).size !== known.size
  ) {
    throw new parse.EvaluationError(
      'Judge must assess every gold behavior exactly once.',
    );
  }

  const required = behaviors.filter(
    (behavior) => known.get(behavior.id)?.required,
  );
  const assessments = required.flatMap((behavior) => [
    behavior.before,
    behavior.after,
  ]);
  const hasGap =
    issueEvaluation.metrics.expected.missing > 0 ||
    assessments.some(
      (item) => item.status === 'partial' || item.status === 'missing',
    );
  const hasContradiction = behaviors.some(
    (item) =>
      item.before.status === 'contradicted' ||
      item.after.status === 'contradicted',
  );

  for (const [name, defect] of [
    ['coverage', hasGap],
    ['accuracy', hasContradiction],
    ['citations', hasContradiction],
  ] as const) {
    const score = judgment.dimensions[name]?.score;

    if (defect && (score === null || score === undefined || score === 5)) {
      throw new parse.EvaluationError(
        `${name}: gold defects require a dimension score from 1 to 4.`,
      );
    }
  }

  const quality = summarizeIntentionQuality(judgment);

  if (
    issueEvaluation.metrics.expected.unassessed > 0 ||
    assessments.some((item) => item.status === 'unassessed')
  ) {
    if (quality.coverage === 'pass') {
      quality.coverage = 'unassessed';
    }

    if (quality.priority === 'pass') {
      quality.priority = 'unassessed';
    }
  }

  if (
    quality.priority === 'pass' &&
    (issueEvaluation.metrics.reported.onPoint.unassessed > 0 ||
      issueEvaluation.metrics.controls.unassessed > 0)
  ) {
    quality.priority = 'unassessed';
  }

  const covered = required.filter(
    (item) =>
      item.before.status === 'covered' && item.after.status === 'covered',
  ).length;

  return {
    judgment,
    behaviors,
    quality,
    issueEvaluation,
    coverage: {
      required: required.length,
      covered,
      rate: required.length === 0 ? null : covered / required.length,
    },
  };
}

import type { IntentionJudgePacket } from './artifact.js';
import * as parse from '../parse.js';

const dimensionNames = [
  'accuracy',
  'citations',
  'rationale',
  'coverage',
  'coherence',
] as const;
const cardVerdicts = [
  'supported',
  'issues_found',
  'insufficient_evidence',
] as const;
const claimFields = ['title', 'before', 'after', 'why'] as const;
const problems = [
  'contradicted',
  'citation_gap',
  'insufficient_evidence',
] as const;
const textSchema = { type: 'string', minLength: 1 };
/* Codex's strict schema subset omits uniqueItems; knownIds enforces uniqueness below. */
const idsSchema = { type: 'array', items: textSchema };

function recordSchema(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/* The runner constrains syntax; parseJudgment also checks artifact IDs and completeness. */
export const judgmentSchema = recordSchema({
  dimensions: recordSchema(
    Object.fromEntries(
      dimensionNames.map((name) => [
        name,
        recordSchema({
          score: { type: ['integer', 'null'], enum: [0, 1, 2, null] },
          explanation: textSchema,
        }),
      ]),
    ),
  ),
  cards: {
    type: 'array',
    items: recordSchema({
      index: { type: 'integer', minimum: 0 },
      verdict: { type: 'string', enum: cardVerdicts },
      findings: {
        type: 'array',
        items: recordSchema({
          field: { type: 'string', enum: claimFields },
          problem: { type: 'string', enum: problems },
          explanation: textSchema,
          evidenceIds: idsSchema,
          changeIds: idsSchema,
        }),
      },
    }),
  },
  omissions: {
    type: 'array',
    items: recordSchema({ explanation: textSchema, changeIds: idsSchema }),
  },
});

function fields(value: unknown, names: readonly string[], label: string) {
  const record = parse.object(value, label);

  if (
    Object.keys(record).length !== names.length ||
    names.some((name) => !Object.hasOwn(record, name))
  ) {
    throw new parse.EvaluationError(`${label}: unexpected or missing fields.`);
  }

  return record;
}

function knownIds(value: unknown, known: Set<string>, label: string) {
  const ids = parse.array(value, label).map((id) => parse.text(id, label));

  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new parse.EvaluationError(`${label}: unknown or duplicate IDs.`);
  }

  return ids;
}

/*
 * Accept a judgment only when it covers every card and dimension.
 * For example, a missing card or invented evidence ID fails evaluation instead of
 * disappearing from the results. This validates report integrity, not judge accuracy.
 */
export function parseJudgment(value: unknown, packet: IntentionJudgePacket) {
  const input = fields(value, ['dimensions', 'cards', 'omissions'], 'judgment');
  const grades = fields(input.dimensions, dimensionNames, 'dimensions');
  const evidenceIds = new Set(
    packet.sources.map((source) => source.evidenceId),
  );
  const changeIds = new Set(packet.changes.map((change) => change.id));
  const dimensions = Object.fromEntries(
    dimensionNames.map((name) => {
      const grade = fields(grades[name], ['score', 'explanation'], name);
      const score =
        grade.score === null ? null : parse.integer(grade.score, name);

      if (score !== null && score > 2) {
        throw new parse.EvaluationError(
          `${name}: score must be 0, 1, 2 or null.`,
        );
      }

      return [
        name,
        { score, explanation: parse.text(grade.explanation, name) },
      ];
    }),
  );
  const cards = parse.array(input.cards, 'cards').map((value) => {
    const card = fields(value, ['index', 'verdict', 'findings'], 'card');
    const index = parse.integer(card.index, 'card.index');
    const verdict = parse.choice(card.verdict, cardVerdicts, 'card.verdict');
    const findings = parse.array(card.findings, 'findings').map((value) => {
      const finding = fields(
        value,
        ['field', 'problem', 'explanation', 'evidenceIds', 'changeIds'],
        'finding',
      );

      return {
        field: parse.choice(finding.field, claimFields, 'finding.field'),
        problem: parse.choice(finding.problem, problems, 'finding.problem'),
        explanation: parse.text(finding.explanation, 'finding.explanation'),
        evidenceIds: knownIds(
          finding.evidenceIds,
          evidenceIds,
          'finding.evidenceIds',
        ),
        changeIds: knownIds(finding.changeIds, changeIds, 'finding.changeIds'),
      };
    });

    if (
      index >= packet.proposal.intentions.length ||
      (verdict === 'supported') !== (findings.length === 0)
    ) {
      throw new parse.EvaluationError(
        'Card index or verdict contradicts its findings.',
      );
    }

    return { index, verdict, findings };
  });

  if (
    cards.length !== packet.proposal.intentions.length ||
    new Set(cards.map((card) => card.index)).size !== cards.length
  ) {
    throw new parse.EvaluationError(
      'Judgment must cover every card exactly once.',
    );
  }

  const omissions = parse.array(input.omissions, 'omissions').map((value) => {
    const omission = fields(value, ['explanation', 'changeIds'], 'omission');
    const affected = knownIds(
      omission.changeIds,
      changeIds,
      'omission.changeIds',
    );

    if (affected.length === 0) {
      throw new parse.EvaluationError(
        'An omission must identify an affected change.',
      );
    }

    return {
      explanation: parse.text(omission.explanation, 'omission.explanation'),
      changeIds: affected,
    };
  });

  return { dimensions, cards, omissions };
}

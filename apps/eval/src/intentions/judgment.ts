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
const claimFields = [
  'title',
  'before',
  'after',
  'intendedOutcome',
  'why',
] as const;
const problems = [
  'contradicted',
  'citation_gap',
  'insufficient_evidence',
] as const;
const issueProblems = [...problems, 'irrelevant', 'immaterial'] as const;
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

const findingProperties = {
  problem: { type: 'string', enum: problems },
  explanation: textSchema,
  evidenceIds: idsSchema,
  changeIds: idsSchema,
};

/* The runner constrains syntax; parseJudgment also checks artifact IDs and completeness. */
export const judgmentSchema = recordSchema({
  dimensions: recordSchema(
    Object.fromEntries(
      dimensionNames.map((name) => [
        name,
        recordSchema({
          score: { type: ['integer', 'null'], enum: [1, 2, 3, 4, 5, null] },
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
        items: {
          anyOf: [
            recordSchema({
              ...findingProperties,
              field: { type: 'string', enum: claimFields },
            }),
            recordSchema({
              ...findingProperties,
              field: { type: 'string', enum: ['issue'] },
              issueIndex: { type: 'integer', minimum: 0 },
              problem: { type: 'string', enum: issueProblems },
            }),
          ],
        },
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
 * disappearing from the results. Concrete defects also require a non-clean score
 * under rubric v5 (1–5); historical saved judgments are not reparsed here. Issue
 * findings target the current card's array, for example issueIndex 0; ordinary
 * fields reject that index. These checks
 * validate report integrity, not the truth of the judge's observations.
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

      if (score !== null && (score < 1 || score > 5)) {
        throw new parse.EvaluationError(
          `${name}: score must be an integer from 1 to 5 or null.`,
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
    const intention = packet.proposal.intentions[index];

    if (!intention) {
      throw new parse.EvaluationError(
        'Card index must identify a candidate intention.',
      );
    }

    const findings = parse.array(card.findings, 'findings').map((value) => {
      const field = parse.choice(
        parse.object(value, 'finding').field,
        [...claimFields, 'issue'],
        'finding.field',
      );
      const names = [
        'field',
        'problem',
        'explanation',
        'evidenceIds',
        'changeIds',
      ];
      const finding = fields(
        value,
        field === 'issue' ? [...names, 'issueIndex'] : names,
        'finding',
      );

      const details = {
        problem: parse.choice(
          finding.problem,
          issueProblems,
          'finding.problem',
        ),
        explanation: parse.text(finding.explanation, 'finding.explanation'),
        evidenceIds: knownIds(
          finding.evidenceIds,
          evidenceIds,
          'finding.evidenceIds',
        ),
        changeIds: knownIds(finding.changeIds, changeIds, 'finding.changeIds'),
      };

      if (field !== 'issue') {
        if (
          details.problem === 'irrelevant' ||
          details.problem === 'immaterial'
        ) {
          throw new parse.EvaluationError(
            'Relevance and consequence findings must target an issue.',
          );
        }

        return { ...details, field };
      }

      const issueIndex = parse.integer(
        finding.issueIndex,
        'finding.issueIndex',
      );

      if (!intention.issues[issueIndex]) {
        throw new parse.EvaluationError(
          'Finding must target an existing issue on this card.',
        );
      }

      return { ...details, field, issueIndex };
    });

    if ((verdict === 'supported') !== (findings.length === 0)) {
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

  const findings = cards.flatMap((card) => card.findings);
  const contradictedClaim = findings.some(
    (finding) => finding.problem === 'contradicted',
  );
  const unsupportedClaim = cards.some((card) =>
    card.findings.some((finding) => {
      const field = finding.field;
      const requiresCitations =
        field === 'before' ||
        field === 'after' ||
        field === 'issue' ||
        ((field === 'intendedOutcome' || field === 'why') &&
          packet.proposal.intentions[card.index]?.[field].basis !== 'unknown');

      return (
        requiresCitations &&
        (finding.problem === 'contradicted' ||
          finding.problem === 'citation_gap')
      );
    }),
  );

  for (const [name, hasDefect] of [
    ['accuracy', contradictedClaim],
    ['citations', unsupportedClaim],
    ['coverage', omissions.length > 0],
  ] as const) {
    const score = dimensions[name]?.score;

    if (hasDefect && (score === null || score === undefined || score === 5)) {
      throw new parse.EvaluationError(
        `${name}: a reported defect requires a score from 1 to 4.`,
      );
    }
  }

  return { dimensions, cards, omissions };
}

export type IntentionJudgment = ReturnType<typeof parseJudgment>;

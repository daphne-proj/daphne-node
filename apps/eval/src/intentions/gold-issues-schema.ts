export const issueAccuracy = [
  'supported',
  'contradicted',
  'unassessed',
] as const;
export const issueRelevance = ['relevant', 'irrelevant', 'unassessed'] as const;
export const issueConsequence = [
  'material',
  'immaterial',
  'unassessed',
] as const;
const text = { type: 'string', minLength: 1 };
const index = { type: 'integer', minimum: 0 };

function record(properties: Record<string, unknown>) {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

const matches = {
  type: 'array',
  items: record({ cardIndex: index, issueIndex: index, quote: text }),
};

/* Gold adds explicit assessments of every reported issue, including issues absent from its labels. */
export const goldIssuesSchema = record({
  reported: {
    type: 'array',
    items: record({
      cardIndex: index,
      issueIndex: index,
      accuracy: { type: 'string', enum: issueAccuracy },
      relevance: { type: 'string', enum: issueRelevance },
      consequence: { type: 'string', enum: issueConsequence },
      explanation: text,
      evidenceIds: { type: 'array', items: text },
    }),
  },
  expected: {
    type: 'array',
    items: record({
      id: text,
      status: { type: 'string', enum: ['identified', 'missing', 'unassessed'] },
      explanation: text,
      matches,
    }),
  },
  controls: {
    type: 'array',
    items: record({
      id: text,
      status: { type: 'string', enum: ['violated', 'avoided', 'unassessed'] },
      explanation: text,
      matches,
    }),
  },
});

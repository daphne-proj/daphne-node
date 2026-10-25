export function strictObject(properties: Record<string, object>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

const text = { type: 'string', minLength: 1 };
const citation = {
  anyOf: [
    strictObject({
      kind: { type: 'string', enum: ['code'] },
      evidenceId: text,
      range: strictObject({
        startByte: { type: 'integer', minimum: 0 },
        endByte: { type: 'integer', minimum: 0 },
      }),
    }),
    strictObject({
      kind: { type: 'string', enum: ['change'] },
      changeId: text,
    }),
  ],
};
const citations = { type: 'array', minItems: 1, items: citation };
const claim = strictObject({ text, citations });

export const intentionsSchema = strictObject({
  intentions: {
    type: 'array',
    items: strictObject({
      title: text,
      changeIds: { type: 'array', minItems: 1, items: text },
      before: claim,
      after: claim,
      why: {
        anyOf: [
          strictObject({
            basis: { type: 'string', enum: ['stated'] },
            text,
            citations: {
              type: 'array',
              minItems: 1,
              items: strictObject({
                field: { type: 'string', enum: ['title', 'body'] },
                quote: text,
              }),
            },
          }),
          strictObject({
            basis: { type: 'string', enum: ['inferred'] },
            text,
            citations,
          }),
          strictObject({ basis: { type: 'string', enum: ['unknown'] } }),
        ],
      },
    }),
  },
  warnings: { type: 'array', items: text },
});

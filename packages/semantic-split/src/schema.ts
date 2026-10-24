export const proposalSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          reason: { type: 'string' },
          unitIds: { type: 'array', items: { type: 'string' } },
        },
        required: ['title', 'reason', 'unitIds'],
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: ['groups', 'warnings'],
};

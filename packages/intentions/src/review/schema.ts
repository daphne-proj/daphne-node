import * as z from 'zod';

const text = z
  .string()
  .regex(/\S/, 'Expected nonblank text.')
  .refine(
    (value) =>
      !value.includes('\0') && Buffer.from(value).toString('utf8') === value,
    'Expected UTF-8 text without NUL characters.',
  );
const ids = z.array(text);
const criterion = z.enum([
  'accuracy',
  'citations',
  'rationale',
  'coverage',
  'coherence',
]);
const dimension = z.strictObject({
  status: z.enum(['pass', 'issues_found', 'insufficient_evidence']),
  explanation: text,
});
const remedy = z.union([
  z.strictObject({ kind: z.literal('revise'), instruction: text }),
  z.strictObject({ kind: z.literal('unresolved'), reason: text }),
]);

/*
 * One strict report shape supplies both provider JSON Schema and inferred types.
 * For example, an unsupported before claim names its criterion and a concrete
 * remedy. The contextual parser checks card coverage, source delivery and whether
 * dimension summaries agree with material findings; shape alone proves none of them.
 */
export const intentionReviewOutputSchema = z.strictObject({
  dimensions: z.strictObject({
    accuracy: dimension,
    citations: dimension,
    rationale: dimension,
    coverage: dimension,
    coherence: dimension,
  }),
  cards: z.array(
    z.strictObject({
      index: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
      findings: z.array(
        z.strictObject({
          criterion,
          field: z.enum(['title', 'changeIds', 'before', 'after', 'why']),
          severity: z.enum(['material', 'advisory']),
          explanation: text,
          evidenceIds: ids,
          changeIds: ids,
          remedy,
        }),
      ),
    }),
  ),
  omissions: z.array(
    z.strictObject({ changeIds: ids.min(1), explanation: text, remedy }),
  ),
});

export const intentionReviewSchema = z.toJSONSchema(
  intentionReviewOutputSchema,
);

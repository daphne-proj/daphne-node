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
  explanation: text,
});
const remedy = z.union([
  z.strictObject({ kind: z.literal('revise'), instruction: text }),
  z.strictObject({ kind: z.literal('unresolved'), reason: text }),
]);
const index = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const coverageBase = {
  behavior: text,
  changeIds: ids.min(1),
  evidenceIds: ids,
};
/* Distinct status literals keep the variants exclusive; z.union emits provider-supported anyOf. */
const coverageEntry = z.union([
  z.strictObject({
    ...coverageBase,
    status: z.literal('covered'),
    matches: z
      .array(
        z.strictObject({
          cardIndex: index,
          field: z.enum(['before', 'after']),
          quote: text,
        }),
      )
      .min(1),
  }),
  z.strictObject({
    ...coverageBase,
    status: z.literal('omitted'),
    omissionIndex: index,
  }),
  z.strictObject({
    ...coverageBase,
    status: z.literal('incidental'),
    explanation: text,
  }),
]);

/*
 * One strict report shape supplies both provider JSON Schema and inferred types.
 * For example, an unsupported before claim names its criterion and a concrete
 * remedy. The contextual parser checks references and coverage accounting, then
 * derives dimension statuses from blocking findings; the model supplies only
 * explanations. Shape and exact quotes alone cannot prove semantic support.
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
      index,
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
  coverage: z.array(coverageEntry),
});

export const intentionReviewSchema = z.toJSONSchema(
  intentionReviewOutputSchema,
);

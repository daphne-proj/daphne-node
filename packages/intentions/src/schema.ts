import * as z from 'zod';

/* Keep the existing tool JSON schemas independent of writer-output validation. */
export function strictObject(properties: Record<string, object>) {
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/* Keep nonblank checks local; regex constraints make provider grammars too large. Preserve text exactly. */
const text = z
  .string()
  .refine((value) => /\S/.test(value), 'Expected nonblank text.')
  .refine(
    (value) =>
      !value.includes('\0') && Buffer.from(value).toString('utf8') === value,
    'Expected UTF-8 text without NUL characters.',
  );
const offset = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
/* Literal-tagged unions generate the provider's supported anyOf form. */
const citation = z.union([
  z.strictObject({
    kind: z.literal('code'),
    evidenceId: text,
    range: z.strictObject({ startByte: offset, endByte: offset }),
  }),
  z.strictObject({ kind: z.literal('change'), changeId: text }),
]);
const citations = z.array(citation).min(1);
const claim = z.strictObject({ text, citations });
const reason = z.union([
  z.strictObject({
    basis: z.literal('stated'),
    text,
    citations: z
      .array(
        z.strictObject({
          field: z.enum(['title', 'body']),
          quote: text,
        }),
      )
      .min(1),
  }),
  z.strictObject({ basis: z.literal('inferred'), text, citations }),
  z.strictObject({ basis: z.literal('unknown') }),
]);

/*
 * Parse raw writer replies before validateIntentions resolves citation provenance.
 * For example, code citations provide an evidence ID and range, never a source;
 * strict objects reject forged source fields. Inventory and byte-boundary checks
 * remain contextual. The same definition supplies the model's request schema.
 */
export const intentionsOutputSchema = z.strictObject({
  intentions: z.array(
    z.strictObject({
      title: text,
      changeIds: z.array(text).min(1),
      before: claim,
      after: claim,
      intendedOutcome: reason,
      why: reason,
      issues: z.array(
        z.strictObject({
          text,
          relevance: z.enum(['introduced', 'worsened', 'made_relevant']),
          uncertainty: text.nullable(),
          citations,
        }),
      ),
    }),
  ),
  warnings: z.array(text),
});

export type RawIntentionsProposal = z.infer<typeof intentionsOutputSchema>;
export type RawIntentionClaim =
  RawIntentionsProposal['intentions'][number]['before'];
export type RawIntentionCitation = RawIntentionClaim['citations'][number];
export type RawIntentionReason =
  RawIntentionsProposal['intentions'][number]['why'];

/*
 * Reuse shared definitions to keep Anthropic's compiled grammar within its size
 * limit. Structural constraints stay in the schema; UTF-8 refinements run locally.
 */
export const intentionsSchema = z.toJSONSchema(intentionsOutputSchema, {
  reused: 'ref',
});

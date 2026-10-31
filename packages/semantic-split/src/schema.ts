import * as z from 'zod';

/* Use one strict shape for model requests and parsing without changing the model's text. */
export const proposalOutputSchema = z.strictObject({
  groups: z.array(
    z.strictObject({
      title: z.string().regex(/\S/, 'Expected a nonblank title.'),
      reason: z.string(),
      unitIds: z.array(z.string()).min(1),
    }),
  ),
  warnings: z.array(z.string()),
});

export type Proposal = z.infer<typeof proposalOutputSchema>;

/* Counting, generation and experiment hashing all consume this same plain JSON schema. */
export const proposalSchema = z.toJSONSchema(proposalOutputSchema);

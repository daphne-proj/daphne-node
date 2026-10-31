import type * as z from 'zod';
import type { Change } from '@daphne/review-evidence/contracts';
import type { IntentionsProposal } from '../contracts.js';
import type { intentionReviewOutputSchema } from './schema.js';

/* A parsed report records grounded defects; it is not an independent proof of their truth. */
export type IntentionReview = z.infer<typeof intentionReviewOutputSchema>;
export type IntentionReviewCriterion = keyof IntentionReview['dimensions'];

/* Use the current proposal and this reviewer's delivered IDs, never the retained-source union. */
export interface IntentionReviewContext {
  proposal: IntentionsProposal;
  changes: readonly Change[];
  deliveredEvidenceIds: readonly string[];
}

/* Only material defects block acceptance; unresolved material evidence limitations stop repair. */
export type IntentionReviewDecision =
  | { status: 'accept' }
  | { status: 'revise'; feedback: IntentionReview }
  | { status: 'stop'; reason: string };

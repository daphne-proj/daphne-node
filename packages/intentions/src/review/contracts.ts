import type * as z from 'zod';
import type { Change } from '@daphne/review-evidence/contracts';
import type {
  IntentionHunkEvidence,
  IntentionsProposal,
} from '../contracts.js';
import type { intentionReviewOutputSchema } from './schema.js';

/* The model supplies explanations and findings; only the host assigns statuses. */
export type RawIntentionReview = z.infer<typeof intentionReviewOutputSchema>;
export type IntentionCoverageEntry = RawIntentionReview['coverage'][number];
export type IntentionReviewCriterion = keyof RawIntentionReview['dimensions'];

/*
 * Parsed reports retain model findings verbatim and add policy-derived statuses.
 * For example, an advisory after/accuracy finding still derives issues_found.
 * Workflow feedback and artifact replay consume this form; it is not proof of truth.
 */
export type IntentionReview = Omit<RawIntentionReview, 'dimensions'> & {
  dimensions: {
    [
      Criterion in IntentionReviewCriterion
    ]: RawIntentionReview['dimensions'][Criterion] & {
      status: 'pass' | 'issues_found' | 'insufficient_evidence';
    };
  };
};

/* Use the current proposal and this reviewer's delivered IDs, never the retained-source union. */
export interface IntentionReviewContext {
  proposal: IntentionsProposal;
  changes: readonly Change[];
  deliveredEvidenceIds: readonly string[];
  hunks: readonly IntentionHunkEvidence[];
}

/* Factual defects and other blocking findings require repair or an unresolved stop. */
export type IntentionReviewDecision =
  | { status: 'accept' }
  | { status: 'revise'; feedback: IntentionReview }
  | { status: 'stop'; reason: string };

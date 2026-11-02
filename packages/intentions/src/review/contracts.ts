import type * as z from 'zod';
import type { RetainedSource } from '@daphne/context-engine';
import type { Change } from '@daphne/review-evidence/contracts';
import type {
  IntentionHunkEvidence,
  IntentionsProposal,
} from '../contracts.js';
import type {
  intentionReviewOutputSchema,
  intentionReviewerReportSchema,
  intentionReviewers,
} from './schema.js';

export type IntentionReviewer = (typeof intentionReviewers)[number];
/* Host-assigned role selects the model schema and inventory-accounting requirement. */
export type IntentionReviewerReport = z.infer<
  typeof intentionReviewerReportSchema
>;

/* Link every role to its terminal turn; none can be omitted from accepted output. */
export type IntentionReviewTurnNumbers = Record<IntentionReviewer, number>;

/* The model supplies explanations and findings; only the host assigns statuses. */
export type RawIntentionReview = z.infer<typeof intentionReviewOutputSchema>;
export type IntentionCoverageEntry = RawIntentionReview['coverage'][number];
/* One revision's supported fact and candidate matches, checked by validateIntentionCoverageSide. */
export type IntentionCoverageSide = Extract<
  IntentionCoverageEntry,
  { status: 'covered' }
>['before'];
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

/*
 * Validate against the current candidate and pinned retained sources. Only this
 * reviewer's delivered IDs authorize source references; retaining a peer's read
 * does not make it eligible. Runtime review and artifact replay use this context.
 */
export interface IntentionReviewContext {
  proposal: IntentionsProposal;
  changes: readonly Change[];
  deliveredEvidenceIds: readonly string[];
  hunks: readonly IntentionHunkEvidence[];
  sources: readonly RetainedSource[];
}

/* Factual defects and other blocking findings require repair or an unresolved stop. */
export type IntentionReviewDecision =
  | { status: 'accept' }
  | { status: 'revise'; feedback: IntentionReview }
  | { status: 'stop'; reason: string };

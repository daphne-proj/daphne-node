import type { DiffContextHunk, DiffContextPage } from '@daphne/context-engine';
import type { Change, ReviewIdentity } from '@daphne/review-evidence/contracts';
import type { ModelReply } from '@daphne/review-agent';
import type { Proposal, ProposalValidation } from './proposal.js';

/*
 * Keep each evidence page with its optional model analysis.
 * Example: a single-page run groups the original text directly, leaving analysis null.
 */
export interface PageAnalysis extends DiffContextPage {
  analysis: Pick<ModelReply, 'text' | 'response'> | null;
}

/*
 * Record a completed grouping reply and the result of validating it.
 * Example: attempt 1 may omit a unit ID; keep that draft even if attempt 2 fails.
 */
export interface SplitAttempt {
  number: number;
  inputTokens: number;
  text: string;
  response: Record<string, unknown>;
  validation: ProposalValidation;
}

/*
 * Supply the pinned review identity, change inventory and original hunk evidence.
 * Example: a file with two text hunks has one change entry and two hunk entries.
 */
export interface SemanticSplitInput {
  identity: ReviewIdentity;
  changes: readonly Change[];
  hunks: readonly DiffContextHunk[];
}

/*
 * Configure model access, the input-token budget, cancellation and page notifications.
 * Example: use a 4,000-token limit and onPage to report paging progress to the CLI.
 */
export interface SemanticSplitOptions {
  apiKey: string;
  model: string;
  maxInputTokens: number;
  signal: AbortSignal;
  onPage?: (page: DiffContextPage, pageNumber: number) => void;
}

/*
 * Preserve completed work on success or failure.
 * Example: if generation 2 fails, attempts still contains generation 1,
 * while proposal and response are null and error explains the failure.
 */
export type SemanticSplitResult = {
  maxCorrections: 3;
  pages: PageAnalysis[];
  attempts: SplitAttempt[];
  calls: { count: number; generate: number };
} & (
  | {
      status: 'complete';
      proposal: Proposal;
      response: Record<string, unknown> | null;
    }
  | { status: 'failed'; proposal: null; response: null; error: unknown }
);

import type { DiffContextHunk, DiffContextPage } from '@daphne/context-engine';
import type { Change, ReviewIdentity } from '@daphne/review-evidence/contracts';
import type {
  ModelReply,
  ModelCallObservation,
  ModelProvider,
} from '@daphne/llm';
import type { RunBudget, RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
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
 * Share the host's run budget across paging, analysis and grouping; input tokens limit each request.
 * Set provider to select the adapter for the supplied key and model; omission preserves OpenAI callers.
 */
export interface SemanticSplitOptions {
  provider?: ModelProvider;
  apiKey: string;
  model: string;
  maxInputTokens: number;
  budget: RunBudget;
  onModelCall?: (event: ModelCallObservation) => void;
  onPage?: (page: DiffContextPage, pageNumber: number) => void;
}

/*
 * Preserve completed work on success or failure.
 * Example: if generation 2 fails, attempts still contains generation 1,
 * while proposal and response are null and error explains the failure.
 */
export type SemanticSplitResult = {
  budget: RunBudgetSnapshot;
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

import type {
  DiffContextHunk,
  DiffHunkEvidence,
  EvidenceSnapshot,
} from '@daphne/context-engine';
import type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelProvider,
  ModelReply,
  OpenAIReasoningEffort,
} from '@daphne/llm';
import type { RunBudget, RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
import type {
  Change,
  ContextNotice,
  ReviewIdentity,
  ToolResult,
} from '@daphne/review-evidence/contracts';
import type { Proposal, ProposalValidation } from './proposal.js';

/* Supply the whole pinned diff; each original hunk or metadata entry is one assignable unit. */
export interface SemanticSplitInput {
  identity: ReviewIdentity;
  pr: { url: string; title: string; body: string | null };
  changes: readonly Change[];
  hunks: readonly DiffContextHunk[];
}

/* The host lends read-only tools bound to budget.signal and owns Git cleanup. */
export interface SemanticSplitOptions {
  provider?: ModelProvider;
  apiKey: string;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
  maxInputTokens: number;
  budget: RunBudget;
  executeTool: (request: unknown) => Promise<ToolResult>;
  onModelCall?: (event: SplitModelCallObservation) => void;
}

export type SplitModelCallObservation = ModelCallObservation & {
  role: 'writer';
  candidateNumber: number;
  conversationId: string;
};

/* Retain a completed lookup or its failure; delivered requires a later completed model reply. */
export type SplitToolRecord = {
  number: number;
  role: 'writer';
  candidateNumber: number;
  conversationId: string;
  turnNumber: number;
  call: ModelFunctionCall;
  request: Record<string, unknown> | null;
} & (
  | {
      status: 'complete';
      result: ToolResult;
      output: string;
      includedEvidenceIds: readonly string[];
      delivered: boolean;
    }
  | { status: 'failed'; result: ToolResult | null; error: unknown }
);

/* Source delivery is confirmed by a reply, never by counting or merely executing a tool. */
export type SplitEvidenceDelivery =
  | { kind: 'initial'; evidenceIds: readonly string[] }
  | { kind: 'tool'; toolNumber: number };

/* Store provider output once; attempts and tools refer to this one-based turn number. */
export interface SplitTurn {
  number: number;
  role: 'writer';
  candidateNumber: number;
  conversationId: string;
  generationNumber: number;
  instructions: string;
  deliveries: readonly SplitEvidenceDelivery[];
  deliveredEvidenceIds: readonly string[];
  inputTokens: number;
  reply: ModelReply;
}

/* A terminal draft consumes one candidate; validation is null if cancellation prevents evaluation. */
export interface SplitAttempt {
  number: number;
  writerTurnNumber: number;
  validation: ProposalValidation | null;
}

/* The accepted draft must resolve to this candidate and its recorded terminal reply. */
export interface AcceptedSplitCandidate {
  candidateNumber: number;
  writerTurnNumber: number;
}

/*
 * runSemanticSplit retains evidence, replies and tools on every exit. Consumers
 * resolve group unit IDs through comparison + hunks + evidence, never model code.
 * Failed or cancelled runs have no accepted output; empty input has no candidate.
 */
export type SemanticSplitResult = {
  comparison: Omit<SemanticSplitInput, 'hunks'> | null;
  budget: RunBudgetSnapshot;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxContextBytes: number;
    maxRetainedBytes: number;
    maxRequestBytes: number;
  };
  evidence: EvidenceSnapshot | null;
  hunks: DiffHunkEvidence[];
  attempts: SplitAttempt[];
  tools: SplitToolRecord[];
  turns: SplitTurn[];
  limitations: ContextNotice[];
  diagnostics: string[];
  calls: { count: number; generate: number; tools: number };
} & (
  | {
      status: 'complete';
      proposal: Proposal;
      response: Record<string, unknown> | null;
      acceptedCandidate: AcceptedSplitCandidate | null;
    }
  | {
      status: 'failed';
      proposal: null;
      response: null;
      acceptedCandidate: null;
      error: unknown;
    }
);

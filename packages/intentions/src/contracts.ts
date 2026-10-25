import type {
  DiffContextHunk,
  EvidenceSnapshot,
  RetainedSource,
} from '@daphne/context-engine';
import type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelReply,
} from '@daphne/llm';
import type {
  ByteRange,
  Change,
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolResult,
} from '@daphne/review-evidence/contracts';

export type IntentionCitation =
  | {
      kind: 'code';
      evidenceId: string;
      range: ByteRange;
      source: SourceEvidence;
    }
  | { kind: 'change'; changeId: string };

export interface IntentionClaim {
  text: string;
  citations: IntentionCitation[];
}

export type IntentionReason =
  | {
      basis: 'stated';
      text: string;
      citations: { field: 'title' | 'body'; quote: string }[];
    }
  | { basis: 'inferred'; text: string; citations: IntentionCitation[] }
  | { basis: 'unknown' };

export interface Intention {
  title: string;
  changeIds: string[];
  before: IntentionClaim;
  after: IntentionClaim;
  why: IntentionReason;
}

export interface IntentionsProposal {
  intentions: Intention[];
  warnings: string[];
}

export interface IntentionsInput {
  identity: ReviewIdentity;
  changes: readonly Change[];
  hunks: readonly DiffContextHunk[];
  pr: { url: string; title: string; body: string | null };
}

export interface IntentionsOptions {
  apiKey: string;
  model: string;
  signal: AbortSignal;
  maxInputTokens: number;
  executeTool: (request: unknown) => Promise<ToolResult>;
  onModelCall?: (event: ModelCallObservation) => void;
}

export interface IntentionsValidationContext {
  identity: ReviewIdentity;
  changes: readonly Change[];
  pr: IntentionsInput['pr'];
  sources: readonly RetainedSource[];
  deliveredEvidenceIds: readonly string[];
}

export type IntentionsValidation =
  | { status: 'valid'; proposal: IntentionsProposal }
  | { status: 'invalid'; diagnostics: string[] };

export interface IntentionHunkEvidence {
  changeId: string;
  hunkIndex: number | null;
  evidenceIds: string[];
}

export type IntentionToolRecord = {
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

export interface IntentionTurn {
  number: number;
  inputTokens: number;
  reply: ModelReply;
  validation: IntentionsValidation | null;
}

export type IntentionsResult = {
  comparison: Omit<IntentionsInput, 'hunks'> | null;
  limits: {
    maxInputTokens: number;
    maxOutputTokens: number;
    maxGenerations: number;
    maxToolCalls: number;
    maxCorrections: number;
    maxContextBytes: number;
    maxRetainedBytes: number;
    maxRequestBytes: number;
  };
  evidence: EvidenceSnapshot | null;
  hunks: IntentionHunkEvidence[];
  deliveredEvidenceIds: string[];
  tools: IntentionToolRecord[];
  turns: IntentionTurn[];
  limitations: ContextNotice[];
  diagnostics: string[];
  calls: { count: number; generate: number; tools: number };
} & (
  | {
      status: 'complete';
      proposal: IntentionsProposal;
      response: Record<string, unknown> | null;
    }
  | { status: 'failed'; proposal: null; response: null; error: unknown }
);

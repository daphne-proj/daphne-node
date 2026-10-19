import type {
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from '@daphne/review-evidence/contracts';

export interface RetainedSource {
  readonly evidenceId: string;
  readonly source: SourceEvidence;
}

export type RetainedEntry =
  | Exclude<ToolEntry, { readonly kind: 'source' }>
  | { readonly kind: 'source'; readonly evidenceId: string };

export interface RecordedPage {
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly completeness: ToolResult['completeness'];
  readonly fingerprint: string;
  readonly entries: readonly RetainedEntry[];
  readonly notices: readonly ContextNotice[];
}

export interface RecordedQuery {
  readonly queryId: string;
  readonly request: ToolRequest;
  readonly pages: readonly RecordedPage[];
  readonly status: 'open' | 'complete' | 'partial' | 'unavailable';
}

export interface EvidenceSnapshot {
  readonly identity: ReviewIdentity;
  readonly sources: readonly RetainedSource[];
  readonly queries: readonly RecordedQuery[];
}

export interface TokenBudget {
  readonly counterId: string;
  readonly maxTokens: number;
  readonly countTokens: (renderedContext: string) => Promise<number>;
}

export interface AssembleInput {
  readonly evidenceIds: readonly string[];
  readonly maxBytes: number;
  readonly tokens?: TokenBudget;
}

export interface ContextPacket {
  readonly format: 'daphne-context-v1';
  readonly packetId: string;
  readonly identity: ReviewIdentity;
  readonly includedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly notices: readonly ContextNotice[];
  readonly renderedContext: string;
  readonly byteCount: number;
  readonly tokenCount: number | null;
}

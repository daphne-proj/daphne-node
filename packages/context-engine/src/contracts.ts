import type {
  Change,
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from '@daphne/review-evidence/contracts';

/* Give an exact excerpt a session-local ID so selections and query history can reuse it without copying its text. */
export interface RetainedSource {
  readonly evidenceId: string;
  readonly source: SourceEvidence;
}

/* Keep navigation entries in page history, while source entries point to the ledger's retained text. */
export type RetainedEntry =
  | Exclude<ToolEntry, { readonly kind: 'source' }>
  | { readonly kind: 'source'; readonly evidenceId: string };

/* Preserve continuation and limitation details so retries and unfinished retrieval remain distinguishable. */
export interface RecordedPage {
  readonly cursor: string | null;
  readonly nextCursor: string | null;
  readonly completeness: ToolResult['completeness'];
  readonly fingerprint: string;
  readonly entries: readonly RetainedEntry[];
  readonly notices: readonly ContextNotice[];
}

/* Group pages under a request with a null cursor; open means a continuation remains unread. */
export interface RecordedQuery {
  readonly queryId: string;
  readonly request: ToolRequest;
  readonly pages: readonly RecordedPage[];
  readonly status: 'open' | 'complete' | 'partial' | 'unavailable';
}

/* Keep one consistent view of retained evidence and query progress that later ledger updates cannot alter. */
export interface EvidenceSnapshot {
  readonly identity: ReviewIdentity;
  readonly sources: readonly RetainedSource[];
  readonly queries: readonly RecordedQuery[];
}

/* Let the caller count its complete model input, including prompts and schema, without coupling this package to a tokenizer. */
export interface TokenBudget {
  readonly counterId: string;
  readonly maxTokens: number;
  readonly countTokens: (renderedContext: string) => Promise<number>;
}

/* Supply exact excerpts for each existing hunk side in BASE-then-HEAD order, or no sources and a null index for metadata-only changes. */
export interface DiffContextHunk {
  readonly change: Change;
  readonly hunkIndex: number | null;
  readonly sources: readonly SourceEvidence[];
}

/* Keep the original unit IDs on every fragment so page boundaries do not change which hunks the caller must account for. */
export interface DiffContextPage {
  readonly unitIds: readonly string[];
  readonly context: string;
  readonly inputTokens: number;
}

/* Order evidence IDs by priority because assembly admits a whole prefix and reports the remaining selected IDs as omitted. */
export interface AssembleInput {
  readonly evidenceIds: readonly string[];
  readonly maxBytes: number;
  readonly tokens?: TokenBudget;
}

/* Pair the exact rendered payload with its omissions and measurements so callers can distinguish selected evidence from included evidence. */
export interface ContextPacket {
  readonly format: 'daphne-context-v1';
  readonly packetId: string;
  readonly identity: ReviewIdentity;
  readonly includedEvidenceIds: readonly string[];
  readonly omittedEvidenceIds: readonly string[];
  readonly notices: readonly ContextNotice[];
  readonly renderedContext: string;
  /* Measure only renderedContext, including JSON escaping, rather than the outer packet object. */
  readonly byteCount: number;
  /* A missing token counter leaves the count unknown rather than estimating it from bytes. */
  readonly tokenCount: number | null;
}

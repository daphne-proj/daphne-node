import type {
  Change,
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from '@daphne/review-evidence/contracts';

/*
 * A query is one tool request, such as inspect_change for change-1; its cursor
 * pages record the returned entries. Source entries become retained evidence
 * IDs, while navigation entries remain in the page history.
 */

/* Give an exact excerpt a session-local ID so selections and query history can reuse it without copying its text. */
export interface RetainedSource {
  readonly evidenceId: string;
  readonly source: SourceEvidence;
}

/* A recorded page refers to source text by ID rather than storing it again. */
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

/* One tool request and its ordered cursor pages, with a summary of progress. */
export interface RecordedQuery {
  readonly queryId: string;
  readonly request: ToolRequest;
  readonly pages: readonly RecordedPage[];
  readonly status: 'open' | 'complete' | 'partial' | 'unavailable';
}

/* The ledger's data at one moment: identity, exact sources, and query history. */
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

/*
 * One supplied diff hunk and the exact excerpts the pager will render.
 * A modified text hunk at index 0 carries BASE then HEAD sources; a
 * metadata-only change has a null index and no sources. Keeping excerpts here
 * lets the pager split oversized text without reading the repository again.
 */
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
  /* Existing v1 packets retain this null field; model requests own token counts. */
  readonly tokenCount: number | null;
}

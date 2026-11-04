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

/* One original hunk with exact BASE-then-HEAD sources; metadata has a null index and no text. */
export interface DiffContextHunk {
  readonly change: Change;
  readonly hunkIndex: number | null;
  readonly sources: readonly SourceEvidence[];
}

/*
 * Select navigation from one retained page without changing source selection.
 * Assembly requires a known query and its original zero-based page index; for
 * example, pageIndex: 1 selects the second page even when the first is omitted.
 */
export interface QueryPageSelection {
  readonly queryId: string;
  readonly pageIndex: number;
}

/*
 * Order evidence IDs by priority because assembly admits a whole prefix and
 * reports the rest as omitted. queryPages selects navigation independently:
 * absent includes all history, [] includes none, and duplicate pairs fail.
 */
export interface AssembleInput {
  readonly evidenceIds: readonly string[];
  readonly maxBytes: number;
  readonly queryPages?: readonly QueryPageSelection[];
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

/** Evidence metadata is data only; it carries no live repository handle. */
export interface ReviewIdentity {
  readonly sessionId: string;
  readonly repositoryUrl: string;
  readonly targetCommit: string;
  readonly baseCommit: string;
  readonly headCommit: string;
}

export type Side = 'base' | 'head';

/** Zero-based, half-open offsets into the original UTF-8 bytes. */
export interface ByteRange {
  readonly startByte: number;
  readonly endByte: number;
}

export interface SourceRef {
  readonly sessionId: string;
  readonly side: Side;
  readonly commit: string;
  readonly path: string;
  readonly blobId: string;
  readonly range: ByteRange;
}

export interface SourceEvidence {
  readonly ref: SourceRef;
  readonly text: string;
}

export interface Change {
  readonly id: string;
  readonly beforePath: string | null;
  readonly afterPath: string | null;
  readonly beforeMode: string | null;
  readonly afterMode: string | null;
  readonly status:
    'added' | 'deleted' | 'modified' | 'renamed' | 'type-changed';
  readonly kind: 'text' | 'binary' | 'symlink' | 'submodule' | 'unsupported';
  readonly hunks: readonly {
    readonly beforeStartLine: number;
    readonly beforeLineCount: number;
    readonly afterStartLine: number;
    readonly afterLineCount: number;
  }[];
}

export interface ContextNotice {
  readonly code: string;
  readonly message: string;
  readonly path: string | null;
}

interface ToolPage {
  readonly cursor: string | null;
  readonly maxBytes: number;
}

/** Normalized requests; parseToolRequest supplies omitted defaults. */
export type ToolRequest = ToolPage &
  (
    | { readonly name: 'list_changes'; readonly pageSize: number }
    | { readonly name: 'inspect_change'; readonly changeId: string }
    | {
        readonly name: 'read_source';
        readonly side: Side;
        readonly path: string;
        readonly range: ByteRange;
      }
    | {
        readonly name: 'read_source_lines';
        readonly side: Side;
        readonly path: string;
        readonly startLine: number;
        readonly lineCount: number;
      }
    | {
        readonly name: 'search_code';
        readonly side: Side;
        readonly query: string;
        readonly pathPrefix: string | null;
        readonly pageSize: number;
      }
  );

export type ToolEntry =
  | { readonly kind: 'change'; readonly change: Change }
  | { readonly kind: 'source'; readonly source: SourceEvidence }
  | {
      readonly kind: 'source_window';
      readonly side: Side;
      readonly path: string;
      readonly range: ByteRange;
      readonly startLine: number;
      readonly endLine: number;
      readonly totalLines: number;
      readonly eofClamped: boolean;
    }
  | {
      readonly kind: 'search_hit';
      readonly side: Side;
      readonly path: string;
      readonly range: ByteRange;
      readonly line: number;
      readonly preview: string;
    };

export interface ToolResult {
  readonly identity: ReviewIdentity;
  readonly request: ToolRequest;
  readonly entries: readonly ToolEntry[];
  readonly completeness: 'complete' | 'partial' | 'unavailable';
  readonly nextCursor: string | null;
  readonly notices: readonly ContextNotice[];
}

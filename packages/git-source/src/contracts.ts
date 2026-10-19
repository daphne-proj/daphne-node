/**
 * Identifies the exact remote commits to compare without depending on a PR API.
 * Example: target comes from the upstream repository, while head comes from a fork.
 */
export interface RepositoryComparisonInput {
  readonly targetRepositoryUrl: string;
  readonly headRepositoryUrl: string;
  readonly targetCommit: string;
  readonly headCommit: string;
}

/**
 * Records which immutable comparison produced the results, even if branches move.
 * Example: target advanced to C, head is D, but their shared ancestor (base) is B.
 */
export interface GitSnapshotIdentity {
  readonly sessionId: string;
  readonly repositoryUrl: string;
  readonly targetCommit: string;
  readonly baseCommit: string;
  readonly headCommit: string;
}

/**
 * Locates an edit on both sides; starts follow Git line numbering, counts give its size.
 * Example: beforeStartLine 5 with count 0 anchors an insertion after old line 5.
 */
export interface GitChangeHunk {
  readonly beforeStartLine: number;
  readonly beforeLineCount: number;
  readonly afterStartLine: number;
  readonly afterLineCount: number;
}

/**
 * Describes a file operation even when it has no readable text or changed lines.
 * Example: a pure rename has different before/after paths and an empty hunks array.
 */
export interface GitChange {
  readonly id: string;
  readonly beforePath: string | null;
  readonly afterPath: string | null;
  readonly beforeMode: string | null;
  readonly afterMode: string | null;
  readonly status:
    'added' | 'deleted' | 'modified' | 'renamed' | 'type-changed';
  readonly kind: 'text' | 'binary' | 'symlink' | 'submodule' | 'unsupported';
  readonly hunks: readonly GitChangeHunk[];
}

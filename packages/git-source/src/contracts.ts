export interface RepositoryComparisonInput {
  readonly targetRepositoryUrl: string;
  readonly headRepositoryUrl: string;
  readonly targetCommit: string;
  readonly headCommit: string;
}

export interface LocalComparisonInput {
  readonly repositoryPath: string;
  readonly targetCommit: string;
  readonly headCommit: string;
}

export interface GitSnapshotIdentity {
  readonly sessionId: string;
  readonly repositoryUrl: string;
  readonly targetCommit: string;
  readonly baseCommit: string;
  readonly headCommit: string;
}

export interface GitChangeHunk {
  readonly beforeStartLine: number;
  readonly beforeLineCount: number;
  readonly afterStartLine: number;
  readonly afterLineCount: number;
}

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

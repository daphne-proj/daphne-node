export {
  GitInputError,
  GitBlobUnavailableError,
  GitOperationError,
  defaultGitLimits,
  resolveGitLimits,
} from './limits.js';

export type { GitLimits, GitOperationOptions } from './limits.js';

export type {
  RepositoryComparisonInput,
  GitSnapshotIdentity,
  GitChange,
  GitChangeHunk,
} from './contracts.js';

export { acquireSnapshot } from './snapshot.js';
export type { GitSnapshot } from './snapshot.js';
export { listSnapshotChanges } from './changes.js';

export { readSnapshotBlob, searchSnapshot } from './source.js';

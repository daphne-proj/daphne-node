export {
  GitInputError,
  GitOperationError,
  defaultGitLimits,
  resolveGitLimits,
} from './limits.js';

export type { GitLimits, GitOperationOptions } from './limits.js';

export type {
  RepositoryComparisonInput,
  LocalComparisonInput,
  GitSnapshotIdentity,
  GitChange,
  GitChangeHunk,
} from './contracts.js';

export { acquireSnapshot, openLocalSnapshot } from './snapshot.js';
export type { GitSnapshot } from './snapshot.js';
export { listSnapshotChanges } from './changes.js';

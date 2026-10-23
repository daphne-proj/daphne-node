import { resolveGitLimits } from '@daphne/git-source';
import type { GitLimits, GitSnapshot } from '@daphne/git-source';
import type {
  ByteRange,
  ReviewIdentity,
  Side,
  SourceEvidence,
  ToolResult,
} from './contracts.js';
import { readSource } from './source.js';
import { createHunkReader } from './hunks.js';
import { EvidenceInputError } from './errors.js';
import { resolveEvidenceLimits } from './limits.js';
import type { EvidenceLimits } from './limits.js';
import { createToolExecutor } from './tools/execute.js';
import { checkCancellation } from './tools/operations.js';

export interface EvidenceOperationOptions {
  readonly signal: AbortSignal;
  readonly gitLimits: GitLimits;
  readonly limits: EvidenceLimits;
}

export interface EvidenceSession {
  readonly identity: ReviewIdentity;
  execute(request: unknown): Promise<ToolResult>;
  readSource(input: {
    readonly side: Side;
    readonly path: string;
    readonly range: ByteRange;
  }): Promise<SourceEvidence>;
  readHunk(input: {
    changeId: string;
    hunkIndex: number;
  }): Promise<readonly SourceEvidence[]>;
}

/** Borrows a snapshot; its acquiring host remains responsible for close(). */
export function createEvidenceSession(
  snapshot: GitSnapshot,
  options: EvidenceOperationOptions,
): EvidenceSession {
  const identity: ReviewIdentity = Object.freeze({
    sessionId: snapshot.identity.sessionId,
    repositoryUrl: snapshot.identity.repositoryUrl,
    targetCommit: snapshot.identity.targetCommit,
    baseCommit: snapshot.identity.baseCommit,
    headCommit: snapshot.identity.headCommit,
  });

  const operation = Object.freeze({
    signal: options.signal,
    limits: resolveGitLimits(options.gitLimits),
  });

  const limits = resolveEvidenceLimits(options.limits);
  const execute = createToolExecutor(snapshot, identity, operation, limits);
  const readHunk = createHunkReader(snapshot, operation);

  return Object.freeze({
    identity,
    execute,
    readSource(input: {
      readonly side: Side;
      readonly path: string;
      readonly range: ByteRange;
    }) {
      return readSource(snapshot, input, operation);
    },
    async readHunk(input: unknown) {
      checkCancellation(operation.signal);

      if (typeof input !== 'object' || input === null) {
        throw new EvidenceInputError('A hunk request object is required.');
      }

      if (!('changeId' in input) || typeof input.changeId !== 'string') {
        throw new EvidenceInputError('A string change ID is required.');
      }

      if (!('hunkIndex' in input) || typeof input.hunkIndex !== 'number') {
        throw new EvidenceInputError('A numeric hunk index is required.');
      }

      const sources = await readHunk({
        changeId: input.changeId,
        hunkIndex: input.hunkIndex,
      });
      checkCancellation(operation.signal);

      return sources;
    },
  });
}

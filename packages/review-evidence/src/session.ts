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
import { resolveEvidenceLimits } from './limits.js';
import type { EvidenceLimits } from './limits.js';
import { createToolExecutor } from './tools/execute.js';

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
  });
}

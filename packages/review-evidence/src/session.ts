import { resolveGitLimits } from '@daphne/git-source';
import type { GitLimits, GitSnapshot } from '@daphne/git-source';
import type {
  ByteRange,
  ReviewIdentity,
  Side,
  SourceEvidence,
} from './contracts.js';
import { readSource } from './source.js';

export interface EvidenceOperationOptions {
  readonly signal: AbortSignal;
  readonly gitLimits: GitLimits;
}

export interface EvidenceSession {
  readonly identity: ReviewIdentity;
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

  return Object.freeze({
    identity,
    readSource(input: {
      readonly side: Side;
      readonly path: string;
      readonly range: ByteRange;
    }) {
      return readSource(snapshot, input, operation);
    },
  });
}

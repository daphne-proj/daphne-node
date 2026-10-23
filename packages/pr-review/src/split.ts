import {
  acquireSnapshot,
  defaultGitLimits,
  listSnapshotChanges,
} from '@daphne/git-source';
import {
  createEvidenceSession,
  defaultEvidenceLimits,
} from '@daphne/review-evidence';
import type {
  Change,
  EvidenceSession,
  ReviewIdentity,
} from '@daphne/review-evidence';
import type { DiffContextHunk } from '@daphne/context-engine';
import { maxCorrections, runSemanticSplit } from '@daphne/semantic-split';
import type {
  Proposal,
  SemanticSplitOptions,
  SemanticSplitResult,
} from '@daphne/semantic-split';
import { resolvePullRequest } from './acquisition/pull-request.js';
import type { PullRequestRef } from './acquisition/pull-request.js';
import { defaultPullRequestLimits } from './limits.js';

export interface SplitPullRequestOptions extends SemanticSplitOptions {
  githubToken?: string;
}

interface PullRequestEvidence {
  identity: ReviewIdentity | null;
  changes: readonly Change[];
  hunks: DiffContextHunk[];
}

export type SplitPullRequestResult = PullRequestEvidence &
  Pick<SemanticSplitResult, 'maxCorrections' | 'pages' | 'attempts' | 'calls'> &
  (
    | {
        status: 'complete';
        proposal: Proposal;
        response: Record<string, unknown> | null;
        errors: [];
      }
    | { status: 'failed'; proposal: null; response: null; errors: unknown[] }
  );

async function* readDiffHunks(
  session: EvidenceSession,
  changes: readonly Change[],
): AsyncIterable<DiffContextHunk> {
  for (const change of changes) {
    const indexes =
      change.kind === 'text' && change.hunks.length > 0
        ? change.hunks.map((_, index) => index)
        : [null];

    for (const hunkIndex of indexes) {
      const sources =
        hunkIndex === null
          ? []
          : await session.readHunk({ changeId: change.id, hunkIndex });

      yield { change, hunkIndex, sources };
    }
  }
}

/* Own the Git lifetime and retain evidence and both retrieval/cleanup errors on failure. */
export async function splitPullRequest(
  ref: PullRequestRef,
  options: SplitPullRequestOptions,
): Promise<SplitPullRequestResult> {
  const { githubToken, ...modelOptions } = options;
  const { signal } = modelOptions;
  const evidence: PullRequestEvidence = {
    identity: null,
    changes: [],
    hunks: [],
  };
  const errors: unknown[] = [];
  let split: SemanticSplitResult | undefined;

  try {
    const metadata = await resolvePullRequest(ref, {
      signal,
      limits: defaultPullRequestLimits,
      ...(githubToken === undefined ? {} : { token: githubToken }),
    });
    const snapshot = await acquireSnapshot(metadata, {
      signal,
      limits: defaultGitLimits,
    });

    try {
      evidence.identity = snapshot.identity;
      evidence.changes = await listSnapshotChanges(snapshot, {
        signal,
        limits: defaultGitLimits,
      });
      const session = createEvidenceSession(snapshot, {
        signal,
        gitLimits: defaultGitLimits,
        limits: defaultEvidenceLimits,
      });

      for await (const hunk of readDiffHunks(session, evidence.changes)) {
        evidence.hunks.push(hunk);
      }
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await snapshot.close();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 0) {
      split = await runSemanticSplit(
        {
          identity: snapshot.identity,
          changes: evidence.changes,
          hunks: evidence.hunks,
        },
        modelOptions,
      );

      if (split.status === 'failed') {
        errors.push(split.error);
      }
    }
  } catch (error) {
    errors.push(error);
  }

  if (split?.status === 'complete') {
    return { ...evidence, ...split, errors: [] };
  }

  return {
    ...evidence,
    status: 'failed',
    maxCorrections,
    pages: split?.pages ?? [],
    attempts: split?.attempts ?? [],
    calls: split?.calls ?? { count: 0, generate: 0 },
    proposal: null,
    response: null,
    errors,
  };
}

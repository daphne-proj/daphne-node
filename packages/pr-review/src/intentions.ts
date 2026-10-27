import {
  acquireSnapshot,
  defaultGitLimits,
  listSnapshotChanges,
} from '@daphne/git-source';
import type { GitSnapshot } from '@daphne/git-source';
import { runIntentions } from '@daphne/intentions';
import type {
  IntentionsOptions,
  IntentionsProposal,
  IntentionsResult,
} from '@daphne/intentions';
import {
  createEvidenceSession,
  defaultEvidenceLimits,
} from '@daphne/review-evidence';
import type {
  Change,
  ContextNotice,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';
import type { DiffContextHunk } from '@daphne/context-engine';
import {
  PullRequestError,
  resolvePullRequest,
} from './acquisition/pull-request.js';
import type {
  PullRequestRef,
  ResolvedPullRequest,
} from './acquisition/pull-request.js';
import { defaultPullRequestLimits } from './limits.js';

/* The app supplies model settings and cancellation; this workflow supplies runIntentions' executor. */
export interface IntentionsPullRequestOptions extends Omit<
  IntentionsOptions,
  'executeTool'
> {
  githubToken?: string;
}

interface PullRequestEvidence {
  metadata: ResolvedPullRequest | null;
  identity: ReviewIdentity | null;
  changes: readonly Change[];
  hunks: DiffContextHunk[];
  limitations: ContextNotice[];
}

type WorkflowError = {
  stage: 'acquisition' | 'investigation' | 'cleanup';
  error: unknown;
};

/*
 * Retains acquisition and investigation progress even if later work fails.
 * Callers accept proposal only when status === 'complete'; a valid draft in
 * investigation remains diagnostic when cleanup or late cancellation fails.
 * Errors identify their stage; closing an acquired snapshot cannot replace a recorded failure.
 */
export type IntentionsPullRequestResult = PullRequestEvidence & {
  investigation: IntentionsResult | null;
} & (
    | {
        status: 'complete';
        proposal: IntentionsProposal;
        response: Record<string, unknown> | null;
        errors: [];
      }
    | {
        status: 'failed';
        proposal: null;
        response: null;
        errors: WorkflowError[];
      }
  );

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new PullRequestError(
      'cancelled',
      'The PR intentions workflow was cancelled or timed out.',
    );
  }
}

/*
 * Resolves a PR and lends read-only repository tools to runIntentions. For
 * example, analyzePullRequestIntentions(ref, options) returns cards only after
 * investigation and cleanup succeed. Git stays open because tool turns may read
 * unchanged files in either pinned revision. Cancellation and failures return
 * collected work; finally closes the snapshot without using the cancelled signal.
 */
export async function analyzePullRequestIntentions(
  ref: PullRequestRef,
  options: IntentionsPullRequestOptions,
): Promise<IntentionsPullRequestResult> {
  const { githubToken, ...modelOptions } = options;
  const { signal } = modelOptions;

  const evidence: PullRequestEvidence = {
    metadata: null,
    identity: null,
    changes: [],
    hunks: [],
    limitations: [],
  };

  const errors: WorkflowError[] = [];
  let snapshot: GitSnapshot | null = null;
  let investigation: IntentionsResult | null = null;
  let stage: 'acquisition' | 'investigation' = 'acquisition';

  try {
    checkCancellation(signal);

    const metadata = await resolvePullRequest(ref, {
      signal,
      limits: defaultPullRequestLimits,
      ...(githubToken === undefined ? {} : { token: githubToken }),
    });

    evidence.metadata = metadata;

    snapshot = await acquireSnapshot(
      {
        targetRepositoryUrl: metadata.targetRepositoryUrl,
        headRepositoryUrl: metadata.headRepositoryUrl,
        targetCommit: metadata.targetCommit,
        headCommit: metadata.headCommit,
      },
      { signal, limits: defaultGitLimits },
    );

    evidence.identity = snapshot.identity;
    evidence.changes = await listSnapshotChanges(snapshot, {
      signal,
      limits: defaultGitLimits,
    });

    evidence.limitations = evidence.changes
      .filter((change) => change.kind !== 'text')
      .map((change) => ({
        code: 'unsupported_change',
        message: `Change ${change.id} has ${change.kind} content; only its metadata is available.`,
        path: change.afterPath ?? change.beforePath,
      }));

    const session = createEvidenceSession(snapshot, {
      signal,
      gitLimits: defaultGitLimits,
      limits: defaultEvidenceLimits,
    });

    for (const change of evidence.changes) {
      if (change.kind !== 'text' || change.hunks.length === 0) {
        evidence.hunks.push({ change, hunkIndex: null, sources: [] });
        continue;
      }

      for (const hunkIndex of change.hunks.keys()) {
        const sources = await session.readHunk({
          changeId: change.id,
          hunkIndex,
        });

        evidence.hunks.push({ change, hunkIndex, sources });
      }
    }

    stage = 'investigation';

    investigation = await runIntentions(
      {
        identity: snapshot.identity,
        changes: evidence.changes,
        hunks: evidence.hunks,
        pr: {
          url: metadata.ref.url,
          title: metadata.title,
          body: metadata.body,
        },
      },
      { ...modelOptions, executeTool: (request) => session.execute(request) },
    );

    if (investigation.status === 'failed') {
      errors.push({ stage, error: investigation.error });
    }
  } catch (error) {
    errors.push({ stage, error });
  } finally {
    if (snapshot !== null) {
      try {
        await snapshot.close();
      } catch (error) {
        errors.push({ stage: 'cleanup', error });
      }
    }
  }

  /* Cancellation during cleanup must not publish a previously accepted draft. */
  if (errors.length === 0) {
    try {
      checkCancellation(signal);
    } catch (error) {
      errors.push({ stage, error });
    }
  }

  if (investigation?.status === 'complete' && errors.length === 0) {
    return {
      ...evidence,
      investigation,
      status: 'complete',
      proposal: investigation.proposal,
      response: investigation.response,
      errors: [],
    };
  }

  return {
    ...evidence,
    investigation,
    status: 'failed',
    proposal: null,
    response: null,
    errors,
  };
}

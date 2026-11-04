import { isDeepStrictEqual } from 'node:util';
import {
  acquireSnapshot,
  defaultGitLimits,
  listSnapshotChanges,
} from '@daphne/git-source';
import type { GitSnapshot } from '@daphne/git-source';
import {
  createEvidenceSession,
  readOriginalDiff,
  defaultEvidenceLimits,
} from '@daphne/review-evidence';
import { runSemanticSplit, splitLimits } from '@daphne/semantic-split';
import type {
  SemanticSplitOptions,
  SemanticSplitResult,
} from '@daphne/semantic-split';
import type { FrozenSplitEvidence, PreparedSplitCase } from './contracts.js';
import { toSemanticSplitInput } from './trial.js';
import { EvaluationError } from '../parse.js';

import { rebindSplitEvidence } from './evidence.js';

/*
 * Reopen a prepared case at its captured commits, verify all original bytes, then
 * lend the session to the model. For example, runSplitCase(caseData, options)
 * never resolves the moving PR URL or exposes labels. Cleanup and cancellation
 * clear acceptance while preserving completed replies; persisted case data is untouched.
 */
export async function runSplitCase(
  caseData: PreparedSplitCase,
  options: Omit<SemanticSplitOptions, 'executeTool'>,
): Promise<SemanticSplitResult> {
  const frozen = structuredClone(caseData.definition.evidence);
  const { signal } = options.budget;
  let snapshot: GitSnapshot | null = null;
  let result: SemanticSplitResult | null = null;
  let failure: { error: unknown } | null = null;

  try {
    signal.throwIfAborted();
    snapshot = await acquireSnapshot(frozen.source, {
      signal,
      limits: defaultGitLimits,
    });
    const changes = await listSnapshotChanges(snapshot, {
      signal,
      limits: defaultGitLimits,
    });
    const session = createEvidenceSession(snapshot, {
      signal,
      gitLimits: defaultGitLimits,
      limits: defaultEvidenceLimits,
    });
    const hunks: FrozenSplitEvidence['hunks'] = [];

    for await (const { change, hunkIndex, sources } of readOriginalDiff(
      session,
      changes,
    )) {
      hunks.push({ changeId: change.id, hunkIndex, sources: [...sources] });
    }

    const rebound = rebindSplitEvidence(frozen, snapshot.identity.sessionId);

    if (
      !isDeepStrictEqual(rebound.identity, snapshot.identity) ||
      !isDeepStrictEqual(rebound.changes, changes) ||
      !isDeepStrictEqual(rebound.hunks, hunks)
    ) {
      throw new EvaluationError(
        'Captured repositories do not reproduce the frozen comparison and source bytes.',
      );
    }

    result = await runSemanticSplit(toSemanticSplitInput(rebound), {
      ...options,
      executeTool: (request) => session.execute(request),
    });
  } catch (error) {
    failure = { error };
  } finally {
    if (snapshot !== null) {
      try {
        await snapshot.close();
      } catch (error) {
        failure ??= { error };
      }
    }
  }

  if (signal.aborted) {
    failure ??= { error: signal.reason };
  }

  if (result !== null && failure === null) {
    return result;
  }

  return {
    ...(result ?? {
      comparison: {
        identity: frozen.identity,
        pr: frozen.pr,
        changes: frozen.changes,
      },
      budget: {
        maxCandidates: options.budget.maxCandidates,
        deadlineAt: options.budget.deadlineAt,
      },
      limits: { ...splitLimits, maxInputTokens: options.maxInputTokens },
      evidence: null,
      hunks: [],
      attempts: [],
      tools: [],
      turns: [],
      limitations: [],
      diagnostics: [],
      calls: { count: 0, generate: 0, tools: 0 },
    }),
    status: 'failed',
    proposal: null,
    response: null,
    acceptedCandidate: null,
    error:
      failure?.error ?? new EvaluationError('Frozen split did not complete.'),
  };
}

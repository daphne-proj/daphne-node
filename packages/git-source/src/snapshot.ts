import { randomUUID } from 'node:crypto';
import { access, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  LocalComparisonInput,
  RepositoryComparisonInput,
  GitSnapshotIdentity,
} from './contracts.js';
import {
  checkCancellation,
  GitInputError,
  GitOperationError,
  resolveGitLimits,
} from './limits.js';
import type { GitOperationOptions } from './limits.js';
import { runGit } from './process.js';

/**
 * Exposes pinned identity and disposal while keeping the temporary repository private.
 * Example: use the snapshot inside try, then await snapshot.close() in finally.
 */
export interface GitSnapshot {
  readonly identity: GitSnapshotIdentity;

  /**
   * Cancels active operations and waits before deleting owned files; repeated calls share cleanup.
   * Example: closing during inventory waits for that operation to stop.
   */
  close(): Promise<void>;
}

/**
 * Tracks private resources and active work so cleanup cannot race with Git operations.
 * Example: an inventory promise stays in active until it finishes or is cancelled.
 */
interface SnapshotState {
  readonly directory: string;
  readonly controller: AbortController;
  readonly active: Set<Promise<unknown>>;
  closing: Promise<void> | undefined;
}

/**
 * Associates genuine public handles with private state without exposing repository paths.
 * Example: a caller-created object with matching identity fields is not a valid snapshot.
 */
const snapshots = new WeakMap<GitSnapshot, SnapshotState>();

/**
 * Requires a full SHA-1 ID so a moving branch or ambiguous abbreviation cannot change the input.
 * Example: main and a seven-character hash are rejected; uppercase full IDs are normalized.
 */
function commitId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length !== 40 ||
    !/^[0-9a-f]{40}$/i.test(value)
  ) {
    throw new GitInputError('A full 40-character Git commit ID is required.');
  }

  return value.toLowerCase();
}

/**
 * Enforces the supported remote origin before any Git command receives a URL.
 * Example: https://github.com/team/project.git is allowed; a credential-bearing URL is not.
 */
function repositoryUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new GitInputError(
      'A canonical HTTPS GitHub repository URL is required.',
    );
  }

  const match =
    /^https:\/\/github\.com\/([a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)\/([a-zA-Z0-9_.-]+)\.git$/.exec(
      value,
    );

  if (!match || match[0] !== value || match[2] === '.' || match[2] === '..') {
    throw new GitInputError(
      'Expected https://github.com/OWNER/REPOSITORY.git without credentials, query or fragment.',
    );
  }

  return value;
}

/**
 * Rejects borrowed object stores so snapshot reads do not depend on another repository's lifetime.
 * Example: an alternates file pointing at a cache could break reads after that cache is deleted.
 */
async function rejectSharedObjects(directory: string): Promise<void> {
  for (const name of ['alternates', 'http-alternates']) {
    let present = false;

    try {
      await access(join(directory, 'objects', 'info', name));
      present = true;
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }

    if (present) {
      throw new GitOperationError(
        'unsupported',
        'Repositories borrowing objects through alternates are not supported.',
      );
    }
  }
}

/**
 * Centralizes cleanup failures without leaking temporary filesystem paths.
 * Example: failure to delete our temporary repository becomes a cleanup error.
 */
async function removeOwnedDirectory(directory: string): Promise<void> {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch {
    throw new GitOperationError(
      'cleanup',
      'Could not remove the owned temporary Git snapshot.',
    );
  }
}

/**
 * Shares validation, one acquisition deadline and cleanup between remote and local inputs.
 * Example: either population path must yield complete commits and exactly one merge base.
 */
async function prepareSnapshot(
  repository: string,
  targetCommit: string,
  headCommit: string,
  options: GitOperationOptions,
  populate: (
    root: string,
    directory: string,
    options: GitOperationOptions,
  ) => Promise<void>,
): Promise<GitSnapshot> {
  const limits = resolveGitLimits(options.limits);
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(limits.acquisitionTimeoutMs),
  ]);
  const acquisition = { signal, limits };

  checkCancellation(signal);

  let root: string | undefined;

  try {
    root = await mkdtemp(join(tmpdir(), 'daphne-git-'));
    const directory = join(root, 'repository.git');

    await populate(root, directory, acquisition);

    checkCancellation(signal);

    await rejectSharedObjects(directory);

    const git = (args: readonly string[]) =>
      runGit(args, directory, { ...acquisition, fetch: false });

    if (
      (await git(['rev-parse', '--show-object-format'])).toString().trim() !==
        'sha1' ||
      (await git(['rev-parse', '--is-shallow-repository']))
        .toString()
        .trim() !== 'false'
    ) {
      throw new GitOperationError(
        'unsupported',
        'Only complete SHA-1 repositories are supported.',
      );
    }

    for (const [name, commit] of [
      ['target', targetCommit],
      ['head', headCommit],
    ] as const) {
      if (
        (await git(['cat-file', '-t', commit])).toString().trim() !== 'commit'
      ) {
        throw new GitOperationError(
          'invalid_comparison',
          'A supplied revision is not a commit object.',
        );
      }

      await git(['update-ref', `refs/daphne/${name}`, commit]);

      if (
        (await git(['rev-parse', '--verify', `refs/daphne/${name}`]))
          .toString()
          .trim() !== commit
      ) {
        throw new GitOperationError(
          'invalid_comparison',
          'The retained revision does not match the supplied commit.',
        );
      }
    }

    // Missing objects must fail locally; no promisor fetch or shallow history is accepted.
    await git([
      'rev-list',
      '--objects',
      '--missing=error',
      '--quiet',
      targetCommit,
      headCommit,
    ]);

    const bases = (
      await runGit(
        ['merge-base', '--all', targetCommit, headCommit],
        directory,
        {
          ...acquisition,
          fetch: false,
          acceptedExitCodes: [0, 1],
        },
      )
    )
      .toString()
      .trim()
      .split('\n');
    const base = bases[0];

    if (bases.length !== 1 || !base || !/^[0-9a-f]{40}$/.test(base)) {
      throw new GitOperationError(
        'invalid_comparison',
        'The revisions must have exactly one merge base.',
      );
    }

    await git(['update-ref', 'refs/daphne/base', base]);
    await git(['hash-object', '-w', '--stdin']);

    checkCancellation(signal);

    const identity = Object.freeze({
      sessionId: randomUUID(),
      repositoryUrl: repository,
      targetCommit,
      baseCommit: base,
      headCommit,
    });

    const ownedRoot = root;
    const state: SnapshotState = {
      directory,
      controller: new AbortController(),
      active: new Set(),
      closing: undefined,
    };

    const snapshot: GitSnapshot = Object.freeze({
      identity,
      close() {
        if (!state.closing) {
          state.controller.abort();
          state.closing = Promise.allSettled([...state.active]).then(() =>
            removeOwnedDirectory(ownedRoot),
          );
        }

        return state.closing;
      },
    });

    snapshots.set(snapshot, state);

    return snapshot;
  } catch (error) {
    if (root !== undefined) {
      await removeOwnedDirectory(root);
    }

    checkCancellation(signal);

    if (error instanceof GitInputError || error instanceof GitOperationError) {
      throw error;
    }

    throw new GitOperationError(
      'acquisition',
      'Could not prepare the temporary Git repository.',
    );
  }
}

/**
 * Fetches the requested remote commits into owned state, keeping later reads stable.
 * Example: target and head can come from different repositories when reviewing a fork.
 */
export async function acquireSnapshot(
  input: RepositoryComparisonInput,
  options: GitOperationOptions,
): Promise<GitSnapshot> {
  const targetRepositoryUrl = repositoryUrl(input.targetRepositoryUrl);
  const headRepositoryUrl = repositoryUrl(input.headRepositoryUrl);
  const targetCommit = commitId(input.targetCommit);
  const headCommit = commitId(input.headCommit);

  return prepareSnapshot(
    targetRepositoryUrl,
    targetCommit,
    headCommit,
    options,
    async (root, directory, acquisition) => {
      await runGit(['init', '--bare', '--template=', directory], root, {
        ...acquisition,
        fetch: false,
      });

      for (const [url, commit, name] of [
        [targetRepositoryUrl, targetCommit, 'target'],
        [headRepositoryUrl, headCommit, 'head'],
      ] as const) {
        await runGit(
          [
            'fetch',
            '--no-tags',
            '--no-write-fetch-head',
            '--no-recurse-submodules',
            '--no-auto-maintenance',
            '--force',
            '--',
            url,
            `${commit}:refs/daphne/${name}`,
          ],
          directory,
          { ...acquisition, fetch: true },
        );
      }
    },
  );
}

/**
 * Copies committed objects into owned state without modifying the source checkout.
 * Example: changing the source branch afterward does not change this comparison's head.
 */
export async function openLocalSnapshot(
  input: LocalComparisonInput,
  options: GitOperationOptions,
): Promise<GitSnapshot> {
  const targetCommit = commitId(input.targetCommit);
  const headCommit = commitId(input.headCommit);

  if (
    typeof input.repositoryPath !== 'string' ||
    input.repositoryPath.length === 0 ||
    input.repositoryPath.includes('\0')
  ) {
    throw new GitInputError('A local repository path is required.');
  }

  checkCancellation(options.signal);

  let source: string;

  try {
    source = await realpath(input.repositoryPath);
  } catch {
    throw new GitOperationError(
      'acquisition',
      'The local repository path is not accessible.',
    );
  }

  return prepareSnapshot(
    pathToFileURL(source).href,
    targetCommit,
    headCommit,
    options,
    async (root, directory, acquisition) => {
      // --local bypasses upload-pack; copying objects avoids executing source-repository helpers.
      await runGit(
        [
          '-c',
          'protocol.file.allow=always',
          'clone',
          '--bare',
          '--local',
          '--no-hardlinks',
          '--no-checkout',
          '--no-tags',
          '--reject-shallow',
          '--template=',
          '--',
          source,
          directory,
        ],
        root,
        { ...acquisition, fetch: true },
      );
    },
  );
}

/**
 * Registers internal work so close() waits for it, without exposing the repository path publicly.
 * Example: an inventory uses this lease; closing its snapshot cancels and waits for that inventory.
 */
export async function withSnapshot<T>(
  snapshot: GitSnapshot,
  options: GitOperationOptions,
  operation: (directory: string, options: GitOperationOptions) => Promise<T>,
): Promise<T> {
  const state = snapshots.get(snapshot);

  if (!state) {
    throw new GitInputError('The snapshot was not created by this package.');
  }

  if (state.closing) {
    throw new GitOperationError('closed', 'The Git snapshot is closed.');
  }

  const limits = resolveGitLimits(options.limits);
  const signal = AbortSignal.any([
    options.signal,
    state.controller.signal,
    AbortSignal.timeout(limits.gitTimeoutMs),
  ]);

  checkCancellation(signal);

  const pending = operation(state.directory, { signal, limits });
  state.active.add(pending);

  try {
    return await pending;
  } finally {
    state.active.delete(pending);
  }
}

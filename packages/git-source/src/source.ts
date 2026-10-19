import {
  GitBlobUnavailableError,
  GitInputError,
  GitOperationError,
} from './limits.js';
import type { GitOperationOptions } from './limits.js';
import { runGit } from './process.js';
import { withSnapshot } from './snapshot.js';
import type { GitSnapshot } from './snapshot.js';

// Shared by inventory classification and exact source reads; never exported from the package.
export async function readBlobBytes(
  oid: string,
  directory: string,
  options: GitOperationOptions,
): Promise<Buffer> {
  const sizeOutput = await runGit(['cat-file', '-s', oid], directory, {
    ...options,
    fetch: false,
  });
  const size = Number(sizeOutput.toString().trim());

  if (!Number.isSafeInteger(size) || size < 0) {
    throw new GitOperationError(
      'invalid_git_output',
      'Git returned an invalid blob size.',
    );
  }

  if (size > options.limits.maxBlobBytes) {
    throw new GitBlobUnavailableError(
      'too_large',
      'The blob exceeds the configured byte limit.',
    );
  }

  const bytes = await runGit(['cat-file', 'blob', oid], directory, {
    ...options,
    fetch: false,
  });

  if (bytes.byteLength !== size) {
    throw new GitOperationError(
      'invalid_git_output',
      'Git blob bytes do not match the declared size.',
    );
  }

  return bytes;
}

function validatePath(path: unknown): asserts path is string {
  if (
    typeof path !== 'string' ||
    path.length === 0 ||
    path.includes('\0') ||
    path
      .split('/')
      .some((part) => part === '' || part === '.' || part === '..') ||
    Buffer.from(path, 'utf8').toString('utf8') !== path
  ) {
    throw new GitInputError(
      'A literal repository-relative UTF-8 file path is required.',
    );
  }
}

function parseSourceInput(input: unknown): {
  side: 'base' | 'head';
  path: string;
} {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('side' in input) ||
    !('path' in input) ||
    (input.side !== 'base' && input.side !== 'head')
  ) {
    throw new GitInputError('A base/head source side and path are required.');
  }

  validatePath(input.path);

  return { side: input.side, path: input.path };
}

/** Reads original bytes from a pinned tree, without checking out or following links. */
export async function readSnapshotBlob(
  snapshot: GitSnapshot,
  input: { readonly side: 'base' | 'head'; readonly path: string },
  options: GitOperationOptions,
): Promise<{
  readonly commit: string;
  readonly path: string;
  readonly blobId: string;
  readonly bytes: Buffer;
}> {
  const { side, path } = parseSourceInput(input);

  return withSnapshot(snapshot, options, async (directory, operation) => {
    const commit =
      side === 'base'
        ? snapshot.identity.baseCommit
        : snapshot.identity.headCommit;
    const record = await runGit(
      ['ls-tree', '-z', '--full-tree', commit, '--', path],
      directory,
      { ...operation, fetch: false },
    );

    if (record.length === 0) {
      throw new GitBlobUnavailableError(
        'missing',
        'The path does not exist on the selected side.',
      );
    }

    const separator = record.indexOf(9);
    const end = record.indexOf(0);
    const metadata = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})$/.exec(
      record.subarray(0, separator).toString('ascii'),
    );
    const mode = metadata?.[1];
    const type = metadata?.[2];
    const blobId = metadata?.[3];

    if (
      separator < 0 ||
      end !== record.length - 1 ||
      !mode ||
      !type ||
      !blobId ||
      !record.subarray(separator + 1, end).equals(Buffer.from(path, 'utf8'))
    ) {
      throw new GitOperationError(
        'invalid_git_output',
        'Git returned an unexpected tree entry.',
      );
    }

    if (mode === '120000') {
      throw new GitBlobUnavailableError(
        'symlink',
        'Symlinks are not source files and are never followed.',
      );
    }

    if (mode === '160000') {
      throw new GitBlobUnavailableError(
        'submodule',
        'Submodule source is not materialized.',
      );
    }

    if (type !== 'blob' || (mode !== '100644' && mode !== '100755')) {
      throw new GitBlobUnavailableError(
        'not_regular',
        'The path is not a regular source file.',
      );
    }

    const bytes = await readBlobBytes(blobId, directory, operation);

    return Object.freeze({ commit, path, blobId, bytes });
  });
}

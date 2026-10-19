import {
  defaultGitLimits,
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

/** Returns NUL-delimited matching-file records, not source evidence or paginated results. */
export async function searchSnapshot(
  snapshot: GitSnapshot,
  input: {
    readonly side: 'base' | 'head';
    readonly query: string;
    readonly pathPrefix?: string;
  },
  options: GitOperationOptions,
): Promise<Buffer> {
  const request: unknown = input;

  if (
    typeof request !== 'object' ||
    request === null ||
    !('side' in request) ||
    (request.side !== 'base' && request.side !== 'head') ||
    !('query' in request) ||
    typeof request.query !== 'string' ||
    request.query.length === 0 ||
    /[\0\r\n]/u.test(request.query) ||
    Buffer.from(request.query).toString('utf8') !== request.query ||
    Buffer.byteLength(request.query) > defaultGitLimits.maxGitOutputBytes
  ) {
    throw new GitInputError(
      'A pinned side and bounded single-line literal UTF-8 query are required.',
    );
  }

  const { side, query } = request;
  let pathPrefix = '';

  if ('pathPrefix' in request && request.pathPrefix !== undefined) {
    const prefix = request.pathPrefix;

    if (typeof prefix !== 'string') {
      throw new GitInputError(
        'The path prefix must be literal repository-relative text.',
      );
    }

    validatePath(prefix.endsWith('/') ? prefix.slice(0, -1) : prefix);
    pathPrefix = prefix;
  }

  return withSnapshot(snapshot, options, async (directory, operation) => {
    const commit =
      side === 'base'
        ? snapshot.identity.baseCommit
        : snapshot.identity.headCommit;
    // A literal directory prunes work; the final component remains a literal string prefix.
    const parent = pathPrefix.slice(0, pathPrefix.lastIndexOf('/'));
    const output = await runGit(
      [
        'grep',
        '--no-recurse-submodules',
        '--no-textconv',
        '--no-color',
        '--full-name',
        '--threads=1',
        '-I',
        '-F',
        '-l',
        '-z',
        '-e',
        query,
        commit,
        '--',
        ...(parent ? [parent] : []),
      ],
      directory,
      { ...operation, fetch: false, acceptedExitCodes: [0, 1] },
    );

    const records: Buffer[] = [];
    let offset = 0;

    while (offset < output.length) {
      const end = output.indexOf(0, offset);
      const record = output.subarray(offset, end);
      const prefix = Buffer.from(`${commit}:`);

      if (end < 0 || !record.subarray(0, prefix.length).equals(prefix)) {
        throw new GitOperationError(
          'invalid_git_output',
          'Git returned an invalid search record.',
        );
      }

      const bytes = record.subarray(prefix.length);
      let path: string;

      try {
        path = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
      } catch {
        throw new GitOperationError(
          'unsupported',
          'Search returned a non-UTF-8 path.',
        );
      }

      validatePath(path);

      if (path.startsWith(pathPrefix)) {
        records.push(record);
      }

      offset = end + 1;
    }

    records.sort((left, right) => Buffer.compare(left, right));

    return Buffer.concat(
      records.flatMap((record) => [record, Buffer.from([0])]),
    );
  });
}

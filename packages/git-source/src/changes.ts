import type { GitChange, GitChangeHunk } from './contracts.js';
import { checkCancellation, GitOperationError } from './limits.js';
import type { GitOperationOptions } from './limits.js';
import { runGit } from './process.js';
import { withSnapshot } from './snapshot.js';
import type { GitSnapshot } from './snapshot.js';

const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const diffOptions = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--find-renames=50%',
  '--diff-algorithm=myers',
  '--no-indent-heuristic',
  '--ignore-submodules=none',
];

interface RawChange {
  readonly beforePath: string | null;
  readonly afterPath: string | null;
  readonly beforeMode: string | null;
  readonly afterMode: string | null;
  readonly beforeBlob: string;
  readonly afterBlob: string;
  readonly status: GitChange['status'];
}

function invalidOutput(): GitOperationError {
  return new GitOperationError(
    'invalid_git_output',
    'Git returned an unexpected change representation.',
  );
}

function decodePath(bytes: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new GitOperationError(
      'unsupported',
      'Non-UTF-8 repository paths cannot be represented in this change inventory.',
    );
  }
}

function parseChanges(bytes: Buffer): RawChange[] {
  let offset = 0;

  function field(): Buffer {
    const end = bytes.indexOf(0, offset);
    if (end < 0 || end === offset) {
      throw invalidOutput();
    }
    const value = bytes.subarray(offset, end);
    offset = end + 1;
    return value;
  }

  const changes: RawChange[] = [];

  while (offset < bytes.length) {
    const metadata =
      /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([ADMT]|R\d+)$/u.exec(
        field().toString('ascii'),
      );

    const beforeMode = metadata?.[1];
    const afterMode = metadata?.[2];
    const beforeBlob = metadata?.[3];
    const afterBlob = metadata?.[4];
    const statusCode = metadata?.[5];

    if (!beforeMode || !afterMode || !beforeBlob || !afterBlob || !statusCode) {
      throw invalidOutput();
    }

    const firstPath = decodePath(field());

    let status: GitChange['status'];
    let beforePath: string | null = firstPath;
    let afterPath: string | null = firstPath;

    switch (statusCode.charAt(0)) {
      case 'A':
        status = 'added';
        beforePath = null;
        break;
      case 'D':
        status = 'deleted';
        afterPath = null;
        break;
      case 'M':
        status = 'modified';
        break;
      case 'T':
        status = 'type-changed';
        break;
      case 'R':
        status = 'renamed';
        afterPath = decodePath(field());
        break;
      default:
        throw invalidOutput();
    }

    changes.push({
      beforePath,
      afterPath,
      beforeMode: beforeMode === '000000' ? null : beforeMode,
      afterMode: afterMode === '000000' ? null : afterMode,
      beforeBlob: beforeMode === '000000' ? emptyBlob : beforeBlob,
      afterBlob: afterMode === '000000' ? emptyBlob : afterBlob,
      status,
    });
  }

  return changes.sort(
    (left, right) =>
      Buffer.compare(
        Buffer.from(left.afterPath ?? left.beforePath ?? ''),
        Buffer.from(right.afterPath ?? right.beforePath ?? ''),
      ) ||
      Buffer.compare(
        Buffer.from(left.beforePath ?? ''),
        Buffer.from(right.beforePath ?? ''),
      ),
  );
}

async function blobKind(
  oid: string,
  directory: string,
  options: GitOperationOptions,
): Promise<'text' | 'binary' | 'unsupported'> {
  const size = Number(
    (
      await runGit(['cat-file', '-s', oid], directory, {
        ...options,
        fetch: false,
      })
    )
      .toString()
      .trim(),
  );
  if (!Number.isSafeInteger(size) || size < 0) {
    throw invalidOutput();
  }
  if (size > options.limits.maxBlobBytes) {
    return 'unsupported';
  }
  const bytes = await runGit(['cat-file', 'blob', oid], directory, {
    ...options,
    fetch: false,
  });
  if (bytes.byteLength !== size) {
    throw invalidOutput();
  }
  if (bytes.includes(0)) {
    return 'binary';
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'text';
  } catch {
    return 'unsupported';
  }
}

async function changeKind(
  change: RawChange,
  directory: string,
  options: GitOperationOptions,
): Promise<GitChange['kind']> {
  const modes = [change.beforeMode, change.afterMode];
  if (modes.includes('160000')) {
    return 'submodule';
  }
  if (modes.includes('120000')) {
    return 'symlink';
  }
  if (
    modes.some(
      (mode) => mode !== null && mode !== '100644' && mode !== '100755',
    )
  ) {
    return 'unsupported';
  }
  const before = await blobKind(change.beforeBlob, directory, options);
  const after = await blobKind(change.afterBlob, directory, options);
  if (before === 'unsupported' || after === 'unsupported') {
    return 'unsupported';
  }
  if (before === 'binary' || after === 'binary') {
    return 'binary';
  }
  return 'text';
}

function parseHunks(patch: Buffer): readonly GitChangeHunk[] {
  const hunks: GitChangeHunk[] = [];
  for (const line of patch.toString('utf8').split('\n')) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) {
      continue;
    }
    const hunk = {
      beforeStartLine: Number(match[1]),
      beforeLineCount: Number(match[2] ?? '1'),
      afterStartLine: Number(match[3]),
      afterLineCount: Number(match[4] ?? '1'),
    };
    if (
      Object.values(hunk).some(
        (value) => !Number.isSafeInteger(value) || value < 0,
      )
    ) {
      throw invalidOutput();
    }
    hunks.push(Object.freeze(hunk));
  }
  return Object.freeze(hunks);
}

export async function listSnapshotChanges(
  snapshot: GitSnapshot,
  options: GitOperationOptions,
): Promise<readonly GitChange[]> {
  return withSnapshot(snapshot, options, async (directory, operation) => {
    const raw = await runGit(
      [
        'diff',
        ...diffOptions,
        '--raw',
        '-z',
        '--no-abbrev',
        snapshot.identity.baseCommit,
        snapshot.identity.headCommit,
        '--',
      ],
      directory,
      { ...operation, fetch: false },
    );
    const entries = parseChanges(raw);
    const changes: GitChange[] = [];
    let capturedBytes = raw.byteLength;

    for (const entry of entries) {
      checkCancellation(operation.signal);
      const kind = await changeKind(entry, directory, operation);
      let hunks: readonly GitChangeHunk[] = Object.freeze([]);
      if (kind === 'text' && entry.beforeBlob !== entry.afterBlob) {
        const patch = await runGit(
          [
            'diff',
            ...diffOptions,
            '--patch',
            '--text',
            '--unified=0',
            entry.beforeBlob,
            entry.afterBlob,
            '--',
          ],
          directory,
          { ...operation, fetch: false },
        );
        capturedBytes += patch.byteLength;
        if (capturedBytes > operation.limits.maxGitOutputBytes) {
          throw new GitOperationError(
            'output_limit',
            'The change inventory exceeds its aggregate Git output allowance.',
          );
        }
        hunks = parseHunks(patch);
      }
      changes.push(
        Object.freeze({
          id: `change-${String(changes.length + 1)}`,
          beforePath: entry.beforePath,
          afterPath: entry.afterPath,
          beforeMode: entry.beforeMode,
          afterMode: entry.afterMode,
          status: entry.status,
          kind,
          hunks,
        }),
      );
    }
    checkCancellation(operation.signal);
    return Object.freeze(changes);
  });
}

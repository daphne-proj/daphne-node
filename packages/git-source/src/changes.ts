import type { GitChange, GitChangeHunk } from './contracts.js';
import {
  checkCancellation,
  GitBlobUnavailableError,
  GitOperationError,
} from './limits.js';
import { readBlobBytes } from './source.js';
import type { GitOperationOptions } from './limits.js';
import { runGit } from './process.js';
import { withSnapshot } from './snapshot.js';
import type { GitSnapshot } from './snapshot.js';

/**
 * Uses Git's empty-file object as the missing side of an addition or deletion.
 * Example: diffing emptyBlob against a new file produces its insertion hunks.
 */
const emptyBlob = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';

/**
 * Fixes diff behavior so caller configuration cannot change the comparison policy.
 * Example: rename detection always uses 50% similarity and hunks use the Myers algorithm.
 */
const diffOptions = [
  '--no-ext-diff',
  '--no-textconv',
  '--no-color',
  '--find-renames=50%',
  '--diff-algorithm=myers',
  '--no-indent-heuristic',
  '--ignore-submodules=none',
];

/**
 * Keeps blob IDs needed for classification and hunks before producing a public GitChange.
 * Example: a rename records both paths while its before/after blobs may be identical.
 */
interface RawChange {
  readonly beforePath: string | null;
  readonly afterPath: string | null;
  readonly beforeMode: string | null;
  readonly afterMode: string | null;
  readonly beforeBlob: string;
  readonly afterBlob: string;
  readonly status: GitChange['status'];
}

/* Pinned snapshots can reuse a completed inventory when its byte limits match. */
const inventories = new WeakMap<
  GitSnapshot,
  {
    maxBlobBytes: number;
    maxGitOutputBytes: number;
    changes: readonly GitChange[];
  }
>();

/**
 * Makes malformed Git output an explicit failure rather than a plausible empty result.
 * Example: a raw record missing its second blob ID cannot become a valid change.
 */
function invalidOutput(): GitOperationError {
  return new GitOperationError(
    'invalid_git_output',
    'Git returned an unexpected change representation.',
  );
}

/**
 * Rejects lossy decoding so two different byte paths cannot collapse into one displayed name.
 * Example: invalid UTF-8 fails instead of becoming a replacement character in a filename.
 */
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

/**
 * Parses NUL-separated raw records so whitespace in filenames never becomes a separator.
 * Example: a filename containing a tab or newline remains one path; a rename consumes two.
 */
function parseChanges(bytes: Buffer): RawChange[] {
  let offset = 0;

  /**
   * Reads one complete raw field without interpreting filename characters.
   * Example: a newline belongs to the filename; only the next NUL ends the field.
   */
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

/**
 * Checks size before loading bytes, then distinguishes supported text from binary or invalid text.
 * Example: a NUL-containing blob is binary; an oversized blob is left unread.
 */
async function blobKind(
  oid: string,
  directory: string,
  options: GitOperationOptions,
): Promise<'text' | 'binary' | 'unsupported'> {
  let bytes: Buffer;

  try {
    bytes = await readBlobBytes(oid, directory, options);
  } catch (error) {
    if (
      error instanceof GitBlobUnavailableError &&
      error.reason === 'too_large'
    ) {
      return 'unsupported';
    }

    throw error;
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

/**
 * Checks file modes before reading content so special entries are never treated as ordinary files.
 * Example: mode 120000 identifies a symlink, whose target must not be followed.
 */
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

/**
 * Keeps edit coordinates from patch headers without parsing source text as metadata.
 * Example: @@ -5,0 +6,2 @@ means two lines were inserted after old line 5.
 */
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

/**
 * Builds a stable, frozen inventory from merge base to head while holding the snapshot open.
 * Example: a commit only on the target branch is excluded; an unchanged rename has no hunks.
 */
export async function listSnapshotChanges(
  snapshot: GitSnapshot,
  options: GitOperationOptions,
): Promise<readonly GitChange[]> {
  return withSnapshot(snapshot, options, async (directory, operation) => {
    const { maxBlobBytes, maxGitOutputBytes } = operation.limits;
    const cached = inventories.get(snapshot);

    /* Keep this inside the lease so cache hits still reject closed or cancelled snapshots. */
    if (
      cached?.maxBlobBytes === maxBlobBytes &&
      cached.maxGitOutputBytes === maxGitOutputBytes
    ) {
      return cached.changes;
    }

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

    const inventory = Object.freeze(changes);
    inventories.set(snapshot, {
      maxBlobBytes,
      maxGitOutputBytes,
      changes: inventory,
    });

    return inventory;
  });
}

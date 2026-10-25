import {
  GitOperationError,
  listSnapshotChanges,
  searchSnapshot,
} from '@daphne/git-source';
import type {
  GitChange,
  GitOperationOptions,
  GitSnapshot,
} from '@daphne/git-source';
import type {
  Change,
  ContextNotice,
  Side,
  ToolEntry,
  ToolRequest,
} from '../contracts.js';
import { EvidenceInputError, SourceUnavailableError } from '../errors.js';
import { readEvidenceBlob, readSource, sourceFromBlob } from '../source.js';
import { hunkWindows } from './hunks.js';
import { readLineWindow } from './lines.js';

export type Observation =
  | { readonly kind: 'entry'; readonly entry: ToolEntry }
  | { readonly kind: 'notice'; readonly notice: ContextNotice };

export function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    const timedOut =
      signal.reason instanceof DOMException &&
      signal.reason.name === 'TimeoutError';
    throw new GitOperationError(
      timedOut ? 'timeout' : 'cancelled',
      'Repository tool execution was interrupted.',
    );
  }
}

function changeData(change: GitChange): Change {
  return Object.freeze({
    id: change.id,
    beforePath: change.beforePath,
    afterPath: change.afterPath,
    beforeMode: change.beforeMode,
    afterMode: change.afterMode,
    status: change.status,
    kind: change.kind,
    hunks: Object.freeze(
      change.hunks.map((hunk) =>
        Object.freeze({
          beforeStartLine: hunk.beforeStartLine,
          beforeLineCount: hunk.beforeLineCount,
          afterStartLine: hunk.afterStartLine,
          afterLineCount: hunk.afterLineCount,
        }),
      ),
    ),
  });
}

function unavailable(error: unknown, path: string): Observation {
  if (!(error instanceof SourceUnavailableError)) {
    throw error;
  }

  return {
    kind: 'notice',
    notice: Object.freeze({ code: error.reason, message: error.message, path }),
  };
}

async function* inspect(
  snapshot: GitSnapshot,
  change: Change,
  options: GitOperationOptions,
): AsyncGenerator<Observation> {
  yield { kind: 'entry', entry: Object.freeze({ kind: 'change', change }) };

  if (change.kind !== 'text') {
    yield {
      kind: 'notice',
      notice: Object.freeze({
        code: change.kind,
        message: 'This change has no supported source windows.',
        path: change.afterPath ?? change.beforePath,
      }),
    };
    return;
  }

  if (change.hunks.length === 0) {
    return;
  }

  const sides: readonly Side[] = ['base', 'head'];

  for (const side of sides) {
    const path = side === 'base' ? change.beforePath : change.afterPath;

    if (path === null) {
      continue;
    }

    try {
      const blob = await readEvidenceBlob(snapshot, { side, path }, options);

      for (const range of hunkWindows(blob.bytes, change, side)) {
        checkCancellation(options.signal);
        const source = sourceFromBlob(snapshot, side, blob, range);
        yield {
          kind: 'entry',
          entry: Object.freeze({ kind: 'source', source }),
        };
      }
    } catch (error) {
      yield unavailable(error, path);
    }
  }
}

function preview(bytes: Buffer, startByte: number): string {
  const windowStart = Math.max(0, startByte - 80);
  const window = bytes.subarray(windowStart, windowStart + 240);
  const matchOffset = startByte - windowStart;
  const precedingNewline =
    matchOffset === 0 ? -1 : window.lastIndexOf(10, matchOffset - 1);
  const followingNewline = window.indexOf(10, matchOffset);
  let start = windowStart + precedingNewline + 1;
  let end =
    windowStart + (followingNewline < 0 ? window.length : followingNewline);

  while (start < end && ((bytes[start] ?? 0) & 0xc0) === 0x80) {
    start += 1;
  }

  while (
    end > start &&
    end < bytes.length &&
    ((bytes[end] ?? 0) & 0xc0) === 0x80
  ) {
    end -= 1;
  }

  return bytes.subarray(start, end).toString('utf8');
}

async function* search(
  snapshot: GitSnapshot,
  request: Extract<ToolRequest, { name: 'search_code' }>,
  options: GitOperationOptions,
): AsyncGenerator<Observation> {
  const input = { side: request.side, query: request.query };
  const raw = await searchSnapshot(
    snapshot,
    request.pathPrefix === null
      ? input
      : { ...input, pathPrefix: request.pathPrefix },
    options,
  );
  const needle = Buffer.from(request.query);
  let offset = 0;

  while (offset < raw.length) {
    checkCancellation(options.signal);
    const end = raw.indexOf(0, offset);
    // git-source validated the commit prefix and UTF-8 path in each NUL-delimited record.
    const path = raw.subarray(offset + 41, end).toString('utf8');
    offset = end + 1;

    try {
      const blob = await readEvidenceBlob(
        snapshot,
        { side: request.side, path },
        options,
      );
      let match = blob.bytes.indexOf(needle);
      let line = 1;
      let newline = blob.bytes.indexOf(10);

      while (match >= 0) {
        checkCancellation(options.signal);

        while (newline >= 0 && newline < match) {
          line += 1;
          newline = blob.bytes.indexOf(10, newline + 1);
        }

        const range = Object.freeze({
          startByte: match,
          endByte: match + needle.length,
        });
        const entry: ToolEntry = Object.freeze({
          kind: 'search_hit',
          side: request.side,
          path,
          range,
          line,
          preview: preview(blob.bytes, range.startByte),
        });

        yield { kind: 'entry', entry };
        match = blob.bytes.indexOf(needle, range.endByte);
      }
    } catch (error) {
      yield unavailable(error, path);
    }
  }
}

/** Produces a deterministic stream; pagination never stores the complete response history. */
export async function* observations(
  snapshot: GitSnapshot,
  request: ToolRequest,
  options: GitOperationOptions,
): AsyncGenerator<Observation> {
  checkCancellation(options.signal);

  switch (request.name) {
    case 'list_changes':
    case 'inspect_change': {
      const changes = await listSnapshotChanges(snapshot, options);

      if (request.name === 'list_changes') {
        for (const change of changes) {
          checkCancellation(options.signal);
          yield {
            kind: 'entry',
            entry: Object.freeze({
              kind: 'change',
              change: changeData(change),
            }),
          };
        }
      } else {
        const change = changes.find(
          (candidate) => candidate.id === request.changeId,
        );

        if (!change) {
          throw new EvidenceInputError(
            'The change ID does not exist in this snapshot.',
          );
        }

        yield* inspect(snapshot, changeData(change), options);
      }

      return;
    }
    case 'read_source':
      try {
        const source = await readSource(snapshot, request, options);
        yield {
          kind: 'entry',
          entry: Object.freeze({ kind: 'source', source }),
        };
      } catch (error) {
        yield unavailable(error, request.path);
      }

      return;
    case 'read_source_lines':
      try {
        const read = await readLineWindow(snapshot, request, options);

        if (read.kind === 'unavailable') {
          yield { kind: 'notice', notice: read.notice };
        } else {
          yield { kind: 'entry', entry: read.window };
          yield {
            kind: 'entry',
            entry: Object.freeze({ kind: 'source', source: read.source }),
          };
        }
      } catch (error) {
        yield unavailable(error, request.path);
      }

      return;
    case 'search_code':
      yield* search(snapshot, request, options);
      return;
  }
}

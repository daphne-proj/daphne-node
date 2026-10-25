import type {
  ByteRange,
  Change,
  ContextNotice,
  ReviewIdentity,
  Side,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from '@daphne/review-evidence/contracts';
import { ContextInputError } from './errors.js';

export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ContextInputError('An evidence data object is required.');
  }

  return Object.fromEntries(Object.entries(value));
}

export function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ContextInputError('An evidence data array is required.');
  }

  return value;
}

/* Reject text that UTF-8 encoding would replace so stored byte ranges continue to describe the supplied text exactly. */
export function string(value: unknown, allowEmpty = false): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && value.length === 0) ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new ContextInputError('Well-formed UTF-8 text is required.');
  }

  return value;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

export function integer(value: unknown, minimum = 0): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new ContextInputError(
      'A safe integer within the required bounds is required.',
    );
  }

  return value;
}

function side(value: unknown): Side {
  if (value !== 'base' && value !== 'head') {
    throw new ContextInputError('Evidence side must be base or head.');
  }

  return value;
}

function range(value: unknown): ByteRange {
  const input = object(value);
  const startByte = integer(input.startByte);
  const endByte = integer(input.endByte, startByte);

  return Object.freeze({ startByte, endByte });
}

export function identity(value: unknown): ReviewIdentity {
  const input = object(value);

  return Object.freeze({
    sessionId: string(input.sessionId),
    repositoryUrl: string(input.repositoryUrl),
    targetCommit: string(input.targetCommit),
    baseCommit: string(input.baseCommit),
    headCommit: string(input.headCommit),
  });
}

/* Check the excerpt's session, committed side and byte length while leaving verification against actual repository bytes to the evidence producer. */
export function source(
  value: unknown,
  session: ReviewIdentity,
): SourceEvidence {
  const input = object(value);
  const reference = object(input.ref);
  const selectedSide = side(reference.side);
  const ref = Object.freeze({
    sessionId: string(reference.sessionId),
    side: selectedSide,
    commit: string(reference.commit),
    path: string(reference.path),
    blobId: string(reference.blobId),
    range: range(reference.range),
  });
  const text = string(input.text, true);
  const expectedCommit =
    selectedSide === 'base' ? session.baseCommit : session.headCommit;

  if (ref.sessionId !== session.sessionId || ref.commit !== expectedCommit) {
    throw new ContextInputError(
      'Source identity does not match the context session and side.',
    );
  }

  if (Buffer.byteLength(text) !== ref.range.endByte - ref.range.startByte) {
    throw new ContextInputError(
      'Source text length does not match its byte range.',
    );
  }

  return Object.freeze({ ref, text });
}

export function notice(value: unknown): ContextNotice {
  const input = object(value);

  return Object.freeze({
    code: string(input.code),
    message: string(input.message),
    path: nullableString(input.path),
  });
}

/* Require the producer's normalized request, including explicit defaults, so query identity survives recording and JSON reconstruction. */
export function request(value: unknown): ToolRequest {
  const input = object(value);
  const common = {
    cursor: nullableString(input.cursor),
    maxBytes: integer(input.maxBytes, 1),
  };

  switch (input.name) {
    case 'list_changes':
      return Object.freeze({
        ...common,
        name: 'list_changes',
        pageSize: integer(input.pageSize, 1),
      });
    case 'inspect_change':
      return Object.freeze({
        ...common,
        name: 'inspect_change',
        changeId: string(input.changeId),
      });
    case 'read_source':
      return Object.freeze({
        ...common,
        name: 'read_source',
        side: side(input.side),
        path: string(input.path),
        range: range(input.range),
      });
    case 'read_source_lines': {
      const startLine = integer(input.startLine, 1);
      const lineCount = integer(input.lineCount, 1);
      integer(startLine + (lineCount - 1), 1);

      return Object.freeze({
        ...common,
        name: 'read_source_lines',
        side: side(input.side),
        path: string(input.path),
        startLine,
        lineCount,
      });
    }
    case 'search_code':
      return Object.freeze({
        ...common,
        name: 'search_code',
        side: side(input.side),
        query: string(input.query),
        pathPrefix: nullableString(input.pathPrefix),
        pageSize: integer(input.pageSize, 1),
      });
    default:
      throw new ContextInputError('Unknown tool-result request kind.');
  }
}

export function change(value: unknown): Change {
  const input = object(value);
  const { status, kind } = input;

  if (
    status !== 'added' &&
    status !== 'deleted' &&
    status !== 'modified' &&
    status !== 'renamed' &&
    status !== 'type-changed'
  ) {
    throw new ContextInputError('Unknown change status.');
  }

  if (
    kind !== 'text' &&
    kind !== 'binary' &&
    kind !== 'symlink' &&
    kind !== 'submodule' &&
    kind !== 'unsupported'
  ) {
    throw new ContextInputError('Unknown change kind.');
  }

  return Object.freeze({
    id: string(input.id),
    beforePath: nullableString(input.beforePath),
    afterPath: nullableString(input.afterPath),
    beforeMode: nullableString(input.beforeMode),
    afterMode: nullableString(input.afterMode),
    status,
    kind,
    hunks: Object.freeze(
      array(input.hunks).map((value) => {
        const hunk = object(value);

        return Object.freeze({
          beforeStartLine: integer(hunk.beforeStartLine),
          beforeLineCount: integer(hunk.beforeLineCount),
          afterStartLine: integer(hunk.afterStartLine),
          afterLineCount: integer(hunk.afterLineCount),
        });
      }),
    ),
  });
}

/* Reject entry kinds and coordinates that contradict the recorded request before retaining the page. */
function entry(
  value: unknown,
  session: ReviewIdentity,
  query: ToolRequest,
): ToolEntry {
  const input = object(value);

  switch (input.kind) {
    case 'source': {
      if (
        query.name !== 'read_source' &&
        query.name !== 'read_source_lines' &&
        query.name !== 'inspect_change'
      ) {
        throw new ContextInputError('This tool cannot supply source entries.');
      }

      const evidence = source(input.source, session);

      if (
        query.name === 'read_source' &&
        (evidence.ref.side !== query.side ||
          evidence.ref.path !== query.path ||
          evidence.ref.range.startByte < query.range.startByte ||
          evidence.ref.range.endByte > query.range.endByte)
      ) {
        throw new ContextInputError(
          'Source entry is outside the recorded request.',
        );
      }

      return Object.freeze({ kind: 'source', source: evidence });
    }
    case 'source_window': {
      const selectedSide = side(input.side);
      const path = string(input.path);
      const selectedRange = range(input.range);
      const startLine = integer(input.startLine);
      const endLine = integer(input.endLine, startLine);
      const totalLines = integer(input.totalLines, endLine);

      if (
        query.name !== 'read_source_lines' ||
        selectedSide !== query.side ||
        path !== query.path ||
        startLine !== (totalLines === 0 ? 0 : query.startLine) ||
        (totalLines === 0 &&
          (query.startLine !== 1 ||
            selectedRange.startByte !== 0 ||
            selectedRange.endByte !== 0)) ||
        endLine !==
          Math.min(totalLines, query.startLine + (query.lineCount - 1)) ||
        input.eofClamped !==
          query.startLine + (query.lineCount - 1) > totalLines
      ) {
        throw new ContextInputError(
          'Source window is outside the recorded line request.',
        );
      }

      return Object.freeze({
        kind: 'source_window',
        side: selectedSide,
        path,
        range: selectedRange,
        startLine,
        endLine,
        totalLines,
        eofClamped: input.eofClamped,
      });
    }
    case 'change': {
      const data = change(input.change);

      if (
        (query.name !== 'list_changes' && query.name !== 'inspect_change') ||
        (query.name === 'inspect_change' && data.id !== query.changeId)
      ) {
        throw new ContextInputError(
          'Change entry does not match the recorded request.',
        );
      }

      return Object.freeze({ kind: 'change', change: data });
    }
    case 'search_hit': {
      const selectedSide = side(input.side);
      const path = string(input.path);
      const hitRange = range(input.range);

      if (
        query.name !== 'search_code' ||
        selectedSide !== query.side ||
        (query.pathPrefix !== null && !path.startsWith(query.pathPrefix)) ||
        hitRange.endByte - hitRange.startByte !== Buffer.byteLength(query.query)
      ) {
        throw new ContextInputError(
          'Search navigation is outside the recorded request.',
        );
      }

      return Object.freeze({
        kind: 'search_hit',
        side: selectedSide,
        path,
        range: hitRange,
        line: integer(input.line, 1),
        preview: string(input.preview, true),
      });
    }
    default:
      throw new ContextInputError('Unknown tool-result entry kind.');
  }
}

/* Capture a supplied tool page and reject contradictory completeness metadata before the ledger treats it as retrieval progress. */
export function result(value: unknown, session: ReviewIdentity): ToolResult {
  const input = object(value);
  const owner = identity(input.identity);

  if (JSON.stringify(owner) !== JSON.stringify(session)) {
    throw new ContextInputError(
      'Tool result belongs to a different evidence identity.',
    );
  }

  const query = request(input.request);
  const entries = Object.freeze(
    array(input.entries).map((value) => entry(value, session, query)),
  );
  const notices = Object.freeze(array(input.notices).map(notice));

  if (
    query.name === 'read_source_lines' &&
    (entries.length > 0 || input.completeness === 'complete')
  ) {
    const windows = entries.filter((item) => item.kind === 'source_window');
    const window = windows[0];
    const sources = entries.filter((item) => item.kind === 'source');

    /* Each fragment belongs to the selected window, even when a page splits a long line. */
    if (
      windows.length !== 1 ||
      !window ||
      sources.length === 0 ||
      sources.some(
        ({ source }) =>
          source.ref.side !== window.side ||
          source.ref.path !== window.path ||
          source.ref.range.startByte < window.range.startByte ||
          source.ref.range.endByte > window.range.endByte,
      )
    ) {
      throw new ContextInputError(
        'Line-read sources do not match their window metadata.',
      );
    }
  }

  const nextCursor = nullableString(input.nextCursor);
  const { completeness } = input;

  if (
    completeness !== 'complete' &&
    completeness !== 'partial' &&
    completeness !== 'unavailable'
  ) {
    throw new ContextInputError('Unknown tool completeness.');
  }

  if (
    (completeness === 'complete' &&
      (nextCursor !== null || notices.length > 0)) ||
    (completeness === 'unavailable' &&
      (entries.length > 0 || nextCursor !== null || notices.length === 0)) ||
    (completeness === 'partial' &&
      nextCursor === null &&
      notices.length === 0) ||
    (nextCursor !== null && entries.length === 0 && notices.length === 0)
  ) {
    throw new ContextInputError(
      'Tool completeness contradicts its continuation or observations.',
    );
  }

  return Object.freeze({
    identity: owner,
    request: query,
    entries,
    completeness,
    nextCursor,
    notices,
  });
}

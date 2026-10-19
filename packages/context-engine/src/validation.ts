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

function change(value: unknown): Change {
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

function entry(
  value: unknown,
  session: ReviewIdentity,
  query: ToolRequest,
): ToolEntry {
  const input = object(value);

  switch (input.kind) {
    case 'source': {
      if (query.name !== 'read_source' && query.name !== 'inspect_change') {
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

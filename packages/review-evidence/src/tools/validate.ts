import type { ByteRange, Side, ToolRequest } from '../contracts.js';
import { EvidenceInputError } from '../errors.js';
import { defaultEvidenceLimits } from '../limits.js';

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new EvidenceInputError('A tool request object is required.');
  }

  return Object.fromEntries(Object.entries(value));
}

function keys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  if (Object.keys(input).some((key) => !allowed.includes(key))) {
    throw new EvidenceInputError('The tool request contains an unknown field.');
  }
}

function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value ||
    Buffer.byteLength(value) > defaultEvidenceLimits.maxToolBytes
  ) {
    throw new EvidenceInputError(
      'A nonempty, bounded UTF-8 string without NUL is required.',
    );
  }

  return value;
}

function path(value: unknown, prefix = false): string {
  const result = text(value);
  const components = (
    prefix && result.endsWith('/') ? result.slice(0, -1) : result
  ).split('/');

  if (components.some((part) => part === '' || part === '.' || part === '..')) {
    throw new EvidenceInputError(
      'A literal repository-relative path is required.',
    );
  }

  return result;
}

function side(value: unknown): Side {
  if (value !== 'base' && value !== 'head') {
    throw new EvidenceInputError('The source side must be base or head.');
  }

  return value;
}

function positive(value: unknown, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > fallback
  ) {
    throw new EvidenceInputError(
      'Page limits must be positive safe integers no greater than their defaults.',
    );
  }

  return value;
}

function range(value: unknown): ByteRange {
  const input = record(value);
  keys(input, ['startByte', 'endByte']);
  const { startByte, endByte } = input;

  if (
    typeof startByte !== 'number' ||
    typeof endByte !== 'number' ||
    !Number.isSafeInteger(startByte) ||
    !Number.isSafeInteger(endByte) ||
    startByte < 0 ||
    endByte < startByte
  ) {
    throw new EvidenceInputError(
      'A nonnegative half-open range of safe byte offsets is required.',
    );
  }

  return Object.freeze({ startByte, endByte });
}

/** Captures and validates untrusted requests before any repository work. */
export function parseToolRequest(value: unknown): ToolRequest {
  const input = record(value);
  const commonKeys = ['name', 'cursor', 'maxBytes'];
  let cursor: string | null = null;

  if (input.cursor !== undefined && input.cursor !== null) {
    cursor = text(input.cursor);

    if (cursor.length > 128) {
      throw new EvidenceInputError('The continuation cursor is invalid.');
    }
  }

  const common = {
    cursor,
    maxBytes: positive(input.maxBytes, defaultEvidenceLimits.maxToolBytes),
  };

  switch (input.name) {
    case 'list_changes':
      keys(input, [...commonKeys, 'pageSize']);
      return Object.freeze({
        ...common,
        name: 'list_changes',
        pageSize: positive(
          input.pageSize,
          defaultEvidenceLimits.maxPageEntries,
        ),
      });
    case 'inspect_change':
      keys(input, [...commonKeys, 'changeId']);
      return Object.freeze({
        ...common,
        name: 'inspect_change',
        changeId: text(input.changeId),
      });
    case 'read_source':
      keys(input, [...commonKeys, 'side', 'path', 'range']);
      return Object.freeze({
        ...common,
        name: 'read_source',
        side: side(input.side),
        path: path(input.path),
        range: range(input.range),
      });
    case 'read_source_lines': {
      keys(input, [...commonKeys, 'side', 'path', 'startLine', 'lineCount']);
      const { startLine, lineCount } = input;

      if (
        typeof startLine !== 'number' ||
        typeof lineCount !== 'number' ||
        !Number.isSafeInteger(startLine) ||
        !Number.isSafeInteger(lineCount) ||
        startLine < 1 ||
        lineCount < 1 ||
        !Number.isSafeInteger(startLine + (lineCount - 1))
      ) {
        throw new EvidenceInputError(
          'Line coordinates must be positive safe integers with a safe ending line.',
        );
      }

      return Object.freeze({
        ...common,
        name: 'read_source_lines',
        side: side(input.side),
        path: path(input.path),
        startLine,
        lineCount,
      });
    }
    case 'search_code': {
      keys(input, [...commonKeys, 'side', 'query', 'pathPrefix', 'pageSize']);
      const query = text(input.query);

      if (query.includes('\n') || query.includes('\r')) {
        throw new EvidenceInputError(
          'Search queries must be single-line literal text.',
        );
      }

      return Object.freeze({
        ...common,
        name: 'search_code',
        side: side(input.side),
        query,
        pathPrefix:
          input.pathPrefix === undefined || input.pathPrefix === null
            ? null
            : path(input.pathPrefix, true),
        pageSize: positive(
          input.pageSize,
          defaultEvidenceLimits.maxPageEntries,
        ),
      });
    }
    default:
      throw new EvidenceInputError('Unknown repository tool.');
  }
}

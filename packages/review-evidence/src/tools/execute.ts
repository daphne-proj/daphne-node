import { setImmediate } from 'node:timers/promises';
import type { GitOperationOptions, GitSnapshot } from '@daphne/git-source';
import type {
  ContextNotice,
  ReviewIdentity,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
  ToolResult,
} from '../contracts.js';
import { EvidenceInputError, EvidenceLimitError } from '../errors.js';
import type { EvidenceLimits } from '../limits.js';
import { createCursorCodec } from './cursor.js';
import { checkCancellation, observations } from './operations.js';
import { parseToolRequest } from './validate.js';

function byteLength(result: ToolResult): number {
  return Buffer.byteLength(JSON.stringify(result), 'utf8');
}

function boundary(bytes: Buffer, offset: number): number {
  while (
    offset > 0 &&
    offset < bytes.length &&
    ((bytes[offset] ?? 0) & 0xc0) === 0x80
  ) {
    offset -= 1;
  }

  return offset;
}

function sourceSlice(
  source: SourceEvidence,
  bytes: Buffer,
  start: number,
  end: number,
): ToolEntry {
  const range = Object.freeze({
    startByte: source.ref.range.startByte + start,
    endByte: source.ref.range.startByte + end,
  });

  return Object.freeze({
    kind: 'source',
    source: Object.freeze({
      ref: Object.freeze({ ...source.ref, range }),
      text: bytes.subarray(start, end).toString('utf8'),
    }),
  });
}

const earlierUnavailable: ContextNotice = Object.freeze({
  code: 'earlier_unavailable',
  message:
    'Earlier pages reported unavailable evidence; this query is incomplete.',
  path: null,
});

/** Keeps only the current page and one lookahead item; tokens contain authenticated positions. */
export function createToolExecutor(
  snapshot: GitSnapshot,
  identity: ReviewIdentity,
  operation: GitOperationOptions,
  limits: EvidenceLimits,
): (input: unknown) => Promise<ToolResult> {
  const cursors = createCursorCodec();

  return async (input: unknown): Promise<ToolResult> => {
    checkCancellation(operation.signal);
    const parsed = parseToolRequest(input);
    const pageSize =
      'pageSize' in parsed
        ? Math.min(parsed.pageSize, limits.maxPageEntries)
        : limits.maxPageEntries;
    const request: ToolRequest = Object.freeze({
      ...parsed,
      ...('pageSize' in parsed ? { pageSize } : {}),
      maxBytes: Math.min(parsed.maxBytes, limits.maxToolBytes),
    });
    const query = cursors.query(request, pageSize);
    const position = cursors.decode(query, request.cursor);
    const entries: ToolEntry[] = [];
    const notices: ContextNotice[] = [];
    let hadUnavailable = false;
    let hadEntries = position.offset > 0;

    function result(
      nextCursor: string | null,
      candidateEntries: readonly ToolEntry[] = entries,
      candidateNotices: readonly ContextNotice[] = notices,
    ): ToolResult {
      const unavailable = hadUnavailable || candidateNotices.length > 0;
      let completeness: ToolResult['completeness'] = 'complete';

      if (nextCursor !== null) {
        completeness = 'partial';
      } else if (unavailable) {
        completeness =
          hadEntries || candidateEntries.length > 0 ? 'partial' : 'unavailable';
      }

      const pageNotices =
        unavailable && candidateNotices.length === 0
          ? [earlierUnavailable]
          : candidateNotices;

      return Object.freeze({
        identity,
        request,
        entries: Object.freeze([...candidateEntries]),
        completeness,
        nextCursor,
        notices: Object.freeze([...pageNotices]),
      });
    }

    function fits(candidate: ToolResult): boolean {
      return byteLength(candidate) <= request.maxBytes;
    }

    function finish(candidate: ToolResult): ToolResult {
      checkCancellation(operation.signal);

      if (!fits(candidate)) {
        throw new EvidenceLimitError(
          'The complete tool response cannot fit its byte allowance.',
        );
      }

      return candidate;
    }

    if (!fits(result(null))) {
      throw new EvidenceLimitError(
        'The tool response envelope cannot fit its byte allowance.',
      );
    }

    const iterator = observations(snapshot, request, operation);
    let index = 0;
    let progressed = false;

    try {
      let current = await iterator.next();

      /* Repeat the selected window on every page; cursor offsets address source only. */
      if (
        request.name === 'read_source_lines' &&
        !current.done &&
        current.value.kind === 'entry' &&
        current.value.entry.kind === 'source_window'
      ) {
        if (pageSize < 2) {
          throw new EvidenceLimitError(
            'A line-read page needs room for its window metadata and source entry.',
          );
        }

        entries.push(current.value.entry);
        current = await iterator.next();
      }

      while (!current.done && index < position.index) {
        // Async-generator microtasks alone cannot deliver timers or user cancellation.
        if (index % 128 === 0) {
          await setImmediate();
        }

        checkCancellation(operation.signal);

        if (current.value.kind === 'notice') {
          hadUnavailable = true;
        } else {
          hadEntries = true;
        }

        index += 1;
        current = await iterator.next();
      }

      if (current.done) {
        if (position.index !== 0 || position.offset !== 0) {
          throw new EvidenceInputError(
            'The cursor position is outside this query.',
          );
        }

        return finish(result(null));
      }

      while (!current.done) {
        checkCancellation(operation.signal);
        const item = current.value;
        const offset = index === position.index ? position.offset : 0;
        const resume = cursors.encode(query, { index, offset });
        const count = item.kind === 'entry' ? entries.length : notices.length;

        if (count >= pageSize) {
          return finish(result(resume));
        }

        const next = await iterator.next();
        const nextCursor = next.done
          ? null
          : cursors.encode(query, { index: index + 1, offset: 0 });

        if (item.kind === 'notice') {
          if (offset !== 0) {
            throw new EvidenceInputError(
              'A notice cursor cannot contain a source offset.',
            );
          }

          const candidate = result(nextCursor, entries, [
            ...notices,
            item.notice,
          ]);

          if (!fits(candidate)) {
            if (!progressed) {
              throw new EvidenceLimitError(
                'An indivisible notice cannot fit the tool response.',
              );
            }

            return finish(result(resume));
          }

          notices.push(item.notice);
          hadUnavailable = true;
        } else {
          const entry = item.entry;
          let candidateEntry = entry;
          let bytes: Buffer | undefined;

          if (entry.kind === 'source') {
            bytes = Buffer.from(entry.source.text);

            if (
              offset > bytes.length ||
              boundary(bytes, offset) !== offset ||
              (offset === bytes.length && offset !== 0)
            ) {
              throw new EvidenceInputError(
                'The cursor is not a valid source continuation.',
              );
            }

            candidateEntry = sourceSlice(
              entry.source,
              bytes,
              offset,
              bytes.length,
            );
          } else if (offset !== 0) {
            throw new EvidenceInputError(
              'Only source entries support byte continuations.',
            );
          }

          const candidate = result(nextCursor, [...entries, candidateEntry]);

          if (!fits(candidate)) {
            if (entry.kind === 'source' && bytes !== undefined) {
              // Find the largest UTF-8-safe prefix whose entire response, including cursor, fits.
              let low = offset;
              let high = bytes.length - 1;

              while (low < high) {
                const middle = Math.floor((low + high + 1) / 2);
                const end = boundary(bytes, middle);
                const prefix = sourceSlice(entry.source, bytes, offset, end);
                const cursor = cursors.encode(query, { index, offset: end });

                if (fits(result(cursor, [...entries, prefix]))) {
                  low = middle;
                } else {
                  high = middle - 1;
                }
              }

              const end = boundary(bytes, low);

              if (end > offset) {
                const prefix = sourceSlice(entry.source, bytes, offset, end);
                return finish(
                  result(cursors.encode(query, { index, offset: end }), [
                    ...entries,
                    prefix,
                  ]),
                );
              }
            }

            if (!progressed) {
              throw new EvidenceLimitError(
                'An indivisible entry or source character cannot fit the tool response.',
              );
            }

            return finish(result(resume));
          }

          entries.push(candidateEntry);
          hadEntries = true;
        }

        progressed = true;
        index += 1;
        current = next;
      }

      return finish(result(null));
    } finally {
      await iterator.return(undefined);
    }
  };
}

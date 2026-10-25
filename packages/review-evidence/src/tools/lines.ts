import type { GitOperationOptions, GitSnapshot } from '@daphne/git-source';
import type {
  ContextNotice,
  SourceEvidence,
  ToolEntry,
  ToolRequest,
} from '../contracts.js';
import { readEvidenceBlob, sourceFromBlob } from '../source.js';
import { lineBoundaries, lineRangeToBytes } from './hunks.js';

type LineRead =
  | {
      kind: 'available';
      window: Extract<ToolEntry, { kind: 'source_window' }>;
      source: SourceEvidence;
    }
  | { kind: 'unavailable'; notice: ContextNotice };

export async function readLineWindow(
  snapshot: GitSnapshot,
  request: Extract<ToolRequest, { name: 'read_source_lines' }>,
  options: GitOperationOptions,
): Promise<LineRead> {
  const blob = await readEvidenceBlob(snapshot, request, options);
  const offsets = lineBoundaries(blob.bytes);

  const totalLines = offsets.length - 1;
  const requestedEnd = request.startLine + (request.lineCount - 1);

  if (request.startLine > Math.max(1, totalLines)) {
    return {
      kind: 'unavailable',
      notice: Object.freeze({
        code: 'line_out_of_range',
        message:
          totalLines === 0
            ? 'This file has zero lines. Read from line 1 to retrieve its empty source.'
            : `The requested start is beyond EOF. Valid lines are 1 through ${String(totalLines)}.`,
        path: request.path,
      }),
    };
  }

  /* A trailing LF terminates its line; an empty file has no line to number. */
  const startLine = totalLines === 0 ? 0 : request.startLine;
  const endLine = Math.min(requestedEnd, totalLines);
  const lineCount = totalLines === 0 ? 0 : endLine - startLine + 1;

  const range = Object.freeze(
    lineRangeToBytes(blob.bytes, startLine, lineCount, offsets),
  );

  const window = Object.freeze({
    kind: 'source_window' as const,
    side: request.side,
    path: request.path,
    range,
    startLine,
    endLine,
    totalLines,
    eofClamped: requestedEnd > totalLines,
  });

  /* Resolve once to original byte offsets; never decorate the source with line numbers. */
  return {
    kind: 'available',
    window,
    source: sourceFromBlob(snapshot, request.side, blob, range),
  };
}

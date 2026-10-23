import type { ByteRange, Change, Side } from '../contracts.js';
import { EvidenceInputError } from '../errors.js';

export function lineBoundaries(bytes: Buffer): readonly number[] {
  const offsets = [0];

  if (bytes.length === 0) {
    return offsets;
  }

  for (
    let index = bytes.indexOf(10);
    index >= 0;
    index = bytes.indexOf(10, index + 1)
  ) {
    if (index + 1 < bytes.length) {
      offsets.push(index + 1);
    }
  }

  offsets.push(bytes.length);

  return offsets;
}

/** Zero-count Git hunks anchor after startLine; other starts are one-based. */
export function lineRangeToBytes(
  bytes: Buffer,
  startLine: number,
  lineCount: number,
  offsets: readonly number[] = lineBoundaries(bytes),
): ByteRange {
  const first = lineCount === 0 ? startLine : startLine - 1;
  const startByte = offsets[first];
  const endByte = offsets[first + lineCount];

  if (
    !Number.isSafeInteger(startLine) ||
    !Number.isSafeInteger(lineCount) ||
    lineCount < 0 ||
    first < 0 ||
    startByte === undefined ||
    endByte === undefined
  ) {
    throw new EvidenceInputError(
      'Hunk coordinates exceed the committed source.',
    );
  }

  return { startByte, endByte };
}

export function hunkWindows(
  bytes: Buffer,
  change: Change,
  side: Side,
): readonly ByteRange[] {
  const offsets = lineBoundaries(bytes);
  const totalLines = offsets.length - 1;
  const windows: { start: number; end: number }[] = [];

  for (const hunk of change.hunks) {
    const startLine =
      side === 'base' ? hunk.beforeStartLine : hunk.afterStartLine;
    const count = side === 'base' ? hunk.beforeLineCount : hunk.afterLineCount;
    lineRangeToBytes(bytes, startLine, count, offsets);
    const first = count === 0 ? startLine : startLine - 1;

    windows.push({
      start: Math.max(0, first - 3),
      end: Math.min(totalLines, first + count + 3),
    });
  }

  windows.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: { start: number; end: number }[] = [];

  for (const window of windows) {
    const previous = merged.at(-1);

    if (previous && window.start <= previous.end) {
      previous.end = Math.max(previous.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }

  return merged.map((window) => {
    const count = window.end - window.start;
    const start = count === 0 ? window.start : window.start + 1;

    return Object.freeze(lineRangeToBytes(bytes, start, count, offsets));
  });
}

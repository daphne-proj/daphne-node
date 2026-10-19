import {
  GitBlobUnavailableError,
  GitInputError,
  readSnapshotBlob,
} from '@daphne/git-source';
import type { GitOperationOptions, GitSnapshot } from '@daphne/git-source';
import type { ByteRange, Side, SourceEvidence } from './contracts.js';
import { EvidenceInputError, SourceUnavailableError } from './errors.js';

interface SourceInput {
  readonly side: Side;
  readonly path: string;
  readonly range: ByteRange;
}

function validateRange(range: unknown): asserts range is ByteRange {
  if (
    typeof range !== 'object' ||
    range === null ||
    !('startByte' in range) ||
    !('endByte' in range) ||
    typeof range.startByte !== 'number' ||
    typeof range.endByte !== 'number' ||
    !Number.isSafeInteger(range.startByte) ||
    !Number.isSafeInteger(range.endByte) ||
    range.startByte < 0 ||
    range.endByte < range.startByte
  ) {
    throw new EvidenceInputError(
      'A nonnegative half-open range of safe byte offsets is required.',
    );
  }
}

function parseSourceInput(input: unknown): SourceInput {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('side' in input) ||
    !('path' in input) ||
    !('range' in input) ||
    (input.side !== 'base' && input.side !== 'head') ||
    typeof input.path !== 'string'
  ) {
    throw new EvidenceInputError(
      'A base/head source side, path and byte range are required.',
    );
  }

  validateRange(input.range);

  return {
    side: input.side,
    path: input.path,
    range: Object.freeze({
      startByte: input.range.startByte,
      endByte: input.range.endByte,
    }),
  };
}

// UTF-8 continuation bytes (10xxxxxx) cannot start a source range boundary.
function isBoundary(bytes: Buffer, offset: number): boolean {
  return offset === bytes.length || ((bytes[offset] ?? 0) & 0xc0) !== 0x80;
}

// Validate the whole blob once, including bytes outside any requested excerpt.
function validateSourceBytes(bytes: Buffer): void {
  if (bytes.includes(0)) {
    throw new SourceUnavailableError(
      'binary',
      'Binary content is unavailable as source text.',
    );
  }

  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new SourceUnavailableError(
      'invalid_utf8',
      'The source is not valid UTF-8 text.',
    );
  }
}

// Only readEvidenceBlob supplies bytes here, so materializing many hunks need not revalidate the blob.
function sourceText(bytes: Buffer, range: ByteRange): string {
  if (range.endByte > bytes.length) {
    throw new EvidenceInputError(
      'The requested range exceeds the source byte length.',
    );
  }

  if (
    !isBoundary(bytes, range.startByte) ||
    !isBoundary(bytes, range.endByte)
  ) {
    throw new EvidenceInputError(
      'Source ranges must end on UTF-8 character boundaries.',
    );
  }

  return bytes.subarray(range.startByte, range.endByte).toString('utf8');
}

type SourceBlob = Awaited<ReturnType<typeof readSnapshotBlob>>;

/** Keeps unavailable-source translation and whole-blob text validation shared across tools. */
export async function readEvidenceBlob(
  snapshot: GitSnapshot,
  input: { readonly side: Side; readonly path: string },
  options: GitOperationOptions,
): Promise<SourceBlob> {
  let blob: SourceBlob;

  try {
    blob = await readSnapshotBlob(snapshot, input, options);
  } catch (error) {
    if (error instanceof GitBlobUnavailableError) {
      throw new SourceUnavailableError(error.reason, error.message);
    }

    if (error instanceof GitInputError) {
      throw new EvidenceInputError(error.message);
    }

    throw error;
  }

  validateSourceBytes(blob.bytes);

  return blob;
}

export function sourceFromBlob(
  snapshot: GitSnapshot,
  side: Side,
  blob: SourceBlob,
  range: ByteRange,
): SourceEvidence {
  validateRange(range);
  const capturedRange = Object.freeze({
    startByte: range.startByte,
    endByte: range.endByte,
  });
  const text = sourceText(blob.bytes, capturedRange);
  const ref = Object.freeze({
    sessionId: snapshot.identity.sessionId,
    side,
    commit: blob.commit,
    path: blob.path,
    blobId: blob.blobId,
    range: capturedRange,
  });

  return Object.freeze({ ref, text });
}

export async function readSource(
  snapshot: GitSnapshot,
  input: SourceInput,
  options: GitOperationOptions,
): Promise<SourceEvidence> {
  // Capture caller-owned data before awaiting I/O so the reference describes the bytes read.
  const { side, path, range } = parseSourceInput(input);
  const blob = await readEvidenceBlob(snapshot, { side, path }, options);

  return sourceFromBlob(snapshot, side, blob, range);
}

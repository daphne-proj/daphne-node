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

// Text validation belongs here; Git exposes bytes without interpreting their encoding.
function sourceText(bytes: Buffer, range: ByteRange): string {
  if (range.endByte > bytes.length) {
    throw new EvidenceInputError(
      'The requested range exceeds the source byte length.',
    );
  }

  if (bytes.includes(0)) {
    throw new SourceUnavailableError(
      'binary',
      'Binary content is unavailable as source text.',
    );
  }

  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

  try {
    decoder.decode(bytes);
  } catch {
    throw new SourceUnavailableError(
      'invalid_utf8',
      'The source is not valid UTF-8 text.',
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

  return decoder.decode(bytes.subarray(range.startByte, range.endByte));
}

export async function readSource(
  snapshot: GitSnapshot,
  input: SourceInput,
  options: GitOperationOptions,
): Promise<SourceEvidence> {
  // Capture caller-owned data before awaiting I/O so the reference describes the bytes read.
  const { side, path, range } = parseSourceInput(input);
  let blob: Awaited<ReturnType<typeof readSnapshotBlob>>;

  try {
    blob = await readSnapshotBlob(snapshot, { side, path }, options);
  } catch (error) {
    if (error instanceof GitBlobUnavailableError) {
      throw new SourceUnavailableError(error.reason, error.message);
    }

    if (error instanceof GitInputError) {
      throw new EvidenceInputError(error.message);
    }

    throw error;
  }

  const text = sourceText(blob.bytes, range);
  const ref = Object.freeze({
    sessionId: snapshot.identity.sessionId,
    side,
    commit: blob.commit,
    path: blob.path,
    blobId: blob.blobId,
    range,
  });

  return Object.freeze({ ref, text });
}

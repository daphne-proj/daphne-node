import { listSnapshotChanges } from '@daphne/git-source';
import type { GitOperationOptions, GitSnapshot } from '@daphne/git-source';
import type { Side, SourceEvidence } from './contracts.js';
import { EvidenceInputError } from './errors.js';
import { readEvidenceBlob, sourceFromBlob } from './source.js';
import { lineBoundaries, lineRangeToBytes } from './tools/hunks.js';

interface HunkBlob {
  side: Side;
  blob: Awaited<ReturnType<typeof readEvidenceBlob>>;
  offsets: readonly number[];
}

/* Read exact hunk spans, keeping BASE/HEAD order and empty anchors. */
export function createHunkReader(
  snapshot: GitSnapshot,
  options: GitOperationOptions,
) {
  /* Retain only one change so sequential hunk reads reuse bytes without growing a repository cache. */
  let cached: { changeId: string; blobs: HunkBlob[] } | undefined;

  return async function readHunkSources(input: {
    changeId: string;
    hunkIndex: number;
  }): Promise<readonly SourceEvidence[]> {
    const { changeId, hunkIndex } = input;

    if (!Number.isSafeInteger(hunkIndex) || hunkIndex < 0) {
      throw new EvidenceInputError(
        'The hunk index must be a nonnegative safe integer.',
      );
    }

    /* Even cache hits must check the snapshot lifetime and cancellation. */
    const changes = await listSnapshotChanges(snapshot, options);
    const change = changes.find((candidate) => candidate.id === changeId);

    if (!change) {
      throw new EvidenceInputError(
        'The change ID does not exist in this snapshot.',
      );
    }

    const hunk = change.hunks[hunkIndex];

    if (change.kind !== 'text' || !hunk) {
      throw new EvidenceInputError(
        'The hunk index does not identify a text hunk in this change.',
      );
    }

    let blobs = cached?.changeId === changeId ? cached.blobs : undefined;

    if (!blobs) {
      blobs = [];
      const sides: Side[] = ['base', 'head'];

      for (const side of sides) {
        const path = side === 'base' ? change.beforePath : change.afterPath;

        if (path === null) {
          continue;
        }

        const blob = await readEvidenceBlob(snapshot, { side, path }, options);
        blobs.push({ side, blob, offsets: lineBoundaries(blob.bytes) });
      }

      cached = { changeId, blobs };
    }

    const sources: SourceEvidence[] = [];

    for (const { side, blob, offsets } of blobs) {
      const startLine =
        side === 'base' ? hunk.beforeStartLine : hunk.afterStartLine;
      const lineCount =
        side === 'base' ? hunk.beforeLineCount : hunk.afterLineCount;

      const range = lineRangeToBytes(blob.bytes, startLine, lineCount, offsets);
      sources.push(sourceFromBlob(snapshot, side, blob, range));
    }

    return Object.freeze(sources);
  };
}

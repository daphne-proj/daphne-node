import { listSnapshotChanges } from '@daphne/git-source';
import type { GitOperationOptions, GitSnapshot } from '@daphne/git-source';
import type { Side, SourceEvidence } from './contracts.js';
import { EvidenceInputError } from './errors.js';
import { readEvidenceBlob, sourceFromBlob } from './source.js';
import { lineRangeToBytes } from './tools/hunks.js';

/* Read exact hunk spans, keeping BASE/HEAD order and empty anchors. */
export async function readHunkSources(
  snapshot: GitSnapshot,
  input: { changeId: string; hunkIndex: number },
  options: GitOperationOptions,
): Promise<readonly SourceEvidence[]> {
  const { changeId, hunkIndex } = input;

  if (!Number.isSafeInteger(hunkIndex) || hunkIndex < 0) {
    throw new EvidenceInputError(
      'The hunk index must be a nonnegative safe integer.',
    );
  }

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

  const sources: SourceEvidence[] = [];
  const sides: Side[] = ['base', 'head'];

  for (const side of sides) {
    const path = side === 'base' ? change.beforePath : change.afterPath;

    if (path === null) {
      continue;
    }

    const blob = await readEvidenceBlob(snapshot, { side, path }, options);

    const startLine =
      side === 'base' ? hunk.beforeStartLine : hunk.afterStartLine;
    const lineCount =
      side === 'base' ? hunk.beforeLineCount : hunk.afterLineCount;

    const range = lineRangeToBytes(blob.bytes, startLine, lineCount);
    sources.push(sourceFromBlob(snapshot, side, blob, range));
  }

  return Object.freeze(sources);
}

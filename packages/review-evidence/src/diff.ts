import type { Change, SourceEvidence } from './contracts.js';
import type { EvidenceSession } from './session.js';

/*
 * Read every supplied original hunk in inventory order through the borrowed
 * session, including one metadata entry for changes without text hunks. Hosts
 * collect each yielded entry immediately so later read/cancellation failures keep
 * earlier evidence. The session owns read validation; the host owns Git cleanup.
 */
export async function* readOriginalDiff(
  session: EvidenceSession,
  changes: readonly Change[],
): AsyncGenerator<{
  change: Change;
  hunkIndex: number | null;
  sources: readonly SourceEvidence[];
}> {
  for (const change of changes) {
    if (change.kind !== 'text' || change.hunks.length === 0) {
      yield { change, hunkIndex: null, sources: [] };
      continue;
    }

    for (const hunkIndex of change.hunks.keys()) {
      const sources = await session.readHunk({
        changeId: change.id,
        hunkIndex,
      });
      yield { change, hunkIndex, sources };
    }
  }
}

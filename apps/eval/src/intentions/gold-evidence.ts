import { parseIntentionEvidence } from './evidence.js';
import * as parse from '../parse.js';

/*
 * Resolve the gold file's hunk references against its single source list. For
 * example, evidenceIds: ['evidence-1'] selects that source's exact saved bytes.
 * Expand only in memory to reuse the artifact reader's revision, byte-range,
 * overlap and inventory validation without changing the run artifact format.
 * Duplicate source IDs and missing references fail before any judge request.
 */
export function parseGoldEvidence(input: Record<string, unknown>) {
  const sources = parse.array(input.sources, 'evidence.sources');
  const byId = new Map<string, unknown>();

  for (const value of sources) {
    const entry = parse.object(value, 'evidence source');
    const id = parse.text(entry.evidenceId, 'source.evidenceId');

    if (byId.has(id)) {
      throw new parse.EvaluationError(`Duplicate gold source ID: ${id}.`);
    }

    byId.set(id, entry.source);
  }

  const hunks = parse.array(input.hunks, 'evidence.hunks').map((value) => {
    const hunk = parse.object(value, 'hunk');
    const evidenceIds = parse
      .array(hunk.evidenceIds, 'hunk.evidenceIds')
      .map((id) => parse.text(id, 'hunk.evidenceIds'));

    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new parse.EvaluationError(
        'A gold hunk contains duplicate source IDs.',
      );
    }

    return {
      changeId: parse.text(hunk.changeId, 'hunk.changeId'),
      hunkIndex:
        hunk.hunkIndex === null
          ? null
          : parse.integer(hunk.hunkIndex, 'hunk.hunkIndex'),
      evidenceIds,
    };
  });
  const expanded = hunks.map(({ changeId, hunkIndex, evidenceIds }) => ({
    changeId,
    hunkIndex,
    sources: evidenceIds.map((id) => {
      if (!byId.has(id)) {
        throw new parse.EvaluationError(`Unknown gold hunk source ID: ${id}.`);
      }

      return byId.get(id);
    }),
  }));

  return parseIntentionEvidence(
    { identity: input.identity, changes: input.changes, hunks: expanded },
    { evidence: { identity: input.identity, sources, queries: [] }, hunks },
  );
}

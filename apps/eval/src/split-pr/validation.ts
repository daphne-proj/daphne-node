import { getExpectedUnitIds } from '@daphne/semantic-split';
import type { PreparedSplitCase } from './contracts.js';

export function summarizeSplitCase({
  definition,
  caseHash,
  inputHash,
}: PreparedSplitCase) {
  const unitIds = getExpectedUnitIds(definition.evidence.changes);
  const labelCounts = { together: 0, separate: 0, unknown: 0 };
  const unitsWithKnownRelations = new Set<string>();

  for (const label of definition.labels) {
    labelCounts[label.relation] += 1;

    if (label.relation !== 'unknown') {
      unitsWithKnownRelations.add(label.leftUnitId);
      unitsWithKnownRelations.add(label.rightUnitId);
    }
  }

  const possiblePairs = (unitIds.size * (unitIds.size - 1)) / 2;
  const labeledPairs = definition.labels.length;
  const knownPairs = labelCounts.together + labelCounts.separate;

  return {
    id: definition.id,
    partition: definition.partition,
    review: definition.review.status,
    tags: definition.tags,
    units: unitIds.size,
    labels: labeledPairs,
    labelCounts,
    coverage: {
      possiblePairs,
      unlabeledPairs: possiblePairs - labeledPairs,
      labeledPairRate:
        possiblePairs === 0 ? null : labeledPairs / possiblePairs,
      knownPairs,
      knownPairRate: possiblePairs === 0 ? null : knownPairs / possiblePairs,
      unitsWithKnownRelations: unitsWithKnownRelations.size,
      unitsWithoutKnownRelations: [...unitIds].filter(
        (id) => !unitsWithKnownRelations.has(id),
      ),
    },
    caseHash,
    inputHash,
  };
}

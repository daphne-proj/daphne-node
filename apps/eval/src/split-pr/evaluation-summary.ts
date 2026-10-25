import { styleText } from 'node:util';
import type { PairRate } from './contracts.js';
import type { evaluateSplitCaseArtifact } from './evaluate.js';

function agreement({ satisfied, total, rate }: PairRate): string {
  if (total === 0) {
    return 'N/A (no known pairs)';
  }

  if (satisfied === null || rate === null) {
    return 'N/A (output not accepted)';
  }

  return `${String(satisfied)}/${String(total)} pairs (${(rate * 100).toFixed(2)}%)`;
}

export function formatSplitEvaluation(
  report: Awaited<ReturnType<typeof evaluateSplitCaseArtifact>>,
): string {
  const { scores } = report;
  const total = scores.together.total + scores.separate.total;
  const satisfied = scores.accepted
    ? scores.pairs.filter(({ score }) => score === 1).length
    : null;
  const overall = {
    satisfied,
    total,
    rate: satisfied === null || total === 0 ? null : satisfied / total,
  };

  const lines = [
    `  Score     ${agreement(overall)}`,
    ...scores.violatedPairs.map(
      ({ relation, leftUnitId, rightUnitId }) =>
        `  ${relation.padEnd(8)}  ${leftUnitId} / ${rightUnitId}`,
    ),
  ];
  const output = lines.join('\n') + '\n';

  if (!scores.accepted) {
    return styleText(['bold', 'red'], output);
  }

  if (overall.rate === 1) {
    return styleText(['bold', 'green'], output);
  }

  return styleText(['bold', 'yellow'], output);
}

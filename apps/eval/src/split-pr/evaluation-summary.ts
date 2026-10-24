import { formatCommandOutput } from '../command-output.js';
import type { CommandOutputRow } from '../command-output.js';
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
  outputPath: string,
): string {
  const { reference, scores } = report;
  const total = scores.together.total + scores.separate.total;
  const satisfied = scores.accepted
    ? scores.pairs.filter(({ score }) => score === 1).length
    : null;
  const overall = {
    satisfied,
    total,
    rate: satisfied === null || total === 0 ? null : satisfied / total,
  };

  let scoreTone: CommandOutputRow['tone'] = 'warning';

  if (!scores.accepted) {
    scoreTone = 'error';
  } else if (overall.rate === 1) {
    scoreTone = 'success';
  }

  const rows: CommandOutputRow[] = [
    { label: 'Score', value: agreement(overall), tone: scoreTone },
    { label: 'Labels', value: report.review.status },
  ];

  if (!scores.completed) {
    rows.push({ label: 'Status', value: 'Saved run failed', tone: 'error' });
  } else if (scores.validation && scores.validation.status !== 'valid') {
    rows.push({
      label: 'Status',
      value: `Output rejected: ${scores.validation.status.replaceAll('_', ' ')}`,
      tone: 'error',
    });
  }

  if (scores.violatedPairs.length > 0) {
    rows.push({
      label: 'Violations',
      value: `${String(scores.violatedPairs.length)} (pairs and reasons in report)`,
      tone: 'warning',
    });
  }

  if (
    reference.labelCounts.unknown > 0 ||
    reference.coverage.unlabeledPairs > 0
  ) {
    rows.push({
      label: 'Unscored',
      value: `${String(reference.labelCounts.unknown)} unknown, ${String(reference.coverage.unlabeledPairs)} unlabeled`,
    });
  }

  rows.push({ label: 'Report', value: outputPath });

  return formatCommandOutput(`Split evaluation: ${reference.id}`, rows);
}

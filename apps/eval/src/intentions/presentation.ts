import { formatCommandOutput } from '@daphne/cli/command-output';
import type { CommandOutputRow } from '@daphne/cli/command-output';
import {
  formatElapsedTime,
  formatIntentionRunSummary,
} from '@daphne/cli/intentions-summary';
import type { IntentionRunSummary } from '@daphne/cli/intentions-summary';
import type { IntentionJudgment } from './judgment.js';
import type { parseGoldJudgment } from './gold-judgment.js';
import type { IntentionQualitySummary } from './quality.js';

type GoldResult = ReturnType<typeof parseGoldJudgment>;
type Score = { value: number | null; applicable: boolean };

function average(scores: Score[]): Score {
  const applicable = scores.filter((score) => score.applicable);

  if (applicable.length === 0) {
    return { value: null, applicable: false };
  }

  if (applicable.some((score) => score.value === null)) {
    return { value: null, applicable: true };
  }

  return {
    value:
      applicable.reduce((sum, score) => sum + (score.value ?? 0), 0) /
      applicable.length,
    applicable: true,
  };
}

function display(score: Score): string {
  if (!score.applicable) {
    return 'N/A';
  }

  return score.value === null
    ? 'Unassessed'
    : `${score.value.toFixed(1)} / 100`;
}

/*
 * Render validated evaluation results for the direct CLI and its Make wrapper.
 * Ratings map 1..5 to 0,25,50,75,100; rates map to 0..100 with higher always better.
 * Four applicable areas have equal weight; issue sub-scores explain on-pointness
 * without receiving extra weight. Unknown applicable scores withhold the overall
 * index, while empty denominators are N/A. Raw judgments remain in report.json.
 * For example, a citation rating of 4 displays 75/100, not a 75% truth probability.
 */
export function formatIntentionEvaluation(input: {
  status: string;
  judgment: IntentionJudgment | null;
  gold: GoldResult | null;
  provisional: boolean;
  quality: IntentionQualitySummary;
  unassessedBehaviors: number;
  diagnostics: string[];
  reportPath: string;
  generationSummary: IntentionRunSummary | null;
  elapsedMs: number;
}): string {
  const sections = [
    'Intentions evaluation — scores out of 100; higher is better',
    `Status: ${input.status}${input.provisional ? ' · provisional gold labels' : ''}`,
    `Quality: ${input.quality.priority.replaceAll('_', ' ')}`,
    '',
    input.generationSummary === null
      ? 'Generation metrics unavailable.\n'
      : formatIntentionRunSummary(input.generationSummary),
    `Evaluation elapsed: ${formatElapsedTime(input.elapsedMs)}`,
    '',
  ];

  if (input.judgment === null) {
    return [
      ...sections,
      ...input.diagnostics,
      `Report: ${input.reportPath}`,
      'OVERALL: Unassessed — evaluation did not complete.',
      '',
    ].join('\n');
  }

  const groups: Score[] = [];
  const explanation: Score[] = [];
  const rows: CommandOutputRow[] = [];

  for (const [name, label] of [
    ['accuracy', 'Factual accuracy'],
    ['citations', 'Citation support'],
    ['rationale', 'Purpose and rationale'],
    ['coverage', 'Explanation completeness'],
    ['coherence', 'Coherence'],
  ] as const) {
    const grade = input.judgment.dimensions[name];
    const score = {
      value: grade?.score == null ? null : (grade.score - 1) * 25,
      applicable: true,
    };
    explanation.push(score);
    rows.push({
      label,
      value: `${display(score)}  ${grade?.explanation ?? 'No assessment.'}`,
    });
  }

  const explanationScore = average(explanation);
  groups.push(explanationScore);
  rows.push({
    label: 'Area score',
    value: display(explanationScore),
  });
  sections.push(formatCommandOutput('Explanation quality', rows));

  if (input.gold !== null) {
    const gold = input.gold;
    const behavior: Score = {
      value:
        input.unassessedBehaviors > 0 || gold.coverage.rate === null
          ? null
          : gold.coverage.rate * 100,
      applicable: gold.coverage.required > 0,
    };
    groups.push(behavior);
    sections.push(
      formatCommandOutput('Behavior coverage', [
        {
          label: 'Complete transitions',
          value: `${display(behavior)}  ${String(gold.coverage.covered)}/${String(gold.coverage.required)} required; ${String(input.unassessedBehaviors)} unassessed; both BASE and HEAD must be covered`,
        },
      ]),
    );

    const metrics = gold.issueEvaluation.metrics;
    const reported = metrics.reported;
    const issueRows: CommandOutputRow[] = [];

    for (const [name, label] of [
      ['accuracy', 'Factual accuracy'],
      ['relevance', 'PR relevance'],
      ['consequence', 'Meaningful consequence'],
      ['onPoint', 'On point (area score)'],
    ] as const) {
      const metric = reported[name];
      const score = {
        value: metric.rate === null ? null : metric.rate * 100,
        applicable: reported.total > 0,
      };
      issueRows.push({
        label,
        value: `${display(score)}  ${String(metric.passed)}/${String(metric.assessed)} assessed; ${String(metric.rejected)} rejected; ${String(metric.unassessed)} unassessed`,
      });
    }

    groups.push({
      value:
        reported.onPoint.unassessed > 0 || reported.onPoint.rate === null
          ? null
          : reported.onPoint.rate * 100,
      applicable: reported.total > 0,
    });
    sections.push(
      formatCommandOutput(
        `Reported issues (${String(reported.total)})`,
        issueRows,
      ),
    );

    const expected: Score = {
      value:
        metrics.expected.rate === null ? null : metrics.expected.rate * 100,
      applicable: metrics.expected.total > 0,
    };
    const controls: Score = {
      value:
        metrics.controls.unassessed > 0 ||
        metrics.controls.falseAlarmRate === null
          ? null
          : (1 - metrics.controls.falseAlarmRate) * 100,
      applicable: metrics.controls.total > 0,
    };
    const goldScore = average([expected, controls]);
    groups.push(goldScore);
    sections.push(
      formatCommandOutput('Gold issue checks', [
        {
          label: 'Known issues found',
          value: `${display(expected)}  ${String(metrics.expected.identified)}/${String(metrics.expected.total)} expected; ${String(metrics.expected.missing)} missing; ${String(metrics.expected.unassessed)} unassessed`,
        },
        {
          label: 'False alarms avoided',
          value: `${display(controls)}  ${String(metrics.controls.avoided)}/${String(metrics.controls.total)} controls; ${String(metrics.controls.violated)} violated; ${String(metrics.controls.unassessed)} unassessed`,
        },
        { label: 'Area score', value: display(goldScore) },
      ]),
    );
  }

  const overall =
    input.quality.priority === 'unassessed'
      ? { value: null, applicable: true }
      : average(groups);

  sections.push(
    `Report: ${input.reportPath}`,
    '',
    'Summary index v1: equal weight per applicable area; N/A areas excluded.',
    'Ratings are rescaled judgments, not probabilities. Raw scores and counts remain in the report.',
    formatCommandOutput('Overall', [
      {
        label: 'Score',
        value: `${display(overall)}${input.provisional ? ' (provisional)' : ''}`,
      },
    ]),
    '',
  );
  return sections.join('\n');
}

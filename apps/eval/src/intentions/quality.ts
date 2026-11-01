import type { IntentionJudgment } from './judgment.js';

export type IntentionQualityStatus = 'pass' | 'issues_found' | 'unassessed';

/* Rubric v2 keeps the three user priorities separate from rationale and coherence. */
export interface IntentionQualitySummary {
  accuracy: IntentionQualityStatus;
  citationSupport: IntentionQualityStatus;
  coverage: IntentionQualityStatus;
  priority: IntentionQualityStatus;
}

function qualityStatus(
  score: number | null | undefined,
): IntentionQualityStatus {
  if (score === 0 || score === 1) {
    return 'issues_found';
  }

  return score === 2 ? 'pass' : 'unassessed';
}

/*
 * Summarize a newly parsed rubric-v2 judgment without averaging ordinal scores.
 * The command passes null for failed or unassessed runs. A known defect outranks
 * an unknown dimension; for example, accuracy=1 and coverage=null still means
 * issues_found. Do not use this to reinterpret historical rubric-v1 reports.
 */
export function summarizeIntentionQuality(
  judgment: IntentionJudgment | null,
): IntentionQualitySummary {
  const accuracy = qualityStatus(judgment?.dimensions.accuracy?.score);
  const citationSupport = qualityStatus(judgment?.dimensions.citations?.score);
  const coverage = qualityStatus(judgment?.dimensions.coverage?.score);
  const primary = [accuracy, citationSupport, coverage];
  const hasFinding =
    judgment !== null &&
    (judgment.omissions.length > 0 ||
      judgment.cards.some((card) =>
        card.findings.some((finding) => finding.field !== 'why'),
      ));
  let priority: IntentionQualityStatus = 'pass';

  if (hasFinding || primary.includes('issues_found')) {
    priority = 'issues_found';
  } else if (primary.includes('unassessed')) {
    priority = 'unassessed';
  }

  return { accuracy, citationSupport, coverage, priority };
}

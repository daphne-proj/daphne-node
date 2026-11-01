import type { IntentionJudgment } from './judgment.js';

export type IntentionQualityStatus = 'pass' | 'issues_found' | 'unassessed';

/* Rubric v5 keeps the three user priorities separate from rationale and coherence. */
export interface IntentionQualitySummary {
  accuracy: IntentionQualityStatus;
  citationSupport: IntentionQualityStatus;
  coverage: IntentionQualityStatus;
  priority: IntentionQualityStatus;
}

function qualityStatus(
  score: number | null | undefined,
): IntentionQualityStatus {
  if (score !== null && score !== undefined && score >= 1 && score <= 4) {
    return 'issues_found';
  }

  return score === 5 ? 'pass' : 'unassessed';
}

/*
 * Summarize a newly parsed rubric-v5 judgment: 5 passes, 1–4 identify defects.
 * The command passes null for failed or unassessed runs. A known defect outranks
 * an unknown dimension; for example, accuracy=1 and coverage=null still means
 * issues_found. A finding based only on missing evidence is unassessed, not a
 * demonstrated defect. Neither can yield a clean priority summary. Do not
 * reinterpret historical reports.
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
        card.findings.some(
          (finding) => finding.problem !== 'insufficient_evidence',
        ),
      ));
  const unassessedFinding = judgment?.cards.some((card) =>
    card.findings.some(
      (finding) => finding.problem === 'insufficient_evidence',
    ),
  );
  let priority: IntentionQualityStatus = 'pass';

  if (hasFinding || primary.includes('issues_found')) {
    priority = 'issues_found';
  } else if (unassessedFinding || primary.includes('unassessed')) {
    priority = 'unassessed';
  }

  return { accuracy, citationSupport, coverage, priority };
}

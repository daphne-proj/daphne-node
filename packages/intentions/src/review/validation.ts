import { ModelError } from '@daphne/llm';
import { intentionReviewOutputSchema } from './schema.js';
import type {
  IntentionReview,
  IntentionReviewContext,
  IntentionReviewDecision,
} from './contracts.js';

function materialIssues(report: IntentionReview) {
  return [
    ...report.cards.flatMap((card) =>
      card.findings.filter((finding) => finding.severity === 'material'),
    ),
    ...report.omissions.map((omission) => ({
      ...omission,
      criterion: 'coverage' as const,
    })),
  ];
}

function knownIds(
  ids: readonly string[],
  known: ReadonlySet<string>,
  field: string,
): void {
  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new ModelError(`${field}: unknown, undelivered or duplicate IDs.`);
  }
}

/*
 * Validate untrusted review JSON before policy or artifact verification uses it.
 * Every current card appears once, references must be known and delivered, and
 * summaries must agree with material remedies. For example, a pass cannot hide
 * a material citation defect. Throw with field diagnostics on malformed reports;
 * the conversation retains the raw reply separately before calling this parser.
 */
export function parseIntentionReview(
  value: unknown,
  context: IntentionReviewContext,
): IntentionReview {
  const parsed = intentionReviewOutputSchema.safeParse(value);

  if (!parsed.success) {
    throw new ModelError(
      parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.map(String).join('.') || 'review'}: ${issue.message}`,
        )
        .join('; '),
    );
  }

  const report = parsed.data;
  const indexes = report.cards.map((card) => card.index);

  if (
    indexes.length !== context.proposal.intentions.length ||
    new Set(indexes).size !== indexes.length ||
    indexes.some((index) => index >= context.proposal.intentions.length)
  ) {
    throw new ModelError(
      'review.cards: every proposal card must appear exactly once.',
    );
  }

  const evidenceIds = new Set(context.deliveredEvidenceIds);
  const changeIds = new Set(context.changes.map((change) => change.id));

  for (const card of report.cards) {
    for (const [index, finding] of card.findings.entries()) {
      const field = `review.cards.${String(card.index)}.findings.${String(index)}`;
      knownIds(finding.evidenceIds, evidenceIds, `${field}.evidenceIds`);
      knownIds(finding.changeIds, changeIds, `${field}.changeIds`);

      if (
        finding.severity === 'advisory' &&
        finding.remedy.kind === 'unresolved'
      ) {
        throw new ModelError(
          `${field}: advisory findings cannot require an unresolved stop.`,
        );
      }
    }
  }

  for (const [index, omission] of report.omissions.entries()) {
    knownIds(
      omission.changeIds,
      changeIds,
      `review.omissions.${String(index)}.changeIds`,
    );
  }

  const material = materialIssues(report);

  for (const [criterion, dimension] of Object.entries(report.dimensions)) {
    const findings = material.filter(
      (finding) => finding.criterion === criterion,
    );
    let expected = 'pass';

    if (findings.some((finding) => finding.remedy.kind === 'unresolved')) {
      expected = 'insufficient_evidence';
    } else if (findings.length > 0) {
      expected = 'issues_found';
    }

    if (dimension.status !== expected) {
      throw new ModelError(
        `review.dimensions.${criterion}: status contradicts its material findings.`,
      );
    }
  }

  return report;
}

/* Apply the same policy after every parsed review; advisory wording preferences never force repair. */
export function deriveIntentionReviewDecision(
  report: IntentionReview,
): IntentionReviewDecision {
  const material = materialIssues(report);
  const reasons = material.flatMap((finding) =>
    finding.remedy.kind === 'unresolved' ? [finding.remedy.reason] : [],
  );

  if (reasons.length > 0) {
    return { status: 'stop', reason: reasons.join('\n') };
  }

  if (material.length > 0) {
    return { status: 'revise', feedback: report };
  }

  return { status: 'accept' };
}

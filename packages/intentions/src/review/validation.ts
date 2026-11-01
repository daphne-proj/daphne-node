import { ModelError } from '@daphne/llm';
import { intentionReviewOutputSchema } from './schema.js';
import { validateIntentionCoverage } from './coverage.js';
import type {
  RawIntentionReview,
  IntentionReview,
  IntentionReviewCriterion,
  IntentionReviewContext,
  IntentionReviewDecision,
} from './contracts.js';

/* Both dimension statuses and acceptance use this policy; severity cannot waive a factual defect. */
function isBlockingFinding(
  finding: RawIntentionReview['cards'][number]['findings'][number],
): boolean {
  if (finding.field === 'why' || finding.criterion === 'rationale') {
    return false;
  }

  const factualClaim =
    (finding.criterion === 'accuracy' || finding.criterion === 'citations') &&
    (finding.field === 'title' ||
      finding.field === 'before' ||
      finding.field === 'after');

  return factualClaim || finding.severity === 'material';
}

function blockingIssues(report: RawIntentionReview) {
  return [
    ...report.cards.flatMap((card) => card.findings.filter(isBlockingFinding)),
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
 * coverage must account for the inventory. Derive statuses rather than accepting
 * model pass labels: an advisory factual error still requires correction.
 * Throw ModelError with field diagnostics on malformed reports;
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

      if (!isBlockingFinding(finding) && finding.remedy.kind === 'unresolved') {
        throw new ModelError(
          `${field}: nonblocking findings cannot require an unresolved stop.`,
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

  validateIntentionCoverage(report, context);
  const blocking = blockingIssues(report);

  function dimension(
    criterion: IntentionReviewCriterion,
  ): IntentionReview['dimensions'][IntentionReviewCriterion] {
    const findings = blocking.filter(
      (finding) => finding.criterion === criterion,
    );
    let status: IntentionReview['dimensions'][IntentionReviewCriterion]['status'] =
      'pass';

    if (findings.some((finding) => finding.remedy.kind === 'unresolved')) {
      status = 'insufficient_evidence';
    } else if (findings.length > 0) {
      status = 'issues_found';
    }

    return { ...report.dimensions[criterion], status };
  }

  return {
    ...report,
    dimensions: {
      accuracy: dimension('accuracy'),
      citations: dimension('citations'),
      rationale: dimension('rationale'),
      coverage: dimension('coverage'),
      coherence: dimension('coherence'),
    },
  };
}

/* Apply the same policy after every parsed review; advisory wording preferences never force repair. */
export function deriveIntentionReviewDecision(
  report: IntentionReview,
): IntentionReviewDecision {
  const blocking = blockingIssues(report);
  const reasons = blocking.flatMap((finding) =>
    finding.remedy.kind === 'unresolved' ? [finding.remedy.reason] : [],
  );

  if (reasons.length > 0) {
    return { status: 'stop', reason: reasons.join('\n') };
  }

  if (blocking.length > 0) {
    return { status: 'revise', feedback: report };
  }

  return { status: 'accept' };
}

import { ModelError } from '@daphne/llm';
import { intentionReviewers } from './schema.js';
import { parseIntentionReview } from './validation.js';
import type {
  IntentionCoverageEntry,
  IntentionReviewContext,
  IntentionReviewCriterion,
  IntentionReviewerReport,
  RawIntentionReview,
} from './contracts.js';

/* Combine three already validated reports for one candidate in fixed role order.
 * Callers must validate each against its own delivery first; the union here does
 * not authorize peer evidence. Preserve all findings, including disagreements,
 * and rebase omission links before applying the existing acceptance policy. */
export function combineIntentionReviews(
  reviews: readonly IntentionReviewerReport[],
  context: IntentionReviewContext,
) {
  const ordered = intentionReviewers.map((reviewer) => {
    const matches = reviews.filter((review) => review.reviewer === reviewer);
    const match = matches[0];

    if (matches.length !== 1 || !match) {
      throw new ModelError(`Expected exactly one ${reviewer} review.`);
    }

    return match;
  });

  if (reviews.length !== intentionReviewers.length) {
    throw new ModelError('Expected exactly three intention reviews.');
  }

  function dimension(criterion: IntentionReviewCriterion) {
    const explanations = ordered.flatMap(({ reviewer, report }) => {
      const dimensions: Partial<RawIntentionReview['dimensions']> =
        report.dimensions;
      const summary = dimensions[criterion];
      const findings = report.cards
        .flatMap((card) => card.findings)
        .filter((finding) => finding.criterion === criterion);

      return [
        ...(summary ? [`${reviewer}: ${summary.explanation}`] : []),
        ...findings.map((finding) => `${reviewer}: ${finding.explanation}`),
        ...(criterion === 'coverage'
          ? report.omissions.map(
              (omission) => `${reviewer}: ${omission.explanation}`,
            )
          : []),
      ];
    });

    return { explanation: explanations.join('\n') };
  }

  const omissions: RawIntentionReview['omissions'] = [];
  const coverage: IntentionCoverageEntry[] = [];

  for (const { report } of ordered) {
    const offset = omissions.length;
    omissions.push(...report.omissions);
    coverage.push(
      ...report.coverage.map((entry) =>
        entry.status === 'omitted'
          ? { ...entry, omissionIndex: offset + entry.omissionIndex }
          : entry,
      ),
    );
  }

  return parseIntentionReview(
    {
      dimensions: {
        accuracy: dimension('accuracy'),
        citations: dimension('citations'),
        rationale: dimension('rationale'),
        coverage: dimension('coverage'),
        coherence: dimension('coherence'),
      },
      cards: context.proposal.intentions.map((_, index) => ({
        index,
        findings: ordered.flatMap(({ report }) =>
          report.cards
            .filter((card) => card.index === index)
            .flatMap((card) => card.findings),
        ),
      })),
      omissions,
      coverage,
    },
    context,
  );
}

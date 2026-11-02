import { ModelError } from '@daphne/llm';
import { validateIntentionCoverageSide } from './coverage-side.js';
import type {
  IntentionReviewContext,
  RawIntentionReview,
} from './contracts.js';

/*
 * Check that the reviewer filled out its coverage report correctly. Coverage is
 * the reviewer's assessment of whether the cards explain the PR's meaningful
 * changes. This function checks the report's references, not that assessment.
 *
 * Each covered capability states BASE and HEAD facts with independent support and
 * candidate matches. For example, a new validation rule needs the old behavior
 * as well as a quotation explaining the new rejection. A shared card is allowed;
 * a HEAD quotation cannot substitute for its BASE account. Metadata-only changes
 * and absent paths can use inventory support rather than source bytes.
 *
 * Completeness and combined reports account for every change; other scoped reports
 * may be partial. Each reported omission must be linked exactly once with the
 * same change IDs.
 * parseIntentionReview calls this after schema validation; valid reports return
 * normally, while invalid references or incomplete accounting throw ModelError.
 *
 * Passing these checks does not prove that a fact or quotation explains the
 * relevant capability. The reviewer model still makes that judgment.
 */
export function validateIntentionCoverage(
  report: Pick<RawIntentionReview, 'coverage' | 'omissions'>,
  context: IntentionReviewContext,
  requireInventory = true,
): void {
  const changes = new Map(context.changes.map((change) => [change.id, change]));
  const delivered = new Set(context.deliveredEvidenceIds);
  const accounted = new Set<string>();
  const linkedOmissions = new Set<number>();
  const anchors = new Map<string, Set<string>>();

  for (const hunk of context.hunks) {
    const ids = anchors.get(hunk.changeId) ?? new Set<string>();

    for (const id of hunk.evidenceIds) {
      ids.add(id);
    }

    anchors.set(hunk.changeId, ids);
  }

  for (const [index, entry] of report.coverage.entries()) {
    const field = `review.coverage.${String(index)}`;

    if (new Set(entry.changeIds).size !== entry.changeIds.length) {
      throw new ModelError(`${field}.changeIds: duplicate IDs.`);
    }

    if (
      new Set(entry.evidenceIds).size !== entry.evidenceIds.length ||
      entry.evidenceIds.some((id) => !delivered.has(id))
    ) {
      throw new ModelError(
        `${field}.evidenceIds: undelivered or duplicate IDs.`,
      );
    }

    for (const id of entry.changeIds) {
      const change = changes.get(id);

      if (!change) {
        throw new ModelError(`${field}.changeIds: unknown change ${id}.`);
      }

      if (
        change.kind === 'text' &&
        change.hunks.length > 0 &&
        !entry.evidenceIds.some((source) => anchors.get(id)?.has(source))
      ) {
        throw new ModelError(
          `${field}.evidenceIds: missing original hunk anchor for ${id}.`,
        );
      }

      accounted.add(id);
    }

    if (entry.status === 'covered') {
      for (const side of ['before', 'after'] as const) {
        validateIntentionCoverageSide(
          entry[side],
          side,
          entry.changeIds,
          context,
          `${field}.${side}`,
        );
      }
    } else if (entry.status === 'omitted') {
      const omission = report.omissions[entry.omissionIndex];

      if (
        !omission ||
        linkedOmissions.has(entry.omissionIndex) ||
        omission.changeIds.length !== entry.changeIds.length ||
        omission.changeIds.some((id) => !entry.changeIds.includes(id))
      ) {
        throw new ModelError(
          `${field}.omissionIndex: expected a unique omission with the same change IDs.`,
        );
      }

      linkedOmissions.add(entry.omissionIndex);
    }
  }

  if (requireInventory && accounted.size !== changes.size) {
    throw new ModelError(
      'review.coverage: every inventory change must be accounted for.',
    );
  }

  if (linkedOmissions.size !== report.omissions.length) {
    throw new ModelError(
      'review.coverage: every omission must be referenced exactly once.',
    );
  }
}

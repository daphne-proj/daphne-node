import { ModelError } from '@daphne/llm';
import type {
  IntentionCoverageSide,
  IntentionReviewContext,
} from './contracts.js';

/*
 * Check the references in one 'completeness' assessment after its JSON shape has
 * been validated. validateIntentionCoverage calls this twice for each behavior
 * marked covered: once for before (BASE code) and once for after (HEAD code).
 * The assessment identifies evidence for the reviewer's claim and quotes the
 * candidate explanation written by the producer.
 *
 * evidenceIds refer to source excerpts. They must exist, contain text, belong to
 * the assessed revision and have been shown to this reviewer. assessment.changeIds
 * refer to Git change records for the behavior being assessed. Those records can
 * support path absence, metadata changes or diff locations with no source text.
 * Either reference array may be empty, but they cannot both be empty.
 *
 * For example, an added file has no BASE source to quote. A before assessment can
 * use the change record whose beforePath is null and quote the candidate's before
 * sentence saying that this path did not exist. That establishes path absence,
 * not the absence of equivalent behavior elsewhere in the application.
 *
 * Each match must quote an existing candidate passage exactly, from the matching
 * before/after field or an issue. An issue may describe either revision. These
 * checks do not establish that the reviewer's claim is true or that the quoted
 * passage actually explains it; the reviewer model must judge that meaning.
 *
 * Return without changing data when the references are valid. Otherwise throw
 * ModelError, using label to identify the failing assessment. The current caller
 * treats this as a failed review, not feedback asking the reviewer to try again.
 */
export function validateIntentionCoverageSide(
  assessment: IntentionCoverageSide,
  field: 'before' | 'after',
  changeIds: readonly string[],
  context: IntentionReviewContext,
  label: string,
): void {
  const side = field === 'before' ? 'base' : 'head';
  const delivered = new Set(context.deliveredEvidenceIds);

  if (
    assessment.evidenceIds.length + assessment.changeIds.length === 0 ||
    new Set(assessment.evidenceIds).size !== assessment.evidenceIds.length ||
    new Set(assessment.changeIds).size !== assessment.changeIds.length
  ) {
    throw new ModelError(`${label}: expected distinct supporting references.`);
  }

  for (const id of assessment.evidenceIds) {
    const source = context.sources.find((entry) => entry.evidenceId === id);

    if (
      !delivered.has(id) ||
      !source ||
      source.source.ref.side !== side ||
      source.source.text.length === 0
    ) {
      throw new ModelError(
        `${label}.evidenceIds: expected delivered, nonempty ${side} source.`,
      );
    }
  }

  for (const id of assessment.changeIds) {
    const change = context.changes.find((entry) => entry.id === id);

    if (!change || !changeIds.includes(id)) {
      throw new ModelError(
        `${label}.changeIds: expected a represented change.`,
      );
    }

    const path = field === 'before' ? change.beforePath : change.afterPath;
    const metadata =
      change.kind !== 'text' ||
      change.hunks.length === 0 ||
      (change.beforePath !== null &&
        change.afterPath !== null &&
        change.beforeMode !== change.afterMode) ||
      change.status === 'renamed';

    const anchors = context.hunks
      .filter((hunk) => hunk.changeId === id)
      .flatMap((hunk) => hunk.evidenceIds);

    const emptyAnchor = context.sources.some(
      ({ evidenceId, source }) =>
        anchors.includes(evidenceId) &&
        delivered.has(evidenceId) &&
        source.ref.side === side &&
        source.text.length === 0,
    );

    if (path !== null && !metadata && !emptyAnchor) {
      throw new ModelError(
        `${label}.changeIds: inventory support requires absence, metadata or an empty anchor.`,
      );
    }
  }

  for (const match of assessment.matches) {
    const card = context.proposal.intentions[match.cardIndex];
    const text =
      match.field === 'issue'
        ? card?.issues[match.issueIndex]?.text
        : card?.[match.field].text;

    if (
      (match.field !== field && match.field !== 'issue') ||
      !text?.includes(match.quote)
    ) {
      throw new ModelError(
        `${label}.matches: expected an exact ${field} or issue quotation.`,
      );
    }
  }
}

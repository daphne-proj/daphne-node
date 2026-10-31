import type {
  IntentionCitation,
  IntentionClaim,
  IntentionReason,
  IntentionsProposal,
} from '../contracts.js';
import type {
  RawIntentionCitation,
  RawIntentionClaim,
  RawIntentionReason,
  RawIntentionsProposal,
} from '../schema.js';

function citation(value: IntentionCitation): RawIntentionCitation {
  if (value.kind === 'change') {
    return value;
  }

  return { kind: 'code', evidenceId: value.evidenceId, range: value.range };
}

function claim(value: IntentionClaim): RawIntentionClaim {
  return { text: value.text, citations: value.citations.map(citation) };
}

function reason(value: IntentionReason): RawIntentionReason {
  if (value.basis !== 'inferred') {
    return value;
  }

  return {
    basis: 'inferred',
    text: value.text,
    citations: value.citations.map(citation),
  };
}

/*
 * reviewIntentionCandidate uses this projection after validation so repeated
 * citations refer to the source packet instead of copying source text per card.
 * For example, a code citation keeps its evidence ID and absolute byte range.
 * The caller must still send every writer-delivered source, including uncited
 * evidence needed to find omissions. This does not mutate the enriched proposal
 * retained for public results and artifact verification.
 */
export function toReviewProposal(
  proposal: IntentionsProposal,
): RawIntentionsProposal {
  return {
    intentions: proposal.intentions.map((card) => ({
      title: card.title,
      changeIds: card.changeIds,
      before: claim(card.before),
      after: claim(card.after),
      why: reason(card.why),
    })),
    warnings: proposal.warnings,
  };
}

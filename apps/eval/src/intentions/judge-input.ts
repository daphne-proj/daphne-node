import type {
  IntentionCitation,
  IntentionClaim,
  IntentionReason,
} from '@daphne/intentions';
import type { IntentionJudgePacket } from './artifact.js';

function citation(value: IntentionCitation) {
  if (value.kind === 'change') {
    return value;
  }

  return { kind: value.kind, evidenceId: value.evidenceId, range: value.range };
}

function claim(value: IntentionClaim) {
  return { text: value.text, citations: value.citations.map(citation) };
}

function reason(value: IntentionReason) {
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
 * Give the judge one copy of repeated source text without changing the validated
 * packet used to check its reply. For example, textOf: 'evidence-1' borrows that
 * earlier entry's text while retaining this entry's own ID and revision reference.
 * References always target the first full-text entry, never another reference;
 * tiny blocks stay inline when a reference would increase the serialized size.
 * Citations keep IDs and byte ranges instead of repeating source snippets. Keep
 * all delivered sources in the packet, including uncited evidence for omissions.
 */
export function toIntentionJudgeInput(packet: IntentionJudgePacket) {
  const firstByText = new Map<string, string>();
  const sources = packet.sources.map(({ evidenceId, source }) => {
    const textOf = firstByText.get(source.text);

    if (
      textOf !== undefined &&
      Buffer.byteLength(JSON.stringify({ textOf })) <
        Buffer.byteLength(JSON.stringify({ text: source.text }))
    ) {
      return { evidenceId, source: { ref: source.ref, textOf } };
    }

    if (textOf === undefined) {
      firstByText.set(source.text, evidenceId);
    }

    return { evidenceId, source };
  });

  return {
    ...packet,
    sources,
    proposal: {
      intentions: packet.proposal.intentions.map((card) => ({
        title: card.title,
        changeIds: card.changeIds,
        before: claim(card.before),
        after: claim(card.after),
        intendedOutcome: reason(card.intendedOutcome),
        why: reason(card.why),
        issues: card.issues.map((issue) => ({
          ...issue,
          citations: issue.citations.map(citation),
        })),
      })),
      warnings: packet.proposal.warnings,
    },
  };
}

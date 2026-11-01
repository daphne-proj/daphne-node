import { toIntentionProposalInput } from '@daphne/intentions';
import type { IntentionJudgePacket } from './artifact.js';

/*
 * Give the judge one copy of repeated source text without changing the validated
 * packet used to check its reply. For example, textOf: 'evidence-1' borrows that
 * earlier entry's text while retaining this entry's own ID and revision reference.
 * References always target the first full-text entry, never another reference;
 * tiny blocks stay inline when a reference would increase the serialized size.
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
    proposal: toIntentionProposalInput(packet.proposal),
  };
}

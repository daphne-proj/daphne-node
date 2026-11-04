import type { AssembleInput, ContextPacket } from './contracts.js';
import type { ContextEngine } from './engine.js';
import { ContextLimitError } from './errors.js';

/*
 * Both investigations require all selected evidence and navigation to reach the
 * model. For example, pass every initial hunk source with the request byte limit.
 * Throw on omissions; packet construction never fetches or discards source silently.
 */
export function assembleCompleteEvidence(
  engine: ContextEngine,
  input: AssembleInput,
): ContextPacket {
  const packet = engine.buildContextPacket(input);

  if (
    packet.omittedEvidenceIds.length > 0 ||
    packet.notices.some((notice) => notice.code === 'observations_omitted')
  ) {
    throw new ContextLimitError(
      'packet',
      'Required evidence or navigation cannot fit the context packet.',
    );
  }

  return packet;
}

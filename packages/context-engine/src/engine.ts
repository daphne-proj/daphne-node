import type {
  ReviewIdentity,
  SourceEvidence,
  ToolResult,
} from '@daphne/review-evidence/contracts';
import type {
  AssembleInput,
  ContextPacket,
  EvidenceSnapshot,
} from './contracts.js';
import { buildContextPacket } from './assembly.js';
import { createEvidenceLedger } from './evidence.js';
import type { ContextLimits } from './limits.js';
import { resolveContextLimits } from './limits.js';
import { integer, object } from './validation.js';

/* Separate evidence retention from packet selection so a host can assemble different views of the same investigation. */
export interface ContextEngine {
  readonly identity: ReviewIdentity;
  readonly addSource: (source: SourceEvidence) => string;
  readonly addToolResult: (result: ToolResult) => void;
  readonly getEvidenceSnapshot: () => EvidenceSnapshot;
  readonly buildContextPacket: (input: AssembleInput) => ContextPacket;
}

/*
 * Give a host one in-memory ledger and a way to assemble its retained evidence.
 * The context inspect CLI, for example, records tool pages through this engine,
 * closes Git, then assembles selected evidence IDs into a bounded packet.
 * Retrieval policy and resource cleanup remain with the host.
 */
export function createContextEngine(
  identity: ReviewIdentity,
  limits: ContextLimits,
): ContextEngine {
  const resolved = resolveContextLimits(limits);
  const ledger = createEvidenceLedger(identity, resolved.maxRetainedBytes);

  return Object.freeze({
    identity: ledger.snapshot().identity,
    addSource: ledger.addSource,
    addToolResult: ledger.addToolResult,
    getEvidenceSnapshot: ledger.snapshot,
    buildContextPacket: (input: AssembleInput) => {
      const request = object(input);
      const maxBytes = Math.min(
        integer(request.maxBytes, 1),
        resolved.maxContextBytes,
      );

      return buildContextPacket(
        ledger.snapshot(),
        { ...input, maxBytes },
        resolved,
      );
    },
  });
}

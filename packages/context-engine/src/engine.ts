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
import { assembleContext } from './assembly.js';
import { createEvidenceLedger } from './evidence.js';
import type { ContextLimits } from './limits.js';
import { resolveContextLimits } from './limits.js';
import { integer, object } from './validation.js';

/* Separate evidence retention from packet selection so a host can assemble different views of the same investigation. */
export interface ContextEngine {
  readonly identity: ReviewIdentity;
  readonly retain: (source: SourceEvidence) => string;
  readonly record: (result: ToolResult) => void;
  readonly evidence: () => EvidenceSnapshot;
  readonly assemble: (input: AssembleInput) => Promise<ContextPacket>;
}

/* Own only an in-memory ledger so the host can close Git before assembly and retain control of retrieval and cleanup. */
export function createContextEngine(
  identity: ReviewIdentity,
  limits: ContextLimits,
): ContextEngine {
  const resolved = resolveContextLimits(limits);
  const ledger = createEvidenceLedger(identity, resolved.maxRetainedBytes);

  return Object.freeze({
    identity: ledger.snapshot().identity,
    retain: ledger.retain,
    record: ledger.record,
    evidence: ledger.snapshot,
    assemble: (input: AssembleInput) => {
      const request = object(input);
      const maxBytes = Math.min(
        integer(request.maxBytes, 1),
        resolved.maxContextBytes,
      );

      return assembleContext(ledger.snapshot(), { ...input, maxBytes });
    },
  });
}

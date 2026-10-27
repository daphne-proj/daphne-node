import { createHash } from 'node:crypto';
import type { ContextNotice } from '@daphne/review-evidence/contracts';
import type {
  AssembleInput,
  ContextPacket,
  EvidenceSnapshot,
} from './contracts.js';
import { validateAndCopySnapshot } from './evidence.js';
import { ContextInputError, ContextLimitError } from './errors.js';
import { resolveContextLimits } from './limits.js';
import type { ContextLimits } from './limits.js';
import * as validate from './validation.js';

/* Validate and copy the selection before rendering a byte-bounded packet. */
function parseAssembleInput(
  value: unknown,
  limits: ContextLimits,
): AssembleInput {
  const input = validate.object(value);
  const evidenceIds = Object.freeze([
    ...new Set(
      validate.array(input.evidenceIds).map((id) => validate.string(id)),
    ),
  ]);
  const maxBytes = Math.min(
    validate.integer(input.maxBytes, 1),
    limits.maxContextBytes,
  );

  if ('tokens' in input) {
    throw new ContextInputError(
      'Token budgets are not supported by context assembly.',
    );
  }

  return Object.freeze({ evidenceIds, maxBytes });
}

function contextNotice(code: string, message: string): ContextNotice {
  return Object.freeze({ code, message, path: null });
}

/* Assemble supplied evidence into a byte-bounded packet without model calls. */
export function buildContextPacket(
  snapshot: EvidenceSnapshot,
  input: AssembleInput,
  limits?: ContextLimits,
): ContextPacket {
  const resolved = resolveContextLimits(limits);
  const captured = validateAndCopySnapshot(snapshot, resolved.maxRetainedBytes);

  const selection = parseAssembleInput(input, resolved);

  const byId = new Map(
    captured.sources.map((source) => [source.evidenceId, source]),
  );

  const selected = selection.evidenceIds.map((id) => {
    const source = byId.get(id);

    if (!source) {
      throw new ContextInputError('The selection refers to unknown evidence.');
    }

    return source;
  });

  const observations = captured.queries.flatMap((query) =>
    query.pages.flatMap((page, pageIndex) => [
      ...page.entries.flatMap((entry) =>
        entry.kind === 'source'
          ? []
          : [{ queryId: query.queryId, pageIndex, entry }],
      ),
      ...page.notices.map((notice) => ({
        queryId: query.queryId,
        pageIndex,
        notice,
      })),
    ]),
  );

  const queries = captured.queries.map((query) => ({
    queryId: query.queryId,
    request: query.request,
    status: query.status,
    recordedPages: query.pages.length,
  }));

  const incompleteQueries = queries.filter(
    (query) => query.status !== 'complete',
  ).length;

  /*
   * Build the JSON for one possible packet. render(1, 0) includes the first
   * selected source, but no non-source tool entries or tool notices. It still
   * reports omitted source IDs, the number of omitted observations and every
   * query's status. measure then checks whether this JSON fits.
   */
  function render(sourceCount: number, observationCount: number) {
    const included = selected.slice(0, sourceCount);
    const omittedEvidenceIds = Object.freeze(
      selected.slice(sourceCount).map((source) => source.evidenceId),
    );
    const omittedObservationCount = observations.length - observationCount;
    const notices: ContextNotice[] = [];

    if (omittedEvidenceIds.length > 0) {
      notices.push(
        contextNotice(
          'sources_omitted',
          `${String(omittedEvidenceIds.length)} selected source entries did not fit.`,
        ),
      );
    }

    if (omittedObservationCount > 0) {
      notices.push(
        contextNotice(
          'observations_omitted',
          `${String(omittedObservationCount)} navigation observations or notices did not fit.`,
        ),
      );
    }

    if (incompleteQueries > 0) {
      notices.push(
        contextNotice(
          'retrieval_incomplete',
          `${String(incompleteQueries)} recorded queries are open, partial or unavailable.`,
        ),
      );
    }

    const renderedContext = JSON.stringify({
      format: 'daphne-context-v1',
      identity: captured.identity,
      sources: included,
      omittedEvidenceIds,
      observations: observations.slice(0, observationCount),
      omittedObservationCount,
      queries,
      notices,
    });

    return {
      renderedContext,
      byteCount: Buffer.byteLength(renderedContext),
      includedEvidenceIds: Object.freeze(
        included.map((source) => source.evidenceId),
      ),
      omittedEvidenceIds,
      notices: Object.freeze(notices),
    };
  }

  /* Keep the exact rendering that passed the byte budget. */
  function measure(sourceCount: number, observationCount: number) {
    const candidate = render(sourceCount, observationCount);

    return { candidate, fits: candidate.byteCount <= selection.maxBytes };
  }

  /* Remove the lowest-priority whole excerpts first rather than clipping their text or reordering the host's selection. */
  let sourceCount = selected.length;
  let admitted = measure(sourceCount, 0);

  while (!admitted.fits && sourceCount > 0) {
    sourceCount -= 1;
    admitted = measure(sourceCount, 0);
  }

  if (!admitted.fits) {
    throw new ContextLimitError(
      'packet',
      'Mandatory context and omission bookkeeping cannot fit the packet budget.',
    );
  }

  /* Add navigation in recorded order only after sources fit, so it never displaces the host's prioritized evidence. */
  for (let count = 1; count <= observations.length; count += 1) {
    const next = measure(sourceCount, count);

    if (!next.fits) {
      break;
    }

    admitted = next;
  }

  const { candidate } = admitted;
  /* Keep v1 packet IDs stable for the byte-only callers that already use them. */
  const packetId = createHash('sha256')
    .update(
      JSON.stringify({
        format: 'daphne-context-v1',
        identity: captured.identity,
        renderedContext: candidate.renderedContext,
        tokenConfiguration: null,
        tokenCount: null,
      }),
    )
    .digest('hex');

  return Object.freeze({
    format: 'daphne-context-v1',
    packetId,
    identity: captured.identity,
    ...candidate,
    tokenCount: null,
  });
}

import { isDeepStrictEqual } from 'node:util';
import type { ToolResult } from '@daphne/review-evidence/contracts';
import type { ContextEngine } from './engine.js';
import { assembleCompleteEvidence } from './complete-evidence.js';

/*
 * Retain a returned tool result and render its exact query page for either writer.
 * Callers execute and copy the result first; this helper performs no I/O. For
 * example, a retried cursor selects its original page instead of the latest page.
 * Request mismatch fails before retention. Later packet failures may leave valid
 * evidence retained, but return no model output or delivery confirmation.
 */
export function retainToolEvidence(
  engine: ContextEngine,
  request: Record<string, unknown>,
  result: ToolResult,
  maxBytes: number,
): { output: string; includedEvidenceIds: readonly string[] } {
  const returnedRequest = Object.fromEntries(Object.entries(result.request));

  if (
    Object.entries(request).some(
      ([key, value]) => returnedRequest[key] !== value,
    )
  ) {
    throw new Error('The tool result does not answer the requested query.');
  }

  engine.addToolResult(result);
  const evidenceIds = result.entries.flatMap((entry) =>
    entry.kind === 'source' ? [engine.addSource(entry.source)] : [],
  );
  const normalizedRequest = { ...result.request, cursor: null };
  const query = engine
    .getEvidenceSnapshot()
    .queries.find((query) =>
      isDeepStrictEqual(query.request, normalizedRequest),
    );
  const pageIndex = query?.pages.findIndex(
    (page) => page.cursor === result.request.cursor,
  );

  if (!query || pageIndex === undefined || pageIndex < 0) {
    throw new Error('The retained tool result has no matching query page.');
  }

  const packet = assembleCompleteEvidence(engine, {
    evidenceIds,
    queryPages: [{ queryId: query.queryId, pageIndex }],
    maxBytes,
  });

  return {
    output: JSON.stringify({
      request: result.request,
      completeness: result.completeness,
      nextCursor: result.nextCursor,
      notices: result.notices,
      context: packet.renderedContext,
    }),
    includedEvidenceIds: packet.includedEvidenceIds,
  };
}

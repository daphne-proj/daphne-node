import { isDeepStrictEqual } from 'node:util';
import { createContextEngine } from '@daphne/context-engine';
import type { EvidenceSnapshot, RecordedPage } from '@daphne/context-engine';
import { parseToolRequest } from '@daphne/review-evidence';
import type { ToolRequest } from '@daphne/review-evidence/contracts';
import * as parse from '../parse.js';

/*
 * The judge can verify a scoped search occurred without treating its previews
 * as code citations. Each receipt names its requesting conversation and the
 * later turn that confirmed delivery, for example the writer at turn 6.
 * A complete empty page proves only no literal matches in that request's scope;
 * continuation cursors and limitations remain explicit.
 */
export interface IntentionSearchReceipt {
  toolNumber: number;
  conversationId: string;
  role: 'writer';
  candidateNumber: number;
  requestingTurnNumber: number;
  deliveredTurnNumber: number;
  queryId: string;
  pageIndex: number;
  request: Extract<ToolRequest, { name: 'search_code' }>;
  page: RecordedPage;
}

/*
 * Rebuild tool packets in execution order using the validated saved ledger.
 * Delivery reconstruction uses these exact packets instead of trusting a saved
 * delivered flag or ignoring navigation. A later cursor page cannot rewrite the
 * query status that an earlier tool response showed. Conflicting results,
 * foreign sources, altered navigation and incomplete copies throw before judging.
 */
export function parseIntentionToolEvidence(
  tools: readonly Record<string, unknown>[],
  snapshot: EvidenceSnapshot,
) {
  const engine = createContextEngine(snapshot.identity, {
    maxContextBytes: 8 * 1024 * 1024,
    maxRetainedBytes: 32 * 1024 * 1024,
  });

  for (const retained of snapshot.sources) {
    engine.addSource(retained.source);
  }

  return tools.map((tool) => {
    const result = parse.object(tool.result, 'tool.result');
    const request = parse.object(tool.request, 'tool.request');
    const call = parse.object(tool.call, 'tool.call');
    const args: unknown = JSON.parse(
      parse.text(call.arguments, 'tool.call.arguments'),
    );
    const expectedRequest = {
      ...parse.object(args, 'tool arguments'),
      name: call.name,
    };
    const returnedRequest = parse.object(result.request, 'tool.result.request');

    /* Validate required arguments while retaining the executor's actual page limits. */
    parseToolRequest(request);
    parseToolRequest(returnedRequest);

    const query = snapshot.queries.find((query) =>
      isDeepStrictEqual(query.request, { ...returnedRequest, cursor: null }),
    );
    const pageIndex = query?.pages.findIndex(
      (page) => page.cursor === returnedRequest.cursor,
    );
    const page = pageIndex === undefined ? undefined : query?.pages[pageIndex];

    if (!query || pageIndex === undefined || !page) {
      throw new parse.EvaluationError(
        'Tool result has no retained query page.',
      );
    }

    const entries = page.entries.map((entry) => {
      if (entry.kind !== 'source') {
        return entry;
      }

      const retained = snapshot.sources.find(
        (source) => source.evidenceId === entry.evidenceId,
      );

      if (!retained) {
        throw new parse.EvaluationError(
          'Tool page refers to unknown evidence.',
        );
      }

      return { kind: 'source' as const, source: retained.source };
    });
    const expectedResult = {
      identity: snapshot.identity,
      request: { ...query.request, cursor: page.cursor },
      entries,
      completeness: page.completeness,
      nextCursor: page.nextCursor,
      notices: page.notices,
    };

    if (
      !isDeepStrictEqual(request, expectedRequest) ||
      Object.entries(request).some(
        ([key, value]) => !isDeepStrictEqual(value, returnedRequest[key]),
      ) ||
      !isDeepStrictEqual(result, expectedResult)
    ) {
      throw new parse.EvaluationError(
        'Tool request or result differs from its call and retained query page.',
      );
    }

    engine.addToolResult(expectedResult);
    const ids = page.entries.flatMap((entry) =>
      entry.kind === 'source' ? [entry.evidenceId] : [],
    );
    const packet = engine.buildContextPacket({
      evidenceIds: [...new Set(ids)],
      queryPages: [{ queryId: query.queryId, pageIndex }],
      maxBytes: 8 * 1024 * 1024,
    });
    const output: unknown = JSON.parse(parse.text(tool.output, 'tool.output'));
    const serialized = parse.object(output, 'tool output');
    const rendered: unknown = JSON.parse(
      parse.text(serialized.context, 'tool output.context'),
    );
    const expectedContext: unknown = JSON.parse(packet.renderedContext);

    if (
      !isDeepStrictEqual(serialized.request, expectedResult.request) ||
      !isDeepStrictEqual(serialized.completeness, page.completeness) ||
      !isDeepStrictEqual(serialized.nextCursor, page.nextCursor) ||
      !isDeepStrictEqual(serialized.notices, page.notices) ||
      !isDeepStrictEqual(rendered, expectedContext) ||
      !isDeepStrictEqual(
        tool.includedEvidenceIds,
        packet.includedEvidenceIds,
      ) ||
      packet.omittedEvidenceIds.length > 0 ||
      packet.notices.some((notice) => notice.code === 'observations_omitted')
    ) {
      throw new parse.EvaluationError(
        'Tool output differs from its validated source and navigation packet.',
      );
    }

    const search =
      query.request.name === 'search_code'
        ? {
            queryId: query.queryId,
            pageIndex,
            request: { ...query.request, cursor: page.cursor },
            page,
          }
        : null;

    return { evidenceIds: packet.includedEvidenceIds, search };
  });
}

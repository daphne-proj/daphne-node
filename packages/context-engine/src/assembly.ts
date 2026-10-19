import { createHash } from 'node:crypto';
import type { ContextNotice } from '@daphne/review-evidence/contracts';
import type {
  AssembleInput,
  ContextPacket,
  EvidenceSnapshot,
  TokenBudget,
} from './contracts.js';
import { captureSnapshot } from './evidence.js';
import { ContextInputError, ContextLimitError } from './errors.js';
import { defaultContextLimits } from './limits.js';
import * as validate from './validation.js';

function inputData(value: unknown): AssembleInput {
  const input = validate.object(value);
  const evidenceIds = Object.freeze([
    ...new Set(
      validate.array(input.evidenceIds).map((id) => validate.string(id)),
    ),
  ]);
  const maxBytes = Math.min(
    validate.integer(input.maxBytes, 1),
    defaultContextLimits.maxContextBytes,
  );

  if (input.tokens === undefined) {
    return Object.freeze({ evidenceIds, maxBytes });
  }

  const tokens = validate.object(input.tokens);
  const counterId = validate.string(tokens.counterId);
  const maxTokens = validate.integer(tokens.maxTokens, 1);
  const counter = tokens.countTokens;

  if (typeof counter !== 'function') {
    throw new ContextInputError('A named token-counting function is required.');
  }

  const budget: TokenBudget = Object.freeze({
    counterId,
    maxTokens,
    async countTokens(rendered: string): Promise<number> {
      const value: unknown = await Reflect.apply(counter, undefined, [
        rendered,
      ]);

      return validate.integer(value);
    },
  });

  return Object.freeze({ evidenceIds, maxBytes, tokens: budget });
}

function contextNotice(code: string, message: string): ContextNotice {
  return Object.freeze({ code, message, path: null });
}

/** Assembles supplied data only. Capturing both inputs precedes the first asynchronous counter call. */
export async function assembleContext(
  snapshot: EvidenceSnapshot,
  input: AssembleInput,
): Promise<ContextPacket> {
  const captured = captureSnapshot(snapshot);
  const selection = inputData(input);
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

  async function measure(sourceCount: number, observationCount: number) {
    const candidate = render(sourceCount, observationCount);

    if (candidate.byteCount > selection.maxBytes) {
      return { candidate, fits: false, tokenCount: null };
    }

    const tokenCount = selection.tokens
      ? await selection.tokens.countTokens(candidate.renderedContext)
      : null;
    const fits =
      !selection.tokens ||
      (tokenCount !== null && tokenCount <= selection.tokens.maxTokens);

    return { candidate, fits, tokenCount };
  }

  let sourceCount = selected.length;
  let admitted = await measure(sourceCount, 0);

  while (!admitted.fits && sourceCount > 0) {
    sourceCount -= 1;
    admitted = await measure(sourceCount, 0);
  }

  if (!admitted.fits) {
    throw new ContextLimitError(
      'packet',
      'Mandatory context and omission bookkeeping cannot fit the packet budget.',
    );
  }

  // Navigation never displaces host-prioritized source. Keep first-seen query, page and item order.
  for (let count = 1; count <= observations.length; count += 1) {
    const next = await measure(sourceCount, count);

    if (!next.fits) {
      break;
    }

    admitted = next;
  }

  const { candidate, tokenCount } = admitted;
  const tokenConfiguration = selection.tokens
    ? {
        counterId: selection.tokens.counterId,
        maxTokens: selection.tokens.maxTokens,
      }
    : null;
  const packetId = createHash('sha256')
    .update(
      JSON.stringify({
        format: 'daphne-context-v1',
        identity: captured.identity,
        renderedContext: candidate.renderedContext,
        tokenConfiguration,
        tokenCount,
      }),
    )
    .digest('hex');

  return Object.freeze({
    format: 'daphne-context-v1',
    packetId,
    identity: captured.identity,
    ...candidate,
    tokenCount,
  });
}

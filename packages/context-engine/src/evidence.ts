import { createHash } from 'node:crypto';
import type {
  ReviewIdentity,
  SourceEvidence,
  ToolResult,
} from '@daphne/review-evidence/contracts';
import type {
  EvidenceSnapshot,
  RecordedPage,
  RecordedQuery,
  RetainedEntry,
  RetainedSource,
} from './contracts.js';
import {
  ContextConflictError,
  ContextInputError,
  ContextLimitError,
} from './errors.js';
import { defaultContextLimits } from './limits.js';
import * as validate from './validation.js';

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/* Reuse identical excerpts and reject disagreements in blob identity or overlapping bytes so retained source stays consistent. */
function insertSource(
  sources: RetainedSource[],
  incoming: SourceEvidence,
): string {
  const reference = JSON.stringify(incoming.ref);
  const bytes = Buffer.from(incoming.text);

  for (const retained of sources) {
    const existing = retained.source;

    if (JSON.stringify(existing.ref) === reference) {
      if (existing.text !== incoming.text) {
        throw new ContextConflictError(
          'The same source reference has conflicting text.',
        );
      }

      return retained.evidenceId;
    }

    if (
      existing.ref.commit !== incoming.ref.commit ||
      existing.ref.path !== incoming.ref.path
    ) {
      continue;
    }

    if (existing.ref.blobId !== incoming.ref.blobId) {
      throw new ContextConflictError(
        'The same committed path has conflicting blob identities.',
      );
    }

    /* Compare only the shared byte range; consistent overlaps remain separate excerpts with their own references. */
    const start = Math.max(
      existing.ref.range.startByte,
      incoming.ref.range.startByte,
    );
    const end = Math.min(
      existing.ref.range.endByte,
      incoming.ref.range.endByte,
    );

    if (start < end) {
      const previousBytes = Buffer.from(existing.text);
      const previousSlice = previousBytes.subarray(
        start - existing.ref.range.startByte,
        end - existing.ref.range.startByte,
      );
      const incomingSlice = bytes.subarray(
        start - incoming.ref.range.startByte,
        end - incoming.ref.range.startByte,
      );

      if (!previousSlice.equals(incomingSlice)) {
        throw new ContextConflictError('Overlapping source ranges disagree.');
      }
    }
  }

  const evidenceId = `evidence-${String(sources.length + 1)}`;
  sources.push(Object.freeze({ evidenceId, source: incoming }));

  return evidenceId;
}

/* Publish whole validated updates so a failed retention or page-recording operation leaves evidence IDs and query progress unchanged. */
export function createEvidenceLedger(
  identity: ReviewIdentity,
  maxRetainedBytes: number,
) {
  let state: EvidenceSnapshot = Object.freeze({
    identity: validate.identity(identity),
    sources: Object.freeze([]),
    queries: Object.freeze([]),
  });

  /* Include source text and query bookkeeping in the budget before replacing the snapshot visible to callers. */
  function commit(
    sources: readonly RetainedSource[],
    queries: readonly RecordedQuery[],
  ): void {
    const candidate = Object.freeze({
      identity: state.identity,
      sources: Object.freeze([...sources]),
      queries: Object.freeze([...queries]),
    });

    if (Buffer.byteLength(JSON.stringify(candidate)) > maxRetainedBytes) {
      throw new ContextLimitError(
        'retention',
        'The retained evidence budget would be exceeded.',
      );
    }

    state = candidate;
  }

  commit(state.sources, state.queries);

  return {
    /* Retain supplied source independently of tool history, allowing hosts to provide evidence read through other paths. */
    addSource: (value: SourceEvidence): string => {
      const source = validate.source(value, state.identity);
      const sources = [...state.sources];
      const evidenceId = insertSource(sources, source);
      commit(sources, state.queries);

      return evidenceId;
    },

    /* Retain a tool page and its sources together so its recorded progress always describes the evidence actually stored. */
    addToolResult: (value: ToolResult): void => {
      const result = validate.result(value, state.identity);

      /* A cursor selects a page, so exclude it from the identity shared by all pages of the same request. */
      const request = Object.freeze({ ...result.request, cursor: null });
      const queryId = digest(request);
      const previous = state.queries.find((query) => query.queryId === queryId);
      const fingerprint = digest(result);
      const retry = previous?.pages.find(
        (page) => page.cursor === result.request.cursor,
      );

      /* Identical retries are harmless, but replacing a recorded page would make earlier evidence ambiguous. */
      if (retry) {
        if (retry.fingerprint !== fingerprint) {
          throw new ContextConflictError(
            'The same query page has conflicting results.',
          );
        }

        return;
      }

      /* Compare opaque cursor values to enforce order without decoding or executing a retrieval continuation. */
      if (
        (!previous && result.request.cursor !== null) ||
        (previous &&
          (previous.status !== 'open' ||
            previous.pages.at(-1)?.nextCursor !== result.request.cursor))
      ) {
        throw new ContextConflictError(
          'The tool page does not continue the recorded query chain.',
        );
      }

      if (
        result.nextCursor !== null &&
        (result.nextCursor === result.request.cursor ||
          previous?.pages.some((page) => page.cursor === result.nextCursor))
      ) {
        throw new ContextConflictError(
          'The tool page creates a continuation cycle.',
        );
      }

      const priorLimitations =
        previous?.pages.some((page) => page.notices.length > 0) ?? false;

      if (priorLimitations && result.completeness === 'complete') {
        throw new ContextConflictError(
          'A terminal page cannot erase earlier retrieval limitations.',
        );
      }

      /* Store source text once even when several tool pages return the same excerpt. */
      const sources = [...state.sources];
      const entries: RetainedEntry[] = result.entries.map((entry) => {
        if (entry.kind !== 'source') {
          return entry;
        }

        return Object.freeze({
          kind: 'source',
          evidenceId: insertSource(sources, entry.source),
        });
      });
      const page: RecordedPage = Object.freeze({
        cursor: result.request.cursor,
        nextCursor: result.nextCursor,
        completeness: result.completeness,
        fingerprint,
        entries: Object.freeze(entries),
        notices: result.notices,
      });
      const pages = Object.freeze([...(previous?.pages ?? []), page]);
      let status: RecordedQuery['status'];

      if (result.nextCursor !== null) {
        status = 'open';
      } else if (result.completeness === 'complete') {
        status = 'complete';
      } else {
        status = pages.some((page) => page.entries.length > 0)
          ? 'partial'
          : 'unavailable';
      }

      const query: RecordedQuery = Object.freeze({
        queryId,
        request,
        pages,
        status,
      });
      const queries = [...state.queries];
      const index = queries.findIndex(
        (candidate) => candidate.queryId === queryId,
      );

      if (index < 0) {
        queries.push(query);
      } else {
        queries[index] = query;
      }

      commit(sources, queries);
    },

    /* Later commits replace state, leaving previously returned frozen snapshots safe for callers to keep. */
    snapshot: (): EvidenceSnapshot => {
      return state;
    },
  };
}

/* Rebuild snapshots, including those loaded from JSON, through the ledger to verify source IDs, page fingerprints and query progress before assembly. */
export function validateAndCopySnapshot(value: unknown): EvidenceSnapshot {
  const input = validate.object(value);
  const identity = validate.identity(input.identity);
  const ledger = createEvidenceLedger(
    identity,
    defaultContextLimits.maxRetainedBytes,
  );
  const sources = new Map<string, SourceEvidence>();

  for (const value of validate.array(input.sources)) {
    const retained = validate.object(value);
    const evidenceId = validate.string(retained.evidenceId);
    const source = validate.source(retained.source, identity);

    if (sources.has(evidenceId) || ledger.addSource(source) !== evidenceId) {
      throw new ContextInputError(
        'The snapshot has inconsistent source IDs or duplicate references.',
      );
    }

    sources.set(evidenceId, source);
  }

  const queries = validate.array(input.queries);

  for (const value of queries) {
    const query = validate.object(value);
    const request = validate.request(query.request);
    const queryId = validate.string(query.queryId);
    const pages = validate.array(query.pages);

    if (
      request.cursor !== null ||
      queryId !== digest(request) ||
      pages.length === 0
    ) {
      throw new ContextInputError(
        'The snapshot has inconsistent query identity.',
      );
    }

    for (const value of pages) {
      const page = validate.object(value);
      const entries = validate.array(page.entries).map((value) => {
        const entry = validate.object(value);

        if (entry.kind !== 'source') {
          return entry;
        }

        const source = sources.get(validate.string(entry.evidenceId));

        if (!source) {
          throw new ContextInputError(
            'A recorded page refers to unknown evidence.',
          );
        }

        return { kind: 'source', source };
      });
      const result = validate.result(
        {
          identity,
          request: { ...request, cursor: page.cursor },
          entries,
          completeness: page.completeness,
          nextCursor: page.nextCursor,
          notices: page.notices,
        },
        identity,
      );

      if (digest(result) !== page.fingerprint) {
        throw new ContextConflictError(
          'Recorded page content does not match its fingerprint.',
        );
      }

      ledger.addToolResult(result);
    }

    const reconstructed = ledger
      .snapshot()
      .queries.find((candidate) => candidate.queryId === queryId);

    if (
      !reconstructed ||
      reconstructed.status !== query.status ||
      reconstructed.pages.length !== pages.length
    ) {
      throw new ContextInputError(
        'The snapshot has inconsistent query progress.',
      );
    }
  }

  const captured = ledger.snapshot();

  if (captured.queries.length !== queries.length) {
    throw new ContextInputError('The snapshot contains duplicate queries.');
  }

  return captured;
}

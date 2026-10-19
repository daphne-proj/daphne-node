# Context engine

This package remembers evidence already supplied by a host and assembles selected evidence into a bounded JSON context string. It does not open repositories, fetch PRs, execute tools, choose searches or call a model.

Its only workspace imports are types from `@daphne/review-evidence/contracts`. Commit, blob, path and range fields are provenance data. They are not Git handles.

## Retention and assembly are different operations

`retain(source)` validates a source excerpt and returns a session-local evidence ID. Repeating the same reference and text reuses its ID. Different text, conflicting blob identity or contradictory overlapping bytes fail. Consistent overlaps stay separate.

`record(result)` records a complete supplied tool page, retains its source entries and tracks query progress. Search previews stay navigation. Recording is atomic: a bad entry or exceeded retention budget leaves sources, IDs and pagination unchanged.

An identical page retry is a no-op. Continuations must follow the previously recorded opaque cursor for the same normalized query. The engine compares cursor strings but never authenticates, decodes or follows them. A failed retrieval call has no result to record; an unavailable result remains unavailable.

`evidence()` returns a frozen snapshot. `assemble(input)` captures that snapshot and builds a new packet without changing retention. The standalone `assembleContext(snapshot, input)` also accepts a JSON-roundtripped snapshot, validating it before use.

## Host example

Assume the host has acquired `snapshot` and created a borrowing review-evidence `session`. The following code belongs to the host:

```ts
import {
  createContextEngine,
  defaultContextLimits,
} from '@daphne/context-engine';

const context = createContextEngine(session.identity, defaultContextLimits);

try {
  const page = await session.execute({
    name: 'inspect_change',
    changeId: 'change-1',
  });

  context.record(page);
} finally {
  await snapshot.close();
}

const packet = await context.assemble({
  evidenceIds: context.evidence().sources.map((entry) => entry.evidenceId),
  maxBytes: 65_536,
});
```

Git has already closed when assembly runs. The host chooses source priority through the order of `evidenceIds`; unknown IDs fail instead of triggering retrieval. Repeated selected IDs are deduplicated.

## Budgets and admission

The default ledger limit is **4,194,304 bytes (4 MiB)** of deterministic serialized JSON. It includes identity, unique source records, query/page bookkeeping, navigation and notices. Page history references retained source IDs instead of duplicating source text. This gives a single investigation room to retain substantially more than one packet while maintaining a clear bound. It is a starting policy, not a measured optimal size or an exact JavaScript heap quota.

The independent packet limit is **65,536 bytes (64 KiB)**. Overrides may lower either limit. Retention overflow throws `ContextLimitError` without eviction or partial writes.

Assembly first admits a whole prefix of host-prioritized sources, then a whole prefix of recorded navigation/notices without displacing those sources. It never clips an excerpt. Query summaries, omitted source IDs, observation omission counts and incomplete-retrieval notices remain explicit. If mandatory bookkeeping cannot fit, assembly fails.

`byteCount` measures the exact UTF-8 `renderedContext`, including JSON escaping and bookkeeping. The outer packet metadata is not part of this budget. These bytes are not a model token estimate.

An optional `tokens` input contains `counterId`, `maxTokens` and an asynchronous `countTokens(renderedContext)` function. Supply the relevant tokenizer externally. Counts must be nonnegative safe integers; without a counter, `tokenCount` is null. Inputs are captured before awaiting it. The host owns counter failure, cancellation and latency.

## Identity, errors and limits of the guarantee

The SHA-256 packet ID includes the rendering, identity/format and token-counter configuration/count. It identifies this constructed packet; it does not prove model delivery or authenticate supplied evidence.

- `ContextInputError`: malformed or foreign data, unknown selection, inconsistent supplied snapshot or invalid counts.
- `ContextConflictError`: conflicting evidence, page retries, continuation order or fingerprints.
- `ContextLimitError`: retained data or mandatory packet content cannot fit.

Validation checks internal consistency. The evidence producer establishes correspondence to real repository bytes; this package cannot prove that correspondence without violating its acquisition boundary.

The first version validates and reconstructs a supplied snapshot during assembly and uses simple linear scans. Worst-case latency near the retention cap has not been benchmarked. Add incremental accounting or lookup maps only when measurement justifies them.

See the [walkthrough](../../docs/context-engine-walkthrough.md) and [boundary ADR](../../docs/adr/0002-context-engine-boundary.md) for decisions and observed verification.

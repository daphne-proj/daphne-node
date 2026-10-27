# Context and paging guide

See the [package overview](../README.md) for the main APIs, types and dependencies.

`@daphne/context-engine` turns supplied source evidence into bounded, traceable context. It retains exact excerpts, checks their consistency, and prepares JSON packets or diff text pages for a caller.

The package owns no repository, retrieval policy, prompts or model generation. Its only workspace imports are types from `@daphne/review-evidence/contracts`; emitted JavaScript uses Node.js facilities such as `Buffer` and `node:crypto`. Its package manifest still declares the evidence dependency for those contracts. **Semantic-split depends on context-engine; context-engine does not depend on semantic-split.** Other Node hosts can use it with compatible evidence, including saved JSON.

## Two independent APIs

| API                                              | Input and output                                                     | When evidence is too large                                                    |
| ------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `createContextEngine()` / `buildContextPacket()` | Retain evidence, then select IDs for one JSON `ContextPacket`        | Omit whole lower-priority excerpts and report their IDs                       |
| `splitDiffIntoContextPages()`                    | Supply `DiffContextHunk[]` and receive text `DiffContextPage` values | Divide the input into smaller pages while preserving all supplied source text |

Paging does not use or modify the retained ledger. The current `context inspect` CLI uses retention and assembly; `semantic-split` uses the pager directly.

## Evidence and identity

| Type             | Purpose                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `ReviewIdentity` | Identifies the session, repository, target commit, merge-base commit and head commit                 |
| `SourceEvidence` | Pairs exact `text` with a `SourceRef`: session, BASE/HEAD side, commit, path, blob ID and byte range |
| `Change`         | Describes a changed file, its status and content kind, and before/after hunk coordinates             |
| `ToolResult`     | Records a retrieval request, entries, completeness, next cursor and notices                          |

Byte ranges are zero-based and half-open: `[100, 140)` contains 40 original UTF-8 bytes. Validation checks well-formed text, range length, session and side/commit consistency. The evidence producer establishes correspondence with real repository bytes; context-engine checks supplied data without reading Git.

An `evidenceId`, such as `evidence-1`, identifies a retained excerpt. A `unitId`, such as `change-1:0`, identifies a change/hunk for paging. Several source excerpts and pages can belong to the same unit.

## Add evidence and build a packet

`createContextEngine(identity, limits)` creates one in-memory ledger and exposes:

| Method                      | Role                                                                        |
| --------------------------- | --------------------------------------------------------------------------- |
| `addSource(source)`         | Store an excerpt and return its session-local evidence ID                   |
| `addToolResult(result)`     | Atomically retain a supplied tool page, its sources and query progress      |
| `getEvidenceSnapshot()`     | Return a frozen `EvidenceSnapshot` containing identity, sources and queries |
| `buildContextPacket(input)` | Build a packet from selected evidence IDs without changing the ledger       |

The internal `insertSource()` reuses identical references and text. Conflicting text, blob identities or overlapping bytes fail; consistent overlaps remain separate excerpts. `commit()` checks the entire serialized ledger before publishing an update, so failures leave IDs, evidence and query progress unchanged.

`RecordedPage` entries reference retained sources by ID instead of duplicating text. Search previews remain navigation. `RecordedQuery` groups pages of one request and tracks `open`, `complete`, `partial` or `unavailable` status. Identical retries are no-ops; conflicting retries, cycles and out-of-order pages fail. The engine compares opaque cursors but never follows them, and later pages cannot erase earlier retrieval limitations.

Line-read `source_window` entries remain navigation. Validation checks the request, side, path and fragment range without reading the repository. Each successful page includes consistent window metadata and exact source fragments, including an empty source for an empty file. Only those fragments become citable retained evidence.

Given a supplied `identity` and `sources`, direct retention needs no live repository:

```ts
import {
  createContextEngine,
  defaultContextLimits,
} from '@daphne/context-engine';

const context = createContextEngine(identity, defaultContextLimits);
const evidenceIds = sources.map((source) => context.addSource(source));

const packet = context.buildContextPacket({
  evidenceIds,
  maxBytes: 65_536,
});
```

Alternatively, the host calls `session.execute(request)`, passes each returned page to `context.addToolResult(result)`, and follows `nextCursor` when it wants complete retrieval. The host owns Git cleanup and can close Git before assembly.

`buildContextPacket(snapshot, input)` also accepts snapshots loaded from JSON. Its internal `validateAndCopySnapshot()` reconstructs and validates source IDs, page fingerprints and query progress. Assembly then:

1. Deduplicates selected IDs in caller order and rejects unknown IDs.
2. Renders all selected sources with mandatory query and omission bookkeeping.
3. Removes whole sources from the end until the candidate fits. For `[A, B, C]`, it may include `[A, B]` and report `C` as omitted; it never clips source text.
4. Adds navigation and tool notices in recorded order while they fit, without displacing sources.

The `ContextPacket` contains `renderedContext`, included/omitted evidence IDs, notices, byte count, legacy `tokenCount: null` and a SHA-256 `packetId`. Omissions and incomplete retrieval remain explicit. Mandatory bookkeeping that cannot fit causes failure. The ID identifies the rendering with null legacy token fields; it does not authenticate evidence or prove model delivery.

## Page a supplied diff

Each `DiffContextHunk` contains a `change`, a zero-based `hunkIndex`, and exact sources for its existing sides in BASE-then-HEAD order. For a change without readable text hunks, supply `hunkIndex: null` and `sources: []`; its unit ID ends in `:metadata`. Empty insertion/deletion anchors remain explicit sources, while missing file sides are absent.

Given supplied `identity` and `hunks`, the host provides counting and page consumption:

```ts
import { splitDiffIntoContextPages } from '@daphne/context-engine';

for await (const page of splitDiffIntoContextPages({
  identity,
  hunks,
  tokens: {
    counterId: 'request-counter-v1',
    maxTokens: 2_000,
    countTokens: countRequestTokens,
  },
})) {
  await consumePage(page);
}
```

Here, `countRequestTokens(context)` counts the complete intended request, including instructions, schema, tools and history as applicable. `consumePage(page)` is also host-owned. Each `DiffContextPage` contains `unitIds`, rendered `context` and the accepted `inputTokens` count.

### How splitting works

`validateAndCopyHunk()` validates and copies all evidence before the first asynchronous count, assigning IDs such as `change-1:0`. The internal `render()` repeats commit, change, path, mode, hunk, side and byte-range metadata so each fragment remains identifiable.

The recursive `paginate()` function:

1. Renders all candidate hunks together.
2. Checks the **65,536-byte** ceiling first. Only candidates within it invoke the token counter.
3. Yields a page if its count is within `maxTokens`.
4. Otherwise divides a multi-hunk list into ordered halves and processes the left half before the right.
5. If one hunk remains too large, separates its BASE and HEAD sources.
6. If one source remains too large, calls `splitSource()` and repeats the checks on its fragments.

`splitSource()` cuts near the byte midpoint, preferring a newline and falling back to a UTF-8 character boundary. It adjusts absolute ranges and preserves original bytes, whitespace, CRLF and final newlines. Every fragment keeps its original unit ID. Page boundaries express size limits, not semantic groups; the algorithm does not guarantee the fewest pages.

The async iterator yields pages as the caller requests them; `yield*` forwards child pages in order. Supply each change/hunk pair once and consume the iterator to completion to preserve all supplied text. Empty input yields no pages or counts. There is no total-diff source cutoff, but input evidence is captured in memory: page limits do not cap total memory. Stopping early or encountering an error leaves paging unfinished. The host owns cancellation, including any pending counter call.

## Worked example: two edits to a retry policy

Suppose `src/retry.ts` changes as follows, using LF line endings and a final newline:

```diff
 export function canRetry(attempt: number): boolean {
-  return attempt < 3;
+  return attempt < 5;
 }

 export function retryDelayMs(): number {
-  return 100;
+  return 250;
 }
```

1. **Acquire:** `resolvePullRequest()` and `acquireSnapshot()` pin the comparison. `listSnapshotChanges()` finds `change-1` with two hunks, on lines 2 and 6.
2. **Read:** `session.readHunk()` uses `lineRangeToBytes()` and `sourceFromBlob()` to supply BASE/HEAD excerpts for each hunk:

   | Unit         | BASE text                   | HEAD text                   | Byte range on either side |
   | ------------ | --------------------------- | --------------------------- | ------------------------- |
   | `change-1:0` | `"  return attempt < 3;\n"` | `"  return attempt < 5;\n"` | `[53, 75)`                |
   | `change-1:1` | `"  return 100;\n"`         | `"  return 250;\n"`         | `[119, 133)`              |

3. **Page:** supply two `DiffContextHunk` entries. Suppose counting both together returns **1,200 tokens**. A 2,000-token allowance produces one page containing both unit IDs.
4. **Split if necessary:** with a 1,000-token allowance, the candidate is divided. If the separate counts are 800 and 750, the result is two pages. That requires three counting calls: one rejected combined candidate and two accepted pages. These counts are illustrative.
5. **Generate:** in the current `semantic-split` caller, `groupingRequest()` wraps context in instructions and an output schema; `createOpenAI().count()` supplies the pager's counter. One page goes directly to grouping generation. Multiple pages receive separate analyses before their notes are grouped. Git is already closed.
6. **Validate:** `getExpectedUnitIds()` derives the two required IDs from the inventory. `validateProposal()` checks that the model assigns each exactly once; the caller owns corrections and semantic policy.

The retained-ledger path is separate: `session.execute({ name: 'inspect_change', changeId: 'change-1' })` includes surrounding lines. In this small file its windows merge into two whole-file excerpts, one per side. `addToolResult()` retains those as `evidence-1` and `evidence-2`; `getEvidenceSnapshot()` exposes them and `buildContextPacket()` can include both in a JSON packet. The `context inspect` CLI writes that packet without calling a model.

## Budgets and failures

| Budget                  | Default                 | Measurement                                                                 |
| ----------------------- | ----------------------- | --------------------------------------------------------------------------- |
| Retention               | 4,194,304 bytes (4 MiB) | Serialized identity, unique sources, queries, pages, navigation and notices |
| Packet / diff-page text | 65,536 bytes (64 KiB)   | Exact UTF-8 rendered context, including headers or JSON escaping            |

Engine overrides allow packets up to 8 MiB and retention up to 32 MiB. Standalone callers can pass the same limits as the third argument to `buildContextPacket(snapshot, input, limits)`; omitting them preserves the defaults. Diff pages keep their 64 KiB ceiling. Retention overflow fails without eviction. Packet `byteCount` excludes the outer packet metadata; retention accounting is not an exact JavaScript heap quota.

Assembly is synchronous and byte-bounded, preserves existing byte-only v1 packet IDs, and rejects a supplied token budget. Paging requires a `TokenBudget` containing `counterId`, `maxTokens` and asynchronous `countTokens(context)`. Counts must be nonnegative safe integers. The host must count its complete request, reserve output capacity and enforce counter deadlines. Counter failures propagate.

- `ContextInputError`: malformed or foreign evidence, unknown selections, inconsistent snapshots, invalid hunks or counts.
- `ContextConflictError`: conflicting source bytes, page retries, fingerprints or continuation chains.
- `ContextLimitError`: retention overflow, mandatory packet content that cannot fit, or an indivisible diff fragment that exceeds a page budget.

Internal consistency and complete paging do not prove semantic correctness, model delivery or independently applicable review groups. Assembly reconstructs snapshots and uses linear scans; worst-case latency near the retention cap has not been benchmarked.

See the [boundary ADR](../../../docs/adr/0002-context-engine-boundary.md) for ownership decisions and [public contracts](../src/contracts.ts), [assembly](../src/assembly.ts) and [paging](../src/paging.ts) for the implementation.

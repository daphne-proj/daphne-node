# Context guide

See the [package overview](../README.md) for the main APIs, types and dependencies.

`@daphne/context-engine` turns supplied source evidence into bounded, traceable context. It retains exact excerpts, checks their consistency, and prepares JSON packets for a caller.

The package owns no repository, retrieval policy, prompts or model generation. Its only workspace imports are types from `@daphne/review-evidence/contracts`; emitted JavaScript uses Node.js facilities such as `Buffer` and `node:crypto`. Its package manifest still declares the evidence dependency for those contracts. **Semantic-split depends on context-engine; context-engine does not depend on semantic-split.** Other Node hosts can use it with compatible evidence, including saved JSON.

## Evidence and identity

| Type             | Purpose                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `ReviewIdentity` | Identifies the session, repository, target commit, merge-base commit and head commit                 |
| `SourceEvidence` | Pairs exact `text` with a `SourceRef`: session, BASE/HEAD side, commit, path, blob ID and byte range |
| `Change`         | Describes a changed file, its status and content kind, and before/after hunk coordinates             |
| `ToolResult`     | Records a retrieval request, entries, completeness, next cursor and notices                          |

Byte ranges are zero-based and half-open: `[100, 140)` contains 40 original UTF-8 bytes. Validation checks well-formed text, range length, session and side/commit consistency. The evidence producer establishes correspondence with real repository bytes; context-engine checks supplied data without reading Git.

An `evidenceId`, such as `evidence-1`, identifies a retained excerpt. A `unitId`, such as `change-1:0`, identifies an original change/hunk for grouping. Several source excerpts can belong to the same unit.

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

An optional `queryPages` array selects navigation independently of `evidenceIds`. Each `QueryPageSelection` names a retained `queryId` and its original zero-based `pageIndex`. Omitting the option preserves the full history and existing packet IDs; an empty array includes no queries or navigation. Assembly validates the complete snapshot before applying this selection and rejects unknown queries, duplicate pairs and invalid page indexes.

Selected pages retain ledger order and their original indexes. Each selected query appears once with its actual retained status and total recorded page count, even when only one page is selected. These summaries describe retrieval progress, not model delivery. Omission counts cover selected content that cannot fit, not deliberately unselected history. Source selection, exact bytes and retention are unchanged.

Intentions tool replies select the page matching the returned request and cursor, including retries of earlier pages. For example, a reply to the third lookup no longer repeats navigation from the first two lookups. The original diff and prior tool replies remain in the continuing model history.

## Retain a complete diff

Call `validateDiffInput(input)` for inventory validation, then `retainDiff(input, engine, mappings)` before model work. Each `DiffContextHunk` contains the original change, zero-based hunk index and exact sources for existing sides in BASE-then-HEAD order. A change without text hunks uses a null index and no source text. Empty insertion/deletion anchors remain explicit sources.

Retention requires each expected change/hunk pair exactly once and checks its coordinates, paths and sources against the inventory. `DiffHunkEvidence` records the corresponding evidence IDs. Input failures preserve earlier retained evidence for diagnostics.

Use `assembleCompleteEvidence(engine, { evidenceIds, maxBytes, queryPages })` when all selected evidence and observations must fit. It rejects packet omissions. Workflows count prompts, tools, schema and growing history themselves and fail explicitly on capacity exhaustion.

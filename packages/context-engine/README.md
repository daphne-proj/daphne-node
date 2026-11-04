# Context engine

`@daphne/context-engine` retains supplied evidence and assembles bounded, traceable JSON context. Intentions and semantic-split share its original-diff helpers; inspection uses explicit evidence selection. Retrieval, Git lifetime, prompts and model calls belong to callers.

## Main APIs

| API                                                                | Purpose                                                                              |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `createContextEngine(identity, limits)`                            | Retain sources and tool results; expose a snapshot and packet assembly.              |
| `validateDiffInput(input)` / `retainDiff(input, engine, mappings)` | Validate the inventory and retain each original hunk or metadata entry exactly once. |
| `retainToolEvidence(engine, request, result, maxBytes)`            | Check request agreement, retain returned evidence and render its exact cursor page.  |
| `assembleCompleteEvidence(engine, input)`                          | Build a packet and reject omitted evidence or observations.                          |
| `buildContextPacket(snapshot, input)`                              | Assemble selected evidence, reporting any omissions.                                 |
| `validateAndCopySnapshot(value, maxRetainedBytes?)`                | Validate saved source IDs, bytes and query chains.                                   |

`initialLimitations` and `retrievalLimitations` derive the shared evidence notices.

`DiffContextHunk` contains original BASE/HEAD sources; `DiffHunkEvidence` maps the change/hunk pair to retained evidence IDs. `EvidenceSnapshot` holds the pinned identity, sources and query history. `AssembleInput` selects evidence and optional query pages; `ContextPacket` records included/omitted content and rendered bytes.

## Flow and limits

Validate and retain exact sources, reuse identical evidence, and reject conflicting provenance or bytes. Tool cursor pages retain navigation and completeness separately from source excerpts. Assembly selects whole sources in caller order; the complete-evidence helper fails if anything selected is omitted. Model workflows count their entire requests separately.

Defaults allow 4 MiB retained data and 64 KiB rendered context; callers may raise these to 32 MiB and 8 MiB. Input, conflict and capacity failures have distinct errors. Consistency checks do not authenticate Git contents or establish semantic correctness.

Only evidence contract types cross the workspace boundary. Node `Buffer` measures UTF-8 bytes and `node:crypto` supplies fingerprints. There is no repository or model I/O. See the [context guide](docs/context-and-paging.md) and [boundary decision](../../docs/adr/0002-context-engine-boundary.md).

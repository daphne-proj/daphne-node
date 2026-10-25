# Review evidence

`@daphne/review-evidence` turns pinned Git data into exact source excerpts and bounded repository-tool results. It supplies provenance for context building and semantic splitting. Sessions borrow a Git snapshot; the acquiring caller chooses retrieval policy and closes Git. Returned evidence remains usable after cleanup.

## Main APIs

`createEvidenceSession(snapshot, options)` returns an `EvidenceSession` with:

| Method                              | Purpose                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `readSource({ side, path, range })` | Return exact UTF-8 text at a byte range, with its source reference.                                                                 |
| `readHunk({ changeId, hunkIndex })` | Read an original hunk's existing sides in BASE-then-HEAD order.                                                                     |
| `execute(request)`                  | Validate and run `list_changes`, `inspect_change`, `read_source`, `read_source_lines` or `search_code`, with bounded responses and continuation cursors. |

`parseToolRequest` normalizes tool requests; `defaultEvidenceLimits` and `resolveEvidenceLimits` configure delivery budgets. Import data types through `@daphne/review-evidence/contracts` when retrieval code is unnecessary.

## Main types

- `ReviewIdentity` / `Change`: pinned comparison provenance and file/hunk inventory.
- `SourceEvidence` / `SourceRef` / `ByteRange`: original text paired with commit, path, blob ID and zero-based, half-open UTF-8 offsets.
- `ToolRequest` / `ToolResult`: normalized operations, entries, notices, completeness and the next cursor.
- `EvidenceOperationOptions` / `EvidenceLimits`: cancellation, Git limits and separate tool response/page limits.

## How it works

1. Borrow the snapshot and read committed blobs through `git-source`'s public APIs.
2. Validate UTF-8 and ranges, then attach exact source provenance. Hunk reads preserve empty insertion/deletion anchors and omit absent file sides.
3. For tool calls, fit entries into the response budget and return authenticated, retryable cursors when more delivery is possible. The host follows cursors and decides which results to retain.

`git-source` is the only runtime package dependency and owns all repository I/O. Node `Buffer` handles byte boundaries; `node:crypto` authenticates session-local cursors. Context retention, model calls and semantic grouping remain with their owning packages.

Line reads select one-based source lines and return exact bytes with window metadata; oversized windows continue through cursors.

Tool defaults are 16 KiB per JSON response and 100 items per entries/notices array. Direct source/hunk reads use Git's blob limits instead. Search previews are navigation, not exact evidence; a null cursor alone does not prove completeness. Input, source-availability and response-budget failures have distinct error types.

See the [retrieval guide](docs/retrieval.md) for examples, cursor semantics and failure behavior, or the [contracts](src/contracts.ts) for data shapes.

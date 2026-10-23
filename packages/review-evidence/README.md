# Review evidence

`@daphne/review-evidence` turns pinned Git data into validated evidence with provenance. Its sessions borrow a Git snapshot; the acquiring caller owns cleanup.

## What belongs here

- Exact source ranges and original hunk spans, with commit, path, blob ID and byte offsets.
- UTF-8/range validation, source availability errors and evidence data contracts.
- Bounded repository tools: list changes, inspect changes, read source and search code, including response limits and continuation cursors.

`createEvidenceSession` exposes `readSource`, `readHunk` and `execute`. The `@daphne/review-evidence/contracts` export contains I/O-free data types for consumers that only need supplied evidence.

## Boundaries

| Responsibility                                                      | Owner                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------- |
| PR acquisition, retrieval policy and snapshot cleanup               | `pr-review` or another acquiring caller                   |
| Git subprocesses, snapshot storage, inventory cache and blob access | `git-source`                                              |
| Retaining evidence and packing it into model context pages          | `context-engine`                                          |
| Semantic grouping, coverage decisions and corrections               | `semantic-split`                                          |
| Model calls and provider responses                                  | `review-agent`                                            |
| Syntax extraction and code index construction                       | Their dedicated extractor/index packages when implemented |

Repository I/O goes through `git-source`. Evidence returned to the caller remains usable after the snapshot closes. The sections below describe the retrieval interface in more detail.

## What is a blob?

Git stores a file's contents as a **blob**. A commit's tree connects a file path, such as src/cart.ts, to that blob. BASE and HEAD can point to different blobs for the same path.

The blob ID identifies the committed contents. The evidence result includes that ID, so you can trace the excerpt to the exact version Git read.

## Example: read a changed line

Suppose the file has this content in BASE:

```ts
export function total(price: number): number {
  return price;
}
```

And this in HEAD:

```ts
export function total(price: number): number {
  return price * 1.2;
}
```

A Git diff shows the changed line:

```diff
@@ -1,3 +1,3 @@
 export function total(price: number): number {
-  return price;
+  return price * 1.2;
 }
```

Assume the host has already acquired a Git snapshot for those BASE and HEAD commits. The host creates an evidence session that borrows that snapshot:

```ts
const session = createEvidenceSession(snapshot, {
  signal: abortController.signal,
  gitLimits: defaultGitLimits,
  limits: defaultEvidenceLimits,
});
```

The changed line starts at byte 47 in both files. These files use only ASCII characters, so their byte ranges are:

- BASE: [47, 63), including the newline.
- HEAD: [47, 69), including the newline.

Ranges are zero-based and half-open: the start is included and the end is excluded. Read each side like this:

```ts
const before = await session.readSource({
  side: 'base',
  path: 'src/cart.ts',
  range: { startByte: 47, endByte: 63 },
});

const after = await session.readSource({
  side: 'head',
  path: 'src/cart.ts',
  range: { startByte: 47, endByte: 69 },
});
```

The returned text is the changed line and newline for each side. Each result also carries a reference containing the side, commit, path, blob ID, and byte range.

The host owns the snapshot and must close it when finished. Closing the snapshot prevents more reads, but evidence already returned is ordinary data and remains available.

## How the pieces fit

1. The host acquires a snapshot of the exact commits to compare.
2. Git-source finds the requested path in the selected commit and reads its blob bytes.
3. Review-evidence validates the range and UTF-8 text, then returns the excerpt with provenance.
4. The host decides what to do with that evidence. The context engine can retain and assemble supplied evidence without opening Git.

The direct `readSource` method accepts byte ranges and retains the Git blob cap. Use `execute` when the response must obey the separate tool byte/page limits.

## Read one original hunk

Use a change ID from `list_changes` and a zero-based index into its `hunks`:

```ts
const sources = await session.readHunk({
  changeId: change.id,
  hunkIndex: 0,
});
```

The session reads the exact hunk spans from its pinned commits and returns existing sides in BASE-then-HEAD order. Each source carries the same provenance as `readSource`. A missing file side is omitted; an existing side with no changed lines returns empty text at its original byte anchor. The two sides may have different lengths.

Unknown changes, invalid indexes and changes without text hunks throw `EvidenceInputError`. Blob-read failures and cancellation propagate; a failed read never returns a partial source array. Like `readSource`, this method uses the session's Git limits rather than tool response/page limits. It prepares source only; it does not paginate context or call a model.

`inspect_change` continues to add three surrounding lines and merge nearby windows. `readHunk` returns only the selected original hunk.

The host can collect these sources with their original change/hunk indexes and pass the entries with the session identity to [`paginateDiffContext`](../context-engine/README.md#page-supplied-diff-hunks) in `@daphne/context-engine`. The pager packs supplied hunks together and splits oversized evidence. Consume its pages completely and follow every inventory cursor for a whole comparison. Changes without readable text hunks use a metadata-only entry; a failed source read must still be reported as unfinished work.

## Bounded repository tools

The session now also accepts four validated requests: `list_changes`, `inspect_change`, `read_source` and `search_code`. The host chooses requests; the session never invokes a model or a context engine.

```ts
const page = await session.execute({
  name: 'list_changes',
  pageSize: 10,
});

if (page.nextCursor !== null) {
  const next = await session.execute({
    ...page.request,
    cursor: page.nextCursor,
  });

  console.log(next.entries);
}
```

Import `defaultEvidenceLimits` from the package alongside `createEvidenceSession`. Defaults cap the entire JSON response at 16,384 UTF-8 bytes and each entries/notices array at 100 items. Requests may lower the response cap, and list/search may lower the page size. Session limits always win.

Inspection supplies change metadata and source windows with a three-line margin, merged on each side/path. Search uses literal, case-sensitive, single-line text and an optional literal path prefix. It searches committed regular text files, not untracked files or submodule contents; it returns navigation previews, not exact source evidence. Candidate blobs that cannot be materialized produce explicit notices.

Continuation requests keep the returned normalized arguments and effective limits. Cursors are authenticated, local to this evidence-session instance and retryable. Changing a query or reusing a token in another session is an input error. Do not parse or edit tokens.

A `complete` result has no continuation or coverage limitation. A `partial` result may offer another page, or may end with notices explaining unavailable information. `unavailable` means no requested evidence could be supplied. A null cursor alone does not establish completeness.

Source pages carry contiguous ranges on UTF-8 boundaries. The byte cap includes all JSON metadata and escaping, so a small budget may leave little room for text. An envelope or indivisible item that cannot fit throws `EvidenceLimitError`. Git output limits, deadlines and cancellation remain operation failures.

Continuation recomputes bounded observations; it does not keep a response cache or a growing cursor registry. Git-source reuses a completed, frozen inventory for the same snapshot and blob/output byte limits, so individual hunk reads do not rescan the comparison. Changed byte limits require a fresh inventory; cancelled and closed snapshots still reject reads. Underlying Git search/inventory must finish within their own limits. Pagination bounds delivery, not total query work. The host must supply an overall workflow deadline if needed.

For the wider package boundaries, see [the architecture guide](../../docs/architecture.md) and [the implementation walkthrough](../../docs/context-engine-walkthrough.md).

# Review evidence

@daphne/review-evidence turns bytes from a pinned Git commit into a source excerpt with a record of where it came from.

It does not decide what the reviewer should inspect, build a code index, or parse code into functions or symbols. A caller asks for a file and byte range. The package checks that the range is safe text and returns the excerpt with its commit and Git blob ID.

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
4. The host decides what to do with that evidence. A future context engine can retain and assemble supplied evidence without opening Git.

This version accepts byte ranges directly. Mapping diff hunk line numbers to byte ranges and bounded repository tools are planned for a later step.

For the wider package boundaries, see [the architecture guide](../../docs/architecture.md) and [the implementation walkthrough](../../docs/context-engine-walkthrough.md).

# Git source

`@daphne/git-source` provides an immutable view of two repository revisions: their merge base, changed files and hunks, and exact committed bytes. It is Daphne's Git I/O layer, used by PR workflows and evidence retrieval. It owns temporary repositories and subprocess controls; the acquiring caller owns when to close a snapshot.

## Main APIs

| API                                          | Purpose                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `acquireSnapshot(input, options)`            | Fetch exact commits and return a pinned snapshot with `identity` and asynchronous `close()`.           |
| `listSnapshotChanges(snapshot, options)`     | Return a deterministic inventory of file changes and original hunk coordinates.                        |
| `readSnapshotBlob(snapshot, input, options)` | Read a regular file's original bytes and blob identity from BASE or HEAD.                              |
| `searchSnapshot(snapshot, input, options)`   | Find committed files containing literal text; return raw matching-file records for the evidence layer. |

`defaultGitLimits` and `resolveGitLimits` bound acquisition time, operation time, subprocess output and blob size. Callers supply an `AbortSignal` with each operation.

## Main types

- `RepositoryComparisonInput`: target/head repository URLs and full commit IDs.
- `GitSnapshot` / `GitSnapshotIdentity`: the live resource handle and its stable session, repository and commit identity.
- `GitChange` / `GitChangeHunk`: file status, content kind, paths and before/after line spans.
- `GitOperationOptions` / `GitLimits`: cancellation and resource budgets.

## How it works

1. Validate canonical GitHub HTTPS URLs and full SHA-1 IDs, fetch into an owned bare repository, and establish one merge base.
2. Compare BASE with HEAD, classify files, and serve bounded reads/searches from the pinned objects without a checkout. Completed inventories are reused for compatible limits.
3. The caller closes the snapshot in `finally`; closing cancels active operations, waits for them and removes temporary files.

The implementation uses the system Git executable through Node's `child_process.spawn`, `fs/promises` for temporary storage, and `Buffer` for exact bytes. It has no runtime package dependencies. PR metadata, source-excerpt contracts, context packing and model calls belong to higher layers.

Current acquisition supports public canonical HTTPS GitHub origins and complete SHA-1 repositories on macOS/Linux. Symlinks and submodules are not followed. `GitInputError`, `GitBlobUnavailableError` and `GitOperationError` distinguish invalid input, unavailable files and operation failures.

See the [public exports](src/index.ts), [contracts](src/contracts.ts), [limits](src/limits.ts) and [boundary decision](../../docs/adr/0002-context-engine-boundary.md) for details.

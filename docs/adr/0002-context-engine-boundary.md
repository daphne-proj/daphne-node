# ADR 0002: Separate PR acquisition, Git access, evidence retrieval and context assembly

- Status: accepted; acquisition, retrieval and independent context implemented and composed by the CLI through Step 6
- Date: 2026-10-19
- Revision: replaces this ADR's earlier decision to keep Git inside context-engine

## Problem

Separating PR URLs from the context engine was insufficient. The previous design made context-engine acquire Git snapshots and made `createContextEngine(GitSnapshot, ...)` own their cleanup. A pure assembly file inside that package did not make the public engine independent of acquisition.

The context builder must retain and assemble supplied evidence without opening a repository, executing retrieval or controlling Git resource lifetime. Git and evidence retrieval already have distinct owners in Daphne's Rust architecture.

## Decision

- `@daphne/pr-review` keeps URL parsing, GitHub metadata/authentication and HTTP limits/errors. The completed Task 1 remains valid.
- `@daphne/git-source` owns repository/revision inputs, acquisition, immutable snapshots, comparison, exact blobs, Git search, subprocess controls and disposal. Introduce it with working behavior in Task 2.
- `@daphne/review-evidence` owns source validation/materialization and bounded repository operations. It borrows a Git snapshot and later integrates qualified RCI/PCG navigation. Introduce it in Task 3.
- `@daphne/context-engine` owns supplied-evidence retention, deduplication, query progress and packet assembly. Introduce it in Task 5. It receives evidence identity/data, never a Git handle, repository acquisition input or retrieval callback.
- The CLI and future agent orchestration compose these APIs, select retrieval/assembly policy and own cleanup. The host closes Git in `finally`; context-engine has no repository `close` or tool `execute` method.

The supported user workflow begins with a PR URL. Local-checkout acquisition is removed from the current scope. Git-source still accepts validated remote repository URLs and exact commits rather than PR transport types; its private temporary object store remains necessary.

PR and Git packages do not import one another or downstream packages. Review-evidence implementation imports git-source. Its separate `contracts` export is I/O-free and imports no Git types or implementation; context-engine imports only its data types with `import type`. Emitted context JavaScript must not load retrieval code. This avoids a speculative shared-contract package while making the dependency explicit and reviewable.

Evidence retains commit/blob/path/range metadata. Provenance is data, not a backend dependency. Review-evidence establishes correspondence with actual committed bytes; context-engine checks evidence/session consistency and selects already supplied data. No missing source is fetched during assembly.

Each owner has separate configuration: HTTP limits in pr-review; Git acquisition/operation/output/blob limits in git-source; tool byte/page limits in review-evidence; retained-data and packet byte limits in context-engine. The host owns the total deadline and passes cancellation into I/O operations. No common options superclass or provider framework is introduced.

## Rust evidence and deliberate differences

- `crates/git-source/src/lib.rs`: revision comparison and exact blob access.
- `crates/review-evidence/src/diff.rs` and `source.rs`: pinned repository operations using git-source.
- `crates/review-agent/src/context.rs`: evidence retention, conflict/session validation and query progress; construction takes a session identity rather than acquiring Git.
- `crates/pr-review/src/github.rs`: acquisition/resource lifetime outside the evidence context.

Rust review-agent depends on review-evidence, which depends on Git; do not claim complete package isolation in Rust. The TypeScript contracts-only import is a deliberate stronger runtime separation. Reusable acquisition mechanics belong in git-source here; PR metadata resolution remains in pr-review. This does not establish Rust serialized-output compatibility.

## Alternatives and rationale

- Keeping Git private inside context-engine hides commands but leaves acquisition and cleanup in the public contract. Rejected for the required reuse boundary.
- Moving files while retaining `createContextEngine(GitSnapshot)` changes location without removing coupling. Rejected.
- Injecting a generic retrieval provider into context-engine still makes it orchestrate retrieval. Explicit host composition is sufficient for this slice.
- A generic acquisition package or new shared DTO package adds an owner without a concrete need. Use the existing domain owners and a dedicated evidence-contract export.
- Putting all retrieval in the CLI would make application code own reusable evidence rules. Keep those in review-evidence.

## Consequences and validation

There are more focused packages, each introduced with its first behavior, and no empty placeholders. Scope the independent review to both contract ownership and runtime imports, not merely implementation agreement with the plan.

Required change scenarios: changes to remote acquisition leave context-engine unchanged; context assembly works from previously supplied evidence after Git closes; packet rendering leaves acquisition unchanged; future RCI/PCG retrieval changes review-evidence without moving index construction or source access into context-engine.

Preserve immutable revision identity, exact bytes, cancellation, bounded outputs and cleanup when rehoming the draft. Existing manual demonstrations are useful evidence about Git behavior, but they do not verify the corrected package boundary. Re-run relevant checks after migration. No new tests are authorized; that leaves regression coverage incomplete.

## Transition and status

The user approved corrected Task 2 after reviewing the revised plan. Its Git implementation now lives in git-source; the superseded context-engine draft/build registration is removed. Workspace architecture, migration/package docs and lint restrictions now follow this decision. Task 1 PR behavior is unchanged. Step 3 now implements review-evidence source materialization with a direct I/O-free contracts export. Step 4 adds hunk windows, bounded tools and retryable authenticated cursors in review-evidence; Git-native candidate search stays in git-source.

Step 5 introduces the working context-engine package. Its 4 MiB serialized ledger retains source once, references source IDs from page history and commits whole pages atomically. Incompatible retries, broken continuation chains and conflicting source fail without changing state. Its assembler captures immutable supplied data and selects whole source entries before navigation under a separate 64 KiB rendered-byte cap; optional named token counting remains host-supplied. It preserves omission and incomplete-query metadata without fetching anything.

The walkthrough records post-migration public-API demonstrations, including assembly after Git cleanup and from a serialized snapshot. Step 6 composes the four public interfaces in the CLI. Whole-page source admission, change selection and run reporting stay in the host; Git closes before assembly. Artifact publication uses a same-directory hard link to avoid overwrites, with cancellation checked before synchronous final publication. This implementation retains comparison-shaped provenance types; a broader identity model should follow an actual second use case.

## Revisit when

A concrete new evidence kind requires extending the evidence contract, a second workflow needs a different identity shape, or a real host needs shared orchestration. Preserve acquisition-independent retention and assembly when extending those contracts. RCI/PCG indexing, model loops and review/grouping policy remain outside this slice.

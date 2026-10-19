# Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for the user's native, one-task-at-a-time execution. The user approved corrected Task 2; Step 5 is now approved on main, with no new tests and no commit.

**Goal:** Build acquisition-independent evidence retention and context assembly, demonstrated through separately owned PR resolution, Git access and bounded repository operations.

**Architecture:** `pr-review` resolves metadata; `git-source` owns Git resources and repository facts; `review-evidence` materializes evidence and exposes retrieval; `context-engine` retains supplied evidence and assembles packets. The host connects these APIs and owns Git cleanup. RCI/PCG retain indexing and semantic navigation; no model loop or grouping policy is introduced.

**Tech Stack:** TypeScript 6.0.3, Node 24.22.0, Bun 1.4.3, native ESM/NodeNext, Node standard library and installed Git. No new runtime library is needed for this slice.

**Spec:** [Context Engine Design](../specs/2026-10-19-context-engine-design.md) and [ADR 0002](../../adr/0002-context-engine-boundary.md). This revision supersedes the previous instruction to place Git inside context-engine, including conflicting workspace ownership prose.

## Global Constraints

- Work directly on `main` in `/Users/pietroputelli/Desktop/daphne-node`; no new branch or worktree.
- Do not add tests, test fixtures, test dependencies, or a replacement test harness. Keep existing checks and tests unchanged; use manual demonstrations and source review for new behavior.
- Use TypeScript with Node as runtime and Bun for installation/scripts. Preserve exact pins, strictness, `.js` relative imports and compiled public exports.
- RCI/PCG own indexing and repository semantics. No parsing, BM25, embeddings, vector storage, graph construction or placeholder providers.
- PR URLs, HTTP/authentication and PR types stay in pr-review. Repository/revision acquisition inputs and Git resources stay in git-source.
- Review-evidence owns bounded retrieval. Context-engine accepts only supplied evidence and identity data; it never owns a Git handle, retrieval callback, acquisition input or repository cleanup.
- The host owns retrieval/selection policy, overall deadlines and Git cleanup. No generic acquisition package, engine superclass or dependency container.
- No model calls, reviewed-repository code execution/dependency installation, GitHub writes, automatic pushes or Rust artifact compatibility claims.
- Preserve no-argument CLI behavior. Introduce packages only with working behavior.
- Execute one task at a time with explanation and a manual demonstration. Step 4 was subsequently committed by the user as `7c216e1`. Task 5 is authorized for implementation without committing; Task 6 remains a later learning checkpoint.
- Use the spec's exact initial limits and artifact contracts.

## Review Focus

No new automated regression coverage is authorized. Manual checks and independent source review must examine both implementation correctness and responsibility ownership.

1. Hostile PR/clone inputs, redirects or repository helpers must not escape their I/O boundary — Tasks 1–2.
2. Divergence, forks, moved refs, missing history and cancellation must preserve identity or fail with cleanup — Task 2.
3. Unicode/CRLF, missing sides, binary content and symlinks must preserve exact source or report unsupported evidence — Task 3.
4. Foreign cursors, failed pages, duplicate/conflicting source and omitted observations must not fabricate progress or model delivery — Tasks 4–5.
5. Tiny budgets, unsupported source, interruption and existing destinations must stop explicitly; retained context must remain usable after Git closes — Tasks 5–6.

## File structure and ownership

All paths below are relative to the repository. Create only the files needed by the current task.

| Files                                                                                           | Owner and first behavior                                                                               |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/pr-review/src/acquisition/pull-request.ts`, `limits.ts`, `index.ts`                   | Existing Task 1 HTTP/PR resolver                                                                       |
| `packages/git-source/src/contracts.ts`, `limits.ts`, `index.ts`                                 | Task 2 repository inputs, Git data, limits/errors and public exports                                   |
| `packages/git-source/src/process.ts`, `snapshot.ts`, `changes.ts`                               | Task 2 subprocess control, owned snapshot and change inventory                                         |
| `packages/git-source/src/source.ts`                                                             | Task 3 exact blob access; Task 4 bounded Git search                                                    |
| `packages/review-evidence/src/contracts.ts`, `source.ts`, `session.ts`, `errors.ts`, `index.ts` | Task 3 evidence data, byte validation and borrowing repository session                                 |
| `packages/review-evidence/src/limits.ts`, `tools/validate.ts`, `tools/execute.ts`               | Task 4 request validation, repository operations and pagination; tool data types extend `contracts.ts` |
| `packages/context-engine/src/evidence.ts`, `assembly.ts`, `engine.ts`, `limits.ts`, `index.ts`  | Task 5 retention, recorded progress, bounded rendering and in-memory public API                        |
| `apps/cli/src/context.ts`, `output.ts`, `main.ts`                                               | Task 6 workflow composition, artifacts and dispatch                                                    |

Each new package includes `package.json`, `tsconfig.json` and `tsconfig.build.json`. Update root build references and `bun.lock` with its first implementation: git-source in Task 2, review-evidence in Task 3, context-engine in Task 5. Add CLI dependencies/references in Task 6.

Synchronize `docs/architecture.md`, `docs/migration/README.md`, `packages/README.md`, `docs/context-engine-walkthrough.md` and `eslint.config.mjs` in the relevant implementation tasks. Corrected Task 2 synchronizes those files with the ownership defined here. No changes to test files or Vitest configuration.

## Dependency and lifecycle contracts

- Pr-review and git-source import neither one another nor downstream packages.
- Review-evidence implementation imports git-source through its public exports.
- `@daphne/review-evidence/contracts` resolves directly to a compiled I/O-free module. It contains evidence/tool data types and imports no Git types or implementation. Runtime validation lives in the implementation, not this export.
- Context-engine uses `import type` from that contracts subpath only; it does not import review-evidence runtime exports, git-source, pr-review or app code. Declare the workspace type dependency and inspect emitted JavaScript for accidental runtime imports. No filesystem, network, subprocess, acquisition or retrieval behavior belongs in context-engine.
- The host opens Git, creates the borrowing evidence session, constructs context from its data identity, executes retrieval and records results explicitly. It closes Git in `finally`. Context-engine exposes neither `execute` nor repository `close`.
- Evidence-session identity is an immutable data projection of snapshot identity; it carries no private directory or live handle. Git cleanup invalidates further retrieval, not retained evidence or assembled packets.
- Git limits/errors, evidence-operation limits/errors and context limits/errors stay with their respective owners. Do not re-export Git errors through the context API.

Strengthen static import restrictions as each package is implemented, including type imports, subpaths and relative paths. Contracts/evidence/assembly cannot import I/O. Static checks are not proof against all dynamic imports or cycles; inspect connected code and emitted imports.

Architecture review must demonstrate that changes to remote acquisition leave context-engine unchanged, assembly from supplied evidence needs no open repository, rendering changes leave Git untouched, and future RCI/PCG navigation belongs in review-evidence. Merely matching the task's file list is insufficient.

## Shared contract decisions

Define each contract only when first consumed; readonly records and arrays are required.

- Pr-review keeps its existing `PullRequestRef`, `ResolvedPullRequest`, `PullRequestLimits` and `ResolvePullRequestOptions`; Task 1 behavior is unchanged.
- Git-source `RepositoryComparisonInput`: `{ targetRepositoryUrl: string; headRepositoryUrl: string; targetCommit: string; headCommit: string }`. No PR reference or token.
- Git-source `GitSnapshotIdentity`: `{ sessionId: string; repositoryUrl: string; targetCommit: string; baseCommit: string; headCommit: string }`. Base is the unique computed merge base. `GitSnapshot` exposes this immutable identity and `close(): Promise<void>`; its directory/handle stays private.
- Git-source `GitChange`: session-local `id`, nullable before/after paths and modes, status `added | deleted | modified | renamed | type-changed`, kind `text | binary | symlink | submodule | unsupported`, and readonly hunk coordinates `beforeStartLine`, `beforeLineCount`, `afterStartLine`, `afterLineCount`.
- Git-source `GitLimits`: `acquisitionTimeoutMs: 300_000`, `gitTimeoutMs: 30_000`, `maxGitOutputBytes: 16_777_216`, `maxBlobBytes: 2_097_152`. Export `defaultGitLimits`, `resolveGitLimits(overrides?: Partial<GitLimits>): GitLimits`, and `GitOperationOptions: { signal: AbortSignal; limits: GitLimits }`.
- Review-evidence contracts define their own I/O-free `ReviewIdentity` with the same metadata fields as `GitSnapshotIdentity`, copied by the evidence session. They define `Change` with the inventory fields above, mapped from Git facts rather than aliasing Git types. These small data projections keep Git resource/type ownership out of context.
- Review-evidence `Side = 'base' | 'head'`; `ByteRange = { startByte: number; endByte: number }` uses safe nonnegative integers and a half-open interval.
- Review-evidence `SourceRef: { sessionId: string; side: Side; commit: string; path: string; blobId: string; range: ByteRange }`; `SourceEvidence: { ref: SourceRef; text: string }`. Admit text only after byte/range/encoding validation.
- Review-evidence `ContextNotice: { code: string; message: string; path: string | null }`; centralize concrete notice codes and redact I/O details before presentation.
- In Task 4, review-evidence adds `EvidenceLimits: { maxToolBytes: 16_384; maxPageEntries: 100 }` gives defaults, with numeric fields in the type; export `defaultEvidenceLimits` and `resolveEvidenceLimits`. `EvidenceOperationOptions` lives in the runtime session API: Task 3 defines only `{ signal: AbortSignal; gitLimits: GitLimits }`; Task 4 adds `limits: EvidenceLimits`. Neither form belongs in the data-only contracts subpath.
- Context-engine `ContextLimits` contains numeric `maxContextBytes` (default `65_536`) and `maxRetainedBytes` (default `4_194_304`); export `defaultContextLimits` and `resolveContextLimits`. No acquisition or Git limits/signals.
- All limit resolvers accept partial overrides, require positive safe integers, and may only lower defaults. The CLI owns one 300,000 ms acquisition deadline spanning HTTP and Git, without restarting it between stages.
- Context-engine `TokenBudget: { counterId: string; maxTokens: number; countTokens: (renderedContext: string) => Promise<number> }`. Counts concern the exact rendering, not a complete provider request.
- Invalid input produces an owner-specific typed error; expected unavailable evidence produces explicit notices/results. Never turn unavailable content into empty success.

The initial evidence identity describes a comparison; no universal storage/session framework is implied. Context assembly is independent of acquisition while retaining comparison provenance. No Rust evidence-ID, lane-file or RCI/PCG serialization compatibility is claimed.

## Task 1: Resolve public PR metadata in pr-review

**Files:** Create `packages/pr-review/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/index.ts`, `src/limits.ts` and `src/acquisition/pull-request.ts`. Modify root `tsconfig.json`, `bun.lock`, `eslint.config.mjs` and the ownership docs listed above. Create ADR 0002 and the walkthrough. Do not leave an empty context-engine workspace.

**Completed under the prior plan:** The resolver draft was rehomed into `pr-review`; only its HTTP limits remain. The superseded context-engine workspace/build registration is gone. Manual demonstrations and independent source review are recorded in the walkthrough. The package builds and passes the existing checks without new tests or runtime dependencies.

**Interfaces, exported by `@daphne/pr-review`:**

- Consumes: a URL string, optional host-supplied read token and `AbortSignal`.
- Produces `parsePullRequestUrl(value: string): PullRequestRef`.
- Produces `resolvePullRequest(ref: PullRequestRef, options: ResolvePullRequestOptions): Promise<ResolvedPullRequest>`.
- Produces `defaultPullRequestLimits` and `resolvePullRequestLimits(overrides?: Partial<PullRequestLimits>): PullRequestLimits`.
- No imports from or exports through `@daphne/context-engine`; no environment-variable reads in the library.

- [x] **Step 1: Register the working PR package.** Rehome the draft as described above. Mirror CLI build/typecheck conventions, export `dist/index.js` and declarations, and declare exact TypeScript/Node type tooling. Do not add Vitest or a tests directory. Register only `pr-review` for this step and run `bun install` with the pinned Bun.
- [x] **Step 2: Implement URL/HTTP-limit validation.** Enforce the accepted URL grammar, safe positive PR number and the two PR-limit defaults. Reject arbitrary hosts, embedded credentials and invalid overrides. Keep typed input errors local to this package.
- [x] **Step 3: Implement metadata resolution.** Use Node `fetch` with JSON accept headers, API version `2026-03-10`, redirect rejection and bounded response reading. Combine the caller's signal with the HTTP timeout through the complete body read. Validate repository names, public visibility and full commit IDs before constructing trusted GitHub repository URLs. Explain 401/403/404/rate-limit failures without echoing tokens.
- [x] **Step 4: Record and enforce the then-current ownership.** The prior architecture/migration docs and ADR put Git in context-engine starting in Task 2. That decision is superseded by this revision; corrected Task 2 synchronizes those docs and restrictions. PR acquisition and RCI/PCG indexing ownership remain unchanged. Restrict imports between the two packages in both directions, including package subpaths and relative source paths. Add the walkthrough's PR-URL/trust-boundary lesson. Keep the CLI free of HTTP implementation details.
- [x] **Step 5: Manually demonstrate the resolver.** Run `bun run build`, then use `node --input-type=module` from `packages/pr-review` and import `@daphne/pr-review` through its compiled public exports. Parse `https://github.com/daphne-proj/pr-review-test/pull/1` and inspect owner/repository/number; reject `https://example.com/o/r/pull/1` before network access. Resolve an accessible public PR and compare IDs with GitHub metadata. Inspect cancellation, a lowered response cap and timeout, and sanitized authentication failure. An unavailable PR is an acquisition error, never a pass.
- [x] **Step 6: Review, verify and commit the focused deliverable.** Apply the readability guidance, independently review the acquisition boundary, format touched files, run `bun run check` and `git diff --check`, inspect scope and commit as `feat(pr-review): resolve public pull request inputs`. Confirm no new tests or runtime dependencies and no context-engine placeholder. Stage only this task's files; do not push.

**Discuss before the next task:** TypeScript types describe validated values; they do not make HTTP responses trustworthy. The resolver produces PR metadata, while the receiving Git API will own its separate comparison input.

## Task 2: Acquire and freeze the Git comparison in git-source

**Current scope:** remote acquisition only; local-checkout acquisition and its public API were removed after Step 2 review. PR parsing remains in pr-review.

**Status:** complete in git-source; manual demonstrations, independent review and the existing full check gate passed. The superseded context-engine draft/build registration has been removed.

**Files:** Establish `packages/git-source/{package.json,tsconfig.json,tsconfig.build.json}` and `src/{index,contracts,limits,process,snapshot,changes}.ts`. Rehome only the reviewed Git behavior from the draft. Update root `tsconfig.json`, `bun.lock`, `eslint.config.mjs` and the ownership docs/walkthrough listed above. Remove the superseded context-engine draft package/build registration after its Git behavior is preserved; do not create review-evidence or context-engine placeholders.

**Interfaces, exported by @daphne/git-source:**

- `acquireSnapshot(input: RepositoryComparisonInput, options: GitOperationOptions): Promise<GitSnapshot>`.
- `listSnapshotChanges(snapshot: GitSnapshot, options: GitOperationOptions): Promise<readonly GitChange[]>`.
- `defaultGitLimits`, `resolveGitLimits`, the Git input/data types and caller-relevant `GitInputError` / `GitOperationError`.
- Internal `runGit(args: readonly string[], cwd: string, options: GitOperationOptions & { fetch: boolean; acceptedExitCodes?: readonly number[] }): Promise<Buffer>`. This is not a public arbitrary-command API.

**Resource contract:** Git-source creates and owns private temporary bare state; the acquiring host is responsible for calling `snapshot.close()`. Close is idempotent, cancels/waits for active operations and removes only owned state. Acquisition failure cleans up before returning an error. Closed snapshots reject further operations. No context object exists in this task.

- [x] **Step 1: Rehome the working Git boundary.** Inspect the entire draft before moving it. Rename context-specific Git contracts/errors to the names above, reduce its limits to the four Git limits, preserve safeguards, and use direct internal imports. Register git-source, remove the superseded draft registration, and synchronize workspace docs/lint rules. Preserve completed pr-review behavior. No runtime dependencies or unrelated cleanup.
- [x] **Step 2: Verify controlled subprocess behavior.** Spawn argument arrays without a shell; control environment/config/hooks; disable helpers, external diff/textconv, lazy fetch and replacement objects. Bound combined output and operation time, terminate/wait for process groups on abort, and sanitize errors. Accept exit 0 by default; explicit alternate outcomes only. Initially support macOS/Linux with compatible installed Git; unsupported platforms fail explicitly.
- [x] **Step 3: Verify immutable acquisition.** Validate full 40-hex SHA-1 commit IDs and credential-free canonical HTTPS GitHub repository URLs; reject other hosts/protocols, redirects, query/fragment or credentials. Fetch exact target/head and complete required history from their respective origins into one owned bare repository. One acquisition deadline covers the whole operation. Check object types/availability, reject shallow or borrowed object stores and non-unique/no merge base, retain refs and freeze identity.
- [x] **Step 4: Verify deterministic inventory.** Compare merge base to head using NUL-delimited raw paths, rename detection at 50%, Myers diff and controlled zero-context hunks. Sort by path bytes and assign stable session-local IDs. Preserve modes, additions/deletions/renames, binary/symlink/submodule/unsupported classifications and zero-count hunk anchors. Reject non-UTF-8 paths explicitly. Never parse filenames from display headers or follow symlinks. Internal bounded blob reads for classification do not introduce the Task 3 source-evidence API.
- [x] **Step 5: Demonstrate the public Git API.** From the compiled git-source package, acquire an accessible public PR's exact remote commits. Compare pinned identity/inventory with ordinary Git. Inspect divergence, rename and distinct fork-origin handling using existing accessible examples where available; disclose unexercised cases. The library receives remote URLs/commits without a PR object. Earlier local-input demonstrations are historical evidence; that API is now removed.
- [x] **Step 6: Demonstrate failures and lifecycle.** Exercise missing commit, cancellation, lowered deadline/output cap, disallowed origin and close during an active operation. Confirm errors, process completion and no leftover owned directories. Verify private snapshot cleanup and that inherited executable Git helpers do not run. Existing draft demonstrations are background evidence; verify the rehomed public API and changed lifecycle paths again.
- [x] **Step 7: Review and verify the corrected boundary.** Apply readability guidance and independent review against the user requirement and Rust ownership, not just this plan. Check git-source imports no downstream package, exports no context/tool/HTTP API, and has only Git limits. Format touched files, run `bun install --frozen-lockfile`, `bun run check` and `git diff --check`; confirm no new tests and explain the code before committing as `feat(git-source): pin snapshots and enumerate changes`. Do not push.

**Out of scope:** exact public source-range reads, review-evidence sessions/tools, evidence retention, context packets, CLI wiring, indexes and model behavior.

**Review checkpoint:** the user approved this input/output/lifecycle contract before implementation resumed. The learning question is how target, merge base and head differ, and why the caller's resource lifetime is separate from context retention.

## Task 3: Read exact blobs and materialize source evidence

**Files:** Create `packages/git-source/src/source.ts`; extend its public exports with exact blob access. Create the functional review-evidence workspace and `src/{contracts,source,session,errors,index}.ts`, including a direct compiled `./contracts` export. Add its git-source dependency/build reference and update workspace docs/lock/walkthrough.

**Interfaces:**

- Git-source exports `GitBlobUnavailableError` with missing/symlink/submodule/not_regular/too_large reasons. Review-evidence maps these to `SourceUnavailableError` and adds binary/invalid_utf8; malformed ranges use `EvidenceInputError`. Other Git failures propagate unchanged.

- Git-source exports `readSnapshotBlob(snapshot: GitSnapshot, input: { side: 'base' | 'head'; path: string }, options: GitOperationOptions): Promise<{ commit: string; path: string; blobId: string; bytes: Buffer }>`. Validate object kind/size before reading. Each result owns its bytes; no mutable snapshot buffer is exposed.
- Review-evidence exports `createEvidenceSession(snapshot: GitSnapshot, options: EvidenceOperationOptions): EvidenceSession`. It borrows the snapshot; it never closes it.
- `EvidenceSession` exposes immutable `identity: ReviewIdentity` and `readSource(input: { side: Side; path: string; range: ByteRange }): Promise<SourceEvidence>`. Task 4 adds execution; no separate interchangeable backend interface is needed.
- Step 3 takes byte ranges directly. Defer line/hunk conversion, tool response/page limits and `limits.ts` until their first consumer in Task 4.

- [x] **Step 1: Implement Git object reads.** Resolve literal paths against pinned trees, verify regular-file type and blob size, and return original bytes and provenance. Never shell-interpolate paths or dereference host symlinks.
- [x] **Step 2: Register review-evidence and implement exact text materialization.** Copy snapshot metadata into the I/O-free identity contract. Validate safe byte bounds and UTF-8 boundaries; preserve BOM/CRLF and valid empty ranges/files. Capture caller input before awaiting Git so later mutation cannot change evidence provenance. Reject invalid text rather than replacing bytes.
- [x] **Step 3: Define source failure behavior.** Materialize host-derived session/commit/side/path/blob/range references. Distinguish missing sides, binary/symlink/submodule/oversized source from valid empty text; use typed unavailable-source errors that Task 4 maps to notices. Preserve cancellation/limit failures as failures.
- [x] **Step 4: Demonstrate source boundaries.** Use existing accessible public PRs containing emoji, CRLF, empty file, deletion and symlink examples; report cases unavailable in the selected PRs. Compare public API excerpts with Git bytes, reject a mid-emoji range, read deleted text only on BASE and show symlinks are not followed. Close the snapshot in the host's `finally`.
- [x] **Step 5: Verify and commit.** Review the direct contracts export for zero Git/I/O dependencies, format, run the existing full gate and diff check. Commit as `feat(review-evidence): materialize exact committed source`.

**Discuss:** Git proves which bytes exist; review-evidence interprets safe source ranges. Neither operation chooses model context.

## Task 4: Expose bounded repository operations in review-evidence

**Files:** Extend review-evidence `contracts.ts` with data-only tool variants, add `limits.ts`, `tools/validate.ts`, `tools/execute.ts` and focused `tools/{cursor,hunks,operations}.ts` helpers, extend its session/public exports and update walkthrough. Extend git-source `source.ts` with bounded committed-tree search. No context-engine package yet.

**Interfaces:**

- Add `EvidenceLimits` (16,384 tool bytes, 100 page entries), its default/resolver and the `limits` field on `EvidenceOperationOptions`.
- Add internal `lineRangeToBytes(bytes: Buffer, startLine: number, lineCount: number): ByteRange` in review-evidence for hunk windows; zero-count hunks anchor after the preceding line.

- `ToolRequest` discriminates on `name`: `list_changes` takes cursor/page limit; `inspect_change` takes change ID/cursor; `read_source` takes side/path/range/cursor; `search_code` takes side/query/literal path prefix/cursor/page limit. All may lower the response byte allowance.
- `ToolResult: { identity: ReviewIdentity; request: ToolRequest; entries: readonly ToolEntry[]; completeness: 'complete' | 'partial' | 'unavailable'; nextCursor: string | null; notices: readonly ContextNotice[] }`.
- `ToolEntry` is a tagged union of `Change`, `SourceEvidence`, or a search navigation hit with side/path/byte location/preview. No unknown payloads or Git implementation types in these contracts.
- Export `parseToolRequest(input: unknown): ToolRequest`; extend `EvidenceSession` with `execute(request: unknown): Promise<ToolResult>`, validating and normalizing every request at execution.
- Git-source exports `searchSnapshot(snapshot: GitSnapshot, input: { side: 'base' | 'head'; query: string; pathPrefix?: string }, options: GitOperationOptions): Promise<Buffer>` for bounded Git-native search records. Review-evidence parses these records and materializes navigation hits; raw output never reaches context-engine or a model. A capped/killed search fails explicitly and cannot mean no matches.

**Approved Step 4 clarifications:**

- Inspect hunk windows with a fixed three-line margin, clamped to each side's file bounds; merge overlapping/adjacent windows on the same side/path. Preserve zero-count anchors and separate BASE/HEAD paths.
- Cursors bind session, tool, complete normalized arguments, effective byte/entry limits and continuation position. Preserve the original requested source range while returned references describe each delivered slice. Stable ordering and UTF-8 boundaries prevent gaps/duplicates.
- Cursors are retryable, not consumed by an attempted page. Use a session-private HMAC key and authenticated compact position tokens; no registry or retained response history. A new evidence session rejects old tokens. Recompute bounded query results on continuation rather than introducing a cache.
- A successful page with a continuation must make progress. Invalid input, cancellation, Git deadlines/output limits, or an envelope/indivisible item that cannot fit are explicit failures, never successful empty pages.
- `complete` with no cursor means the requested operation completed within its declared scope. `partial` with a cursor means more items remain. `partial` without a cursor retains explicit limitations; `unavailable` means no requested evidence could be supplied. A null cursor alone never proves completion. Carry earlier limitations through the continuation outcome.
- Count the complete JSON response in UTF-8 bytes, including request, identity, notices and cursor. Apply the byte and entry caps together; notices are also page-bounded (each entries/notices array obeys the effective page cap). Split source only on valid character boundaries; fail explicitly for indivisible metadata that cannot fit.
- Git search identifies matching committed regular text files using fixed, case-sensitive single-line queries. Review-evidence validates candidate blobs and derives byte locations and bounded previews. Search is navigation, not exact source evidence or semantic analysis.
- Pagination bounds delivery, not the underlying Git search/inventory. Git must complete within its own limits; killed/capped output is an error. Literal path prefixes filter candidate paths; Git may search the containing directory before that exact prefix filter. Unsupported candidate blobs produce limitations, not fabricated hits. No streaming search, result cache, index or dependency is introduced.
- The host owns overall workflow deadlines and Git cleanup. Retrieval remains usable without context-engine, and returned evidence remains plain data after cleanup.

- [x] **Step 1: Implement runtime request validation.** Reject unknown fields, invalid sides/paths/ranges and embedded revision overrides. Requests operate only on the active session. Repository/PR content is untrusted data.
- [x] **Step 2: Implement the four operations.** Map Git inventory into evidence `Change` records, inspect hunk windows, read source and search literal case-sensitive text using git-source. Git grep exit 1 alone means no matches; exit 2/termination is failure. Use literal path prefixes, include tracked docs/config and do not silently infer coverage from ignore rules.
- [x] **Step 3: Implement bounded pagination.** Cap complete serialized responses at 16,384 UTF-8 bytes and pages at 100 entries; split source on UTF-8 boundaries. Session-local cursors bind normalized query, size and position; reject foreign cursors or changed parameters. An unrepresentable item produces an explicit limitation/error.
- [x] **Step 4: Demonstrate retrieval.** Exercise list → inspect → read, a known search, tiny pages and continuation. Change a query with an existing cursor and confirm rejection. Cancel a page and confirm no successful result is emitted. Navigation previews are not exact source evidence.
- [x] **Step 5: Verify without committing.** Inspect contract/runtime separation, independently review the change, format and run the full existing gate plus diff check. The latest user instruction prohibits committing; leave the verified changes uncommitted on main.

**Discuss:** Retrieval produces observations. Recording those observations and deciding what the model receives belong elsewhere.

## Task 5: Retain supplied evidence and assemble context

**Files:** Create the functional context-engine workspace and `src/{contracts,validation,limits,errors,evidence,assembly,engine,index}.ts`. Declare the review-evidence workspace type dependency/build reference; import types solely from `@daphne/review-evidence/contracts`. Update root references, lock, import restrictions, ownership docs and walkthrough.

**Interfaces:**

- `EvidenceSnapshot` contains `ReviewIdentity`, ordered `{ evidenceId: string; source: SourceEvidence }` entries, normalized query/page progress and bounded navigation observations/notices. Evidence IDs are session-local, never index IDs.
- Internal `EvidenceLedger` implements `retain(source: SourceEvidence): string`, `record(result: ToolResult): void` and `snapshot(): EvidenceSnapshot`.
- `AssembleInput: { evidenceIds: readonly string[]; maxBytes: number; tokens?: TokenBudget }`.
- `ContextPacket`: immutable `{ format: 'daphne-context-v1'; packetId: string; identity: ReviewIdentity; includedEvidenceIds: readonly string[]; omittedEvidenceIds: readonly string[]; notices: readonly ContextNotice[]; renderedContext: string; byteCount: number; tokenCount: number | null }`. Selected sources/navigation live in the rendering, without duplicate text in the envelope.
- `assembleContext(snapshot: EvidenceSnapshot, input: AssembleInput): Promise<ContextPacket>`.
- `createContextEngine(identity: ReviewIdentity, limits: ContextLimits): ContextEngine`.
- `ContextEngine` exposes `identity`, `retain(source: SourceEvidence): string`, `record(result: ToolResult): void`, `evidence(): EvidenceSnapshot`, and `assemble(input: AssembleInput): Promise<ContextPacket>`. Its assembly method enforces the configured cap as well as the requested cap. No execute, fetch, snapshot handle, repository path input, retrieval callback or close method.

**Approved Step 5 clarifications and implementation choices:**

- Retain supplied data only. Git and retrieval runtime imports are forbidden; `@daphne/review-evidence/contracts` is a type-only dependency. Identity fields and cursor strings are opaque data, not resource handles or instructions to retrieve.
- Record a whole tool page atomically, using the same source validation/deduplication as `retain`. Identical page retries are no-ops. Reject conflicting repeats, foreign identities and out-of-order continuations without modifying state or consuming evidence IDs.
- One pagination chain per normalized query in this engine. Query identity excludes the input cursor but includes effective request parameters. Compare cursor strings without decoding/authenticating them. A restarted incompatible chain is an explicit conflict. Only contiguous, limitation-free completion establishes exhaustion.
- Identical source references/text reuse IDs. Reject a different blob for the same side/commit/path, different text for the same reference, or disagreement in overlapping byte ranges. Keep consistent overlapping excerpts separate; do not merge/rewrite their identity.
- `maxRetainedBytes` defaults to 4,194,304 bytes (4 MiB), independent of `maxContextBytes` at 65,536 bytes (64 KiB). Count the complete deterministic JSON encoding of retained identity, source records, query/page bookkeeping, navigation and notices. Source entries in page history reference retained IDs instead of duplicating source text. A transaction that exceeds the cap fails without eviction or partial writes. This bounds retained data, not exact JS heap or transient staging memory.
- Capture immutable state and assembly arguments before awaiting an optional token counter. Standalone assembly validates supplied snapshots without repository access. Count actual final JSON rendering, including provenance, omissions and navigation bookkeeping; the packet metadata wrapper is outside that rendering budget.
- Preserve host source priority; admit whole excerpts and remove lower-priority entries when necessary. Then admit whole navigation observations/notices in stable recorded order without displacing admitted source. Render explicit source and observation omission metadata and query completion summaries. Omission of a notice cannot hide that retrieval was partial. Retention remains unchanged.
- If mandatory identity/progress/omission bookkeeping cannot fit even with no selected source/navigation, fail explicitly. Unknown evidence IDs are input errors, never retrieval requests.
- Named token counting is a host-supplied optional function, not a retrieval callback. Validate nonnegative safe counts and count the exact candidate rendering; without it tokenCount is null. Packet hashing includes rendering, identity/format and counter configuration/count; construction is not model delivery.
- No new tests, fixtures, dependency framework, RCI/PCG work, model/CLI integration or commits in this step.

- [x] **Step 1: Register the package and implement retention.** Validate identity/source range consistency, deduplicate identical references, reject conflicting bytes/wrong sessions, and retain original text. Validate result identity even for empty/navigation-only pages. Record supplied results and notices, but advance pagination progress only for successfully completed pages along the correct cursor chain; unavailable/failed/cancelled operations never establish exhaustion. Search previews never enter source storage.
- [x] **Step 2: Implement selection and rendering.** Preserve host evidence-ID priority, deduplicate IDs, reject unknown IDs and render source/reference/navigation/limitations deterministically. Missing evidence is an error, never a retrieval request.
- [x] **Step 3: Implement whole-entry admission.** Count the final UTF-8 rendering including omission metadata. Remove lower-priority entries until it fits; never clip source. If tokens are supplied, validate/await the named counter on each final candidate. An envelope that cannot fit is a typed error. Without a counter, token count is null.
- [x] **Step 4: Implement immutable results and the in-memory facade.** Hash final rendering plus identity/format and counter configuration with SHA-256 for packet identity. The same inputs may reproduce the same ID; packet construction is not model delivery. Freeze/copy outputs and leave retained evidence unchanged. The engine delegates only to ledger and assembler.
- [x] **Step 5: Demonstrate independence and budgets.** Retrieve evidence through review-evidence, retain it, then close Git. Assemble twice with different budgets afterward and verify byte counts, omissions and unchanged retention. Inspect emitted context JavaScript for zero retrieval/Git imports. Exercise duplicates/conflicts, wrong sessions, an unknown ID, tiny envelope and out-of-order/failed-page progress. Review token-callback logic without inventing a tokenizer.
- [x] **Step 6: Verify without committing.** Independently review the public boundary, format and run frozen install, the existing full gate and diff check. Leave all Step 5 changes uncommitted on main.

**Discuss:** Evidence retention, packet selection, source lifetime and model delivery are separate concerns. The initial comparison-shaped identity preserves provenance without requiring a live Git repository.

## Task 6: Compose the PR inspection workflow in the CLI

**Files:** Create `apps/cli/src/context.ts` and `output.ts`; modify its `main.ts`, manifest/build references, `bun.lock` and walkthrough.

**Interfaces:**

- Consumes all four packages' public APIs from Tasks 1–5.
- `parseContextArgs(args: readonly string[]): { pr: string; output: string }` uses Node `util.parseArgs`, rejecting unexpected flags/positionals.
- `runContextInspect(input: { pr: string; output: string }, signal: AbortSignal): Promise<0 | 1 | 2>`.
- `createRunDirectory(path: string): Promise<string>` requires a new directory.
- `writeArtifact(directory: string, filename: 'context.json' | 'run.json', value: unknown): Promise<void>` writes via exclusive temporary file then rename.

- [ ] **Step 1: Add workspace dependencies and dispatch.** Declare `workspace:*` dependencies and build references for pr-review, git-source, review-evidence and context-engine. Preserve no-argument behavior.
- [ ] **Step 2: Compose acquisition, retrieval and assembly explicitly.** Read any GitHub token only in the host and pass it only to pr-review. Start one 300,000 ms acquisition deadline, resolve metadata, map fields into git-source input and acquire with the same signal. Immediately establish host cleanup responsibility. Create a borrowing evidence session using the subsequent user-cancellation signal, then create context from its identity and context limits. Parse/execute tools in review-evidence; explicitly record successful results in context. Inspect changes in stable order, stop at the separate 65,536-byte source inspection allowance, record remaining changes, and assemble retained IDs in that order. This is demonstration policy, not relevance ranking.
- [ ] **Step 3: Produce safe artifacts and status.** Claim an owner-only new directory before external work. Persist `daphne-context-v1` context and `daphne-context-run-v1` run data without overwrites, tokens or hidden reasoning. Print one JSON summary; diagnostics go to stderr. Exit 0 for success, 2 with artifacts for partial inspection, 1 for invalid input/acquisition failure. Unsupported changed content, omitted changes or incomplete tool chains make inspection partial; no semantic-coverage claim.
- [ ] **Step 4: Implement interruption and cleanup.** Convert SIGINT/SIGTERM into cancellation, await operation cleanup and save a stopped run where possible. Close the Git snapshot in `finally`, including if later construction fails; never call context-engine for repository disposal. Existing destinations fail before acquisition.
- [ ] **Step 5: Demonstrate the workflow.** Build and run `bun run cli -- context inspect --pr https://github.com/OWNER/REPO/pull/NUMBER --output NEW_DIRECTORY` with an accessible public PR. Compare artifacts with pinned Git source, explain partial limits, reject an existing destination and interrupt a fresh run to inspect cleanup.
- [ ] **Step 6: Review, verify and commit.** Apply readability guidance, independently review composition/ownership, format, run frozen install, the existing full gate and diff check. Confirm no tests were added or changed. Commit as `feat(cli): inspect PR context from a URL`; do not push.

**Discuss:** The host chooses the workflow; reusable context does not become a universal investigation loop.

## Completion and planning self-review

- Task 1 remains complete. Corrected Task 2 is complete in git-source, with the verification recorded in the walkthrough. Step 3 source reads and materialization are complete; frozen install, the full existing check gate, manual demonstrations and independent review passed. Task 4 was subsequently committed as `7c216e1`. Task 5 is implemented and verified, deliberately uncommitted on main. Frozen install, the full existing gate, public-API demonstrations and independent source review passed. Task 6 remains pending.
- Next learning checkpoint is Task 6, explicit CLI composition. Native execution on main and no new tests remain selected; do not ask for a new execution mode or implement subsequent tasks automatically.
- Spec coverage: HTTP → Task 1; immutable Git/lifecycle → Task 2; exact evidence → Task 3; tools/cursors → Task 4; retention/context budgets → Task 5; composition/artifacts → Task 6.
- Dependency consistency: Task 2 exports Git contracts only; Task 3 introduces an I/O-free evidence data export; Task 5 consumes only those types and supplied data; Task 6 owns all resource orchestration.
- The key architecture demonstration is assembly from already supplied evidence after Git closes. Type checking and prior draft demonstrations alone do not establish this property.
- Record actual checks, independent review and limitations in the walkthrough. Existing tests cover the existing CLI behavior; manual demonstrations do not create regression coverage or establish production readiness.
- Model runtime, review/grouping policy and qualified RCI/PCG integration remain separate future work.

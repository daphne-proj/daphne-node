# Context Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PR-independent context engine that retrieves revision-bound source evidence and produces an inspectable bounded context packet, demonstrated by a CLI workflow that resolves a public GitHub PR through a separate package.

**Architecture:** `@daphne/pr-review` owns PR URL parsing and GitHub metadata acquisition. `@daphne/context-engine` owns immutable Git access, bounded tools, evidence retention and assembly; it accepts repository/revision input, never PR transport types. The CLI composes both packages and maps their values explicitly. RCI and PCG retain indexing and semantic navigation ownership; no model loop or review/grouping policy is introduced.

**Tech Stack:** TypeScript 6.0.3, Node 24.22.0, Bun 1.4.3, native ESM/NodeNext, Node standard library and installed Git. No new runtime library is needed for this slice.

**Spec:** [Context Engine Design](../specs/2026-10-19-context-engine-design.md). Read it before implementation; this plan and that spec supersede the earlier broad migration sequence for this slice.

## Global Constraints

- Work directly on `main` in `/Users/pietroputelli/Desktop/daphne-node`; no new branch or worktree.
- Do not add tests, test fixtures, test dependencies, or a replacement test harness in this implementation.
- Keep existing checks enabled; use manual demonstrations and source review for new behavior.
- Use TypeScript with Node as runtime and Bun for installation/scripts.
- RCI and PCG own indexing and repository semantics, following the Rust domain boundaries.
- Do not implement indexing, source-code parsing, BM25, embeddings, vector storage, or graph construction here.
- Keep the implementation readable and small enough to understand step by step.
- Keep PR URLs, GitHub HTTP/authentication and PR transport types in `@daphne/pr-review`; the context engine accepts repository/revision inputs. Neither package imports the other in this slice; the CLI composes their public APIs.
- Keep Git access inside `@daphne/context-engine` for this iteration, with evidence retention and assembly independent of Git implementations. Do not introduce a generic acquisition package or provider framework.
- Keep exact current runtime/tool pins, strict compiler/linter options, `.js` relative imports, declared workspace dependencies and compiled public exports.
- No model calls, repository code execution, dependency installation in reviewed repositories, GitHub writes, automatic pushes, or Rust artifact compatibility claims.
- Preserve the existing no-argument CLI output and existing test files.
- Execute one task at a time with a demonstration and explanation before moving to the next. Native implementation in this chat is recommended for this learning workflow; confirm the execution approach at handoff.
- Treat the proposed limits and command/artifact contracts in the spec as the exact initial implementation values.

## Review Focus

The user explicitly declined new tests, overriding the skill's normal test-first steps. These five gaps receive manual checks in their owning tasks; they remain without new automated regression coverage.

1. Hostile PR URLs, unexpected API data or redirected credentials must not escape the trusted GitHub acquisition boundary — Tasks 1–2.
2. Diverged branches, forks or a moved head must not mix revisions or confuse target tip with merge base — Task 2.
3. Unicode/CRLF, missing sides, symlinks and binary content must retain exact identity or report unsupported evidence — Task 3.
4. Foreign cursors, failed pages, duplicate source and omitted observations must not fabricate query completion or evidence delivery — Tasks 4–5.
5. Tiny budgets, cancellation, existing output directories or incomplete inspection must stop explicitly without overwriting data — Tasks 5–6.

---

## File structure and ownership

Create files only in the task that supplies their first behavior. No empty package placeholders.

| File                                                                           | Responsibility                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `packages/pr-review/package.json`, `tsconfig.json`, `tsconfig.build.json`      | PR workspace setup in Task 1                                                   |
| `packages/pr-review/src/index.ts`                                              | Public PR acquisition exports                                                  |
| `packages/pr-review/src/limits.ts`                                             | HTTP limits and resolver options                                               |
| `packages/pr-review/src/acquisition/pull-request.ts`                           | PR URL parsing, GitHub metadata and acquisition errors                         |
| `packages/context-engine/package.json`, `tsconfig.json`, `tsconfig.build.json` | Context workspace setup in Task 2                                              |
| `packages/context-engine/src/index.ts`                                         | Public repository/context exports; no PR exports                               |
| `packages/context-engine/src/contracts.ts`                                     | Repository comparison inputs and shared source values; no I/O                  |
| `packages/context-engine/src/limits.ts`                                        | Git/retrieval/assembly limits and operation options                            |
| `packages/context-engine/src/git/process.ts`                                   | Controlled, bounded Git subprocesses                                           |
| `packages/context-engine/src/git/snapshot.ts`                                  | Repository/revision validation, temporary Git lifecycle and immutable identity |
| `packages/context-engine/src/git/changes.ts`                                   | Raw diff inventory and hunk coordinates                                        |
| `packages/context-engine/src/git/source.ts`                                    | Exact blob reads, decoding and byte/line coordinates                           |
| `packages/context-engine/src/tools/contracts.ts`                               | Tool request/result unions and runtime validation                              |
| `packages/context-engine/src/tools/execute.ts`                                 | Four operations and session-local pagination                                   |
| `packages/context-engine/src/evidence.ts`                                      | Retained source, evidence IDs and query progress                               |
| `packages/context-engine/src/assembly.ts`                                      | Deterministic bounded packet selection/rendering                               |
| `packages/context-engine/src/engine.ts`                                        | Small public composition of one snapshot and ledger                            |
| `apps/cli/src/context.ts`                                                      | Arguments, PR-to-comparison mapping, acquisition deadline and inspection flow  |
| `apps/cli/src/output.ts`                                                       | New-directory acquisition and atomic artifact writes                           |
| `apps/cli/src/main.ts`                                                         | Command dispatch; preserve no-argument behavior                                |
| `docs/context-engine-walkthrough.md`                                           | Per-task explanations and observed demonstrations                              |
| `docs/adr/0002-context-engine-boundary.md`                                     | PR/context ownership and deferred RCI/PCG integration                          |

Update root `tsconfig.json` and `bun.lock` as each package becomes functional: `pr-review` in Task 1, `context-engine` in Task 2. Add both CLI dependencies and build references in Task 6. Update `docs/architecture.md`, `docs/migration/README.md`, `packages/README.md` and `eslint.config.mjs` in the owning implementation tasks to document and enforce these boundaries; do not claim deferred packages are implemented. No changes to `vitest.config.ts` or existing test files.

## Module dependencies and architecture review

Follow [workspace architecture](../../architecture.md) and the `codebase-design` skill when changing these contracts. The arrows below describe allowed internal imports, including type-only imports; a file may also use the small standard-library operations needed for its responsibility. Package consumers use only public exports.

For this slice, neither `pr-review` nor `context-engine` imports the other, including type-only imports. The CLI depends on both public exports and constructs `RepositoryComparisonInput` explicitly. No shared acquisition interface, superclass or common configuration package is needed. Each library owns its errors and validates its own public inputs.

Within `pr-review`, `limits.ts` has no internal dependencies; `acquisition/pull-request.ts` may import its local limits/options. `index.ts` deliberately exports PR types, functions, limits and caller-relevant errors.

The table below is relative to `packages/context-engine/src/`:

| Module                            | Allowed internal dependencies                                          |
| --------------------------------- | ---------------------------------------------------------------------- |
| `contracts.ts`, `limits.ts`       | None                                                                   |
| `git/process.ts`                  | `limits.ts`                                                            |
| `git/snapshot.ts`                 | `git/process.ts`, `contracts.ts`, `limits.ts`; no PR types             |
| `git/changes.ts`, `git/source.ts` | Git primitives, `contracts.ts`, `limits.ts`; keep calls one-way        |
| `tools/contracts.ts`              | `contracts.ts`, `limits.ts`                                            |
| `tools/execute.ts`                | Git access, `tools/contracts.ts`, `contracts.ts`, `limits.ts`          |
| `evidence.ts`                     | `contracts.ts`, `tools/contracts.ts`, `limits.ts`                      |
| `assembly.ts`                     | `contracts.ts`, `evidence.ts`, `limits.ts`                             |
| `engine.ts`                       | Tool session/validation, ledger, assembler, snapshot lifecycle, limits |
| `index.ts`                        | Deliberate re-exports; internal modules never import this barrel       |

`pr-review/src/acquisition/pull-request.ts` owns `PullRequestRef` and `ResolvedPullRequest`; its `limits.ts` owns `PullRequestLimits` and `ResolvePullRequestOptions`. In context-engine, `contracts.ts` owns `RepositoryComparisonInput`, `LocalComparisonInput`, `ReviewIdentity`, `Side`, `ByteRange`, `SourceRef`, `SourceEvidence`, `ContextNotice`, and `Change`, adding each only when first consumed. Its `limits.ts` owns `ContextLimits` and `OperationOptions`; `tools/contracts.ts` owns tool variants; `evidence.ts` owns `EvidenceSnapshot`; `assembly.ts` owns packet/budget contracts.

Core contracts, retention, and assembly do not import acquisition, Git implementations, provider SDKs, or app code. Hashing and UTF-8 byte operations are permitted in memory. The caller-supplied token counter is the existing narrow dependency for token admission; do not add a provider registry or speculative retrieval interface. Git implementations may call one another only in one direction, without cycles.

At each task's review, inspect imports and public exports, check the change scenarios in `docs/architecture.md`, and document the reason for any dependency change. Existing ESLint checks enforce the core static-import restrictions. Task 1 adds bidirectional package import restrictions for `pr-review` and `context-engine`; source review also checks public exports and runtime I/O. These checks do not detect all cycles or dynamic/global I/O. Retain manual source review and the existing checks without adding test files. Record significant trade-offs in ADR 0002 and concrete examples in the walkthrough.

## Shared contract decisions

These are scoped contracts, not a general framework. Define each in its owning file when its task lands; `index.ts` exports only the types/functions consumers need.

- `PullRequestRef` (pr-review): readonly `{ url: string; owner: string; repository: string; number: number }`.
- `ResolvedPullRequest` (pr-review): readonly `{ ref: PullRequestRef; targetRepositoryUrl: string; headRepositoryUrl: string; targetCommit: string; headCommit: string }`; repository URLs and commit IDs are validated.
- `PullRequestLimits` (pr-review): readonly `{ httpTimeoutMs: number; maxHttpBytes: number }`, defaulting to `30_000` and `2_097_152`. `ResolvePullRequestOptions`: readonly `{ signal: AbortSignal; limits: PullRequestLimits; token?: string }`. The host supplies any overall deadline through the signal.
- `RepositoryComparisonInput` (context-engine): readonly `{ targetRepositoryUrl: string; headRepositoryUrl: string; targetCommit: string; headCommit: string }`. It contains no PR reference, number, provider metadata or token. The receiver validates names, origins and full commit IDs even when a previous adapter validated them.
- `LocalComparisonInput` (context-engine): readonly `{ repositoryPath: string; targetCommit: string; headCommit: string }`. Local callers do not resolve a PR or construct a remote URL.
- `ReviewIdentity`: readonly `{ sessionId: string; repositoryUrl: string; targetCommit: string; baseCommit: string; headCommit: string }`. `repositoryUrl` is the canonical target repository identity; `baseCommit` is the computed merge base.
- `Side = 'base' | 'head'`; `ByteRange = { startByte: number; endByte: number }`, both safe nonnegative integers.
- `SourceRef`: readonly `{ sessionId: string; side: Side; commit: string; path: string; blobId: string; range: ByteRange }`.
- `SourceEvidence`: readonly `{ ref: SourceRef; text: string }`; source is admitted only after exact-byte/range validation.
- `ContextNotice`: readonly `{ code: string; message: string; path: string | null }`; centralize the specific codes emitted by this slice, and redact subprocess/HTTP details before presentation.
- `Change`: session-local `id`, nullable `beforePath`/`afterPath`, nullable before/after modes, status `'added' | 'deleted' | 'modified' | 'renamed' | 'type-changed'`, kind `'text' | 'binary' | 'symlink' | 'submodule' | 'unsupported'` and hunk before/after line coordinates.
- `GitSnapshot`: immutable `identity` plus a private repository handle; `close(): Promise<void>` cleans only owned temporary state. The private directory never appears in model tool data.
- `OperationOptions` (context-engine): readonly `{ signal: AbortSignal; limits: ContextLimits }`. `ContextLimits` has `acquisitionTimeoutMs`, `gitTimeoutMs`, `maxGitOutputBytes`, `maxBlobBytes`, `maxToolBytes`, `maxPageEntries`, and `maxContextBytes`, with the spec defaults; no HTTP fields. In both libraries, overrides must be positive safe integers and may only lower defaults. The CLI starts one acquisition deadline using `limits.acquisitionTimeoutMs` before PR resolution and passes its signal through resolution and snapshot acquisition; it must not restart the overall budget between stages.
- `TokenBudget`: `{ counterId: string; maxTokens: number; countTokens: (renderedContext: string) => Promise<number> }`. Counts apply to that exact rendering, not a full provider request.
- Invalid user/tool requests throw a typed input error; acquisition and operation failures preserve a redacted cause. Expected unavailable source is represented in tool notices/results, not converted into empty success.

The initial session is a Git-backed comparison; PR independence does not imply support for arbitrary storage or single-revision sessions. Keep the current comparison contracts until a concrete additional workflow justifies extending them.

The new schema does not claim compatibility with Rust evidence IDs, lane files, or RCI/PCG serialization. Future integration must map explicitly without weakening source identity.

## Task 1: Resolve public PR metadata in pr-review

**Files:** Create `packages/pr-review/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/index.ts`, `src/limits.ts` and `src/acquisition/pull-request.ts`. Modify root `tsconfig.json`, `bun.lock`, `eslint.config.mjs` and the ownership docs listed above. Create ADR 0002 and the walkthrough. Do not leave an empty context-engine workspace.

**Completed:** The resolver draft was rehomed into `pr-review`; only its HTTP limits remain. The superseded context-engine workspace/build registration is gone. Manual demonstrations and independent source review are recorded in the walkthrough. The package builds and passes the existing checks without new tests or runtime dependencies.

**Interfaces, exported by `@daphne/pr-review`:**

- Consumes: a URL string, optional host-supplied read token and `AbortSignal`.
- Produces `parsePullRequestUrl(value: string): PullRequestRef`.
- Produces `resolvePullRequest(ref: PullRequestRef, options: ResolvePullRequestOptions): Promise<ResolvedPullRequest>`.
- Produces `defaultPullRequestLimits` and `resolvePullRequestLimits(overrides?: Partial<PullRequestLimits>): PullRequestLimits`.
- No imports from or exports through `@daphne/context-engine`; no environment-variable reads in the library.

- [x] **Step 1: Register the working PR package.** Rehome the draft as described above. Mirror CLI build/typecheck conventions, export `dist/index.js` and declarations, and declare exact TypeScript/Node type tooling. Do not add Vitest or a tests directory. Register only `pr-review` for this step and run `bun install` with the pinned Bun.
- [x] **Step 2: Implement URL/HTTP-limit validation.** Enforce the accepted URL grammar, safe positive PR number and the two PR-limit defaults. Reject arbitrary hosts, embedded credentials and invalid overrides. Keep typed input errors local to this package.
- [x] **Step 3: Implement metadata resolution.** Use Node `fetch` with JSON accept headers, API version `2026-03-10`, redirect rejection and bounded response reading. Combine the caller's signal with the HTTP timeout through the complete body read. Validate repository names, public visibility and full commit IDs before constructing trusted GitHub repository URLs. Explain 401/403/404/rate-limit failures without echoing tokens.
- [x] **Step 4: Record and enforce ownership.** Update architecture/migration docs and ADR 0002: `pr-review` owns acquisition; context-engine starts in Task 2; RCI/PCG own indexing. Restrict imports between the two packages in both directions, including package subpaths and relative source paths. Add the walkthrough's PR-URL/trust-boundary lesson. Keep the CLI free of HTTP implementation details.
- [x] **Step 5: Manually demonstrate the resolver.** Run `bun run build`, then use `node --input-type=module` from `packages/pr-review` and import `@daphne/pr-review` through its compiled public exports. Parse `https://github.com/daphne-proj/pr-review-test/pull/1` and inspect owner/repository/number; reject `https://example.com/o/r/pull/1` before network access. Resolve an accessible public PR and compare IDs with GitHub metadata. Inspect cancellation, a lowered response cap and timeout, and sanitized authentication failure. An unavailable PR is an acquisition error, never a pass.
- [x] **Step 6: Review, verify and commit the focused deliverable.** Apply the readability guidance, independently review the acquisition boundary, format touched files, run `bun run check` and `git diff --check`, inspect scope and commit as `feat(pr-review): resolve public pull request inputs`. Confirm no new tests or runtime dependencies and no context-engine placeholder. Stage only this task's files; do not push.

**Discuss before the next task:** TypeScript types describe validated values; they do not make HTTP responses trustworthy. The resolver produces PR metadata, while the receiving Git API will own its separate comparison input.

## Task 2: Acquire and freeze the Git comparison

**Files:** Create `packages/context-engine/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/index.ts`, `src/limits.ts`, `src/contracts.ts`, `src/git/process.ts`, `src/git/snapshot.ts` and `src/git/changes.ts`. Modify root `tsconfig.json`, `bun.lock`, ownership docs and walkthrough. From Task 3 onward, unqualified module paths refer to this package's `src/`. Add only contracts consumed by this task.

**Interfaces:**

- Consumes: caller-supplied `RepositoryComparisonInput` or `LocalComparisonInput` and this package's `OperationOptions`; no PR-specific dependency.
- Produces `defaultContextLimits` and `resolveContextLimits(overrides?: Partial<ContextLimits>): ContextLimits`.
- Produces `acquireSnapshot(input: RepositoryComparisonInput, options: OperationOptions): Promise<GitSnapshot>`.
- Produces `openLocalSnapshot(input: LocalComparisonInput, options: OperationOptions): Promise<GitSnapshot>` for library/manual use; it creates its own bare snapshot and never modifies the input checkout.
- Produces `listSnapshotChanges(snapshot: GitSnapshot, options: OperationOptions): Promise<readonly Change[]>`.
- Internal `runGit(args: readonly string[], cwd: string, options: OperationOptions & { fetch: boolean; acceptedExitCodes?: readonly number[] }): Promise<Buffer>`.

- [ ] **Step 1: Register the working context package and its limits.** Mirror the existing build/export conventions, declare exact TypeScript/Node type tooling, add the root build reference and update the Bun lock. Implement the seven context-limit defaults and validation without HTTP fields. Update ownership docs to mark the Git-backed package implemented.
- [ ] **Step 2: Implement controlled Git execution.** Spawn without a shell, control config/env and hooks location, disable external diff/textconv, bound output and time, and kill/wait for child cleanup on abort. Never inherit repository-local executable helpers or log credentials. Accept exit code 0 by default; only operations with a defined alternate outcome may pass additional accepted codes.
- [ ] **Step 3: Implement snapshot acquisition and disposal.** Validate full commit IDs and remote origins at this boundary; initially accept only credential-free canonical HTTPS GitHub repository URLs, with no query/fragment, SSH, arbitrary hosts or redirect following. This is an explicit transport restriction, not a dependency on PR metadata. Fetch exact target/head objects and required history into an owned temporary bare repo, using separate repositories when supplied. Apply one acquisition deadline across the entire snapshot operation, combined with the caller signal; do not restart it per subprocess. Verify commit object types, compute a unique merge base, retain refs and freeze identity. Close temporary state on every failure path. Local acquisition copies into owned state and uses the same validation.
- [ ] **Step 4: Enumerate a deterministic Git change inventory.** Use NUL-delimited raw path records; derive hunk coordinates separately from controlled textual diffs. Explicitly fix rename detection policy to Git `--find-renames=50%` and the Myers diff algorithm; disable color, external diff and text conversion. Do not parse filenames out of display headers or assume every change has textual hunks. Assign stable session-local change IDs in path order.
- [ ] **Step 5: Manually demonstrate immutable revisions.** Create a disposable two-commit repository under the OS temporary directory with an ordinary text change and a rename. Open it via `openLocalSnapshot`, compare the identity/inventory with `git merge-base` and `git diff --name-status --find-renames=50%`, then move the original branch and confirm the session still reports the original head. Inspect divergent target history to show why target tip and merge base differ. Demonstrate that local acquisition needs no PR URL, token or import from pr-review.
- [ ] **Step 6: Check failure cleanup manually.** Supply a missing commit and abort an acquisition; confirm explicit failure, terminated Git work and removal only of the engine-owned temporary directory. Reject a disallowed remote origin before Git runs. Inspect argument construction for distinct target/head repositories and supplied/fetched-commit mismatch.
- [ ] **Step 7: Verify and commit.** Run formatting, `bun run check` and `git diff --check`. Commit as `feat(context): pin Git snapshots and enumerate changes`.

**Discuss:** A branch name can move; an object ID gives a reproducible input. The PR's target tip is not necessarily the diff's BASE.

## Task 3: Read exact committed evidence

**Files:** Create `git/source.ts`; extend `contracts.ts` with exact-source contracts. Update `git/changes.ts` where content classification is needed, exports and walkthrough; avoid a `changes` ↔ `source` import cycle.

**Interfaces:**

- Consumes: `GitSnapshot`, `Side`, `ByteRange` and `OperationOptions`.
- Produces `readSource(snapshot: GitSnapshot, input: { side: Side; path: string; range: ByteRange }, options: OperationOptions): Promise<SourceEvidence>`.
- Internal `readBlob(snapshot: GitSnapshot, side: Side, path: string, options: OperationOptions): Promise<{ blobId: string; bytes: Buffer }>`.
- Internal `lineRangeToBytes(bytes: Buffer, startLine: number, lineCount: number): ByteRange` uses Git hunk coordinates; zero-count ranges are anchors after the indicated preceding line.

- [ ] **Step 1: Implement object-based source access.** Resolve paths through the pinned tree to a regular-file blob and read it with Git object operations. Validate type/size first; never concatenate a model path into a shell or dereference a symlink on the host filesystem.
- [ ] **Step 2: Implement exact range/encoding conversion.** Check safe integer bounds and UTF-8 boundaries, retain BOM/CRLF bytes, derive line coordinates without newline normalization, and handle empty-file/insertion/deletion anchors. Invalid UTF-8 yields unavailable text, not replacement characters presented as original source.
- [ ] **Step 3: Materialize host-generated source identity.** Attach the correct session, commit, side, path, blob and byte range; verify any retained evidence against these bytes. Report binary, symlink, submodule and oversized sources explicitly.
- [ ] **Step 4: Manually inspect byte boundaries.** Extend the disposable repository with an emoji, CRLF, an empty file, a deletion and a symlink. In `node --input-type=module` compare returned excerpts with `git show` bytes; request a range inside the emoji and confirm rejection; confirm deleted content is readable only on BASE and symlinks are not followed.
- [ ] **Step 5: Verify and commit.** Run formatting, `bun run check` and `git diff --check`. Commit as `feat(context): retain exact committed source ranges`.

**Discuss:** JavaScript string positions count UTF-16 units; our source references address UTF-8 bytes. A valid source reference proves origin, not a correct interpretation.

## Task 4: Expose four bounded retrieval tools and retain their evidence

**Files:** Create `tools/contracts.ts`, `tools/execute.ts` and `evidence.ts`; update exports and walkthrough.

**Interfaces:**

- Consumes: snapshot/source/change functions from Tasks 2–3.
- `ToolRequest` discriminates on `name`: `list_changes` takes cursor/page limit; `inspect_change` takes change ID/cursor; `read_source` takes side/path/range/cursor; `search_code` takes side/query/literal path prefix/cursor/page limit. All may lower the response byte allowance.
- `ToolResult`: `{ request: ToolRequest; entries: readonly ToolEntry[]; completeness: 'complete' | 'partial' | 'unavailable'; nextCursor: string | null; notices: readonly ContextNotice[] }`.
- `ToolEntry` is a tagged union of a change record, `SourceEvidence`, or search navigation hit with side/path/byte location/preview. Declare the actual variants in `tools/contracts.ts`, not `unknown` payloads.
- `parseToolRequest(input: unknown): ToolRequest` rejects malformed/unknown fields.
- `createToolSession(snapshot: GitSnapshot, options: OperationOptions): { execute(request: ToolRequest): Promise<ToolResult> }` owns session-local cursors.
- The internal, unexported `EvidenceLedger` receives host-validated tool evidence and has `retain(source: SourceEvidence): string`, `record(result: ToolResult): void` and `snapshot(): EvidenceSnapshot`.
- `EvidenceSnapshot` contains the identity, ordered `{ evidenceId: string; source: SourceEvidence }` entries, normalized query/page progress and bounded navigation observations/notices. Evidence IDs are session-local and never index IDs.

- [ ] **Step 1: Implement request validation and result variants.** Enforce side/path/range/query limits at runtime. Reject embedded revision overrides; requests use the active session only. Treat source and PR text as untrusted data.
- [ ] **Step 2: Implement the four tools.** List inventory, inspect hunk windows, read bounded source, and use literal case-sensitive `git grep` over a pinned tree. For grep only, exit 1 means no matches and may return an empty complete result; exit 2 or a killed process remains failure. Use literal pathspecs derived from validated paths/prefixes. Search can visit tracked configuration/docs as well as TS/JS source; do not silently adopt ignore-file rules as a review coverage policy.
- [ ] **Step 3: Implement pagination and output admission.** Page within the exact serialized tool-response byte cap and 100-entry maximum; split source at UTF-8 boundaries with explicit continuation. Bind cursors to normalized parameters and size. A single unrepresentable item must produce a limit notice/error, not an empty complete page.
- [ ] **Step 4: Implement the ledger.** Reject wrong-session/conflicting source; deduplicate only identical references; store original validated excerpts. Advance query state only for successfully executed pages in the correct chain. Search previews do not enter the source collection.
- [ ] **Step 5: Manually exercise tools.** Use the disposable repository through the compiled API. Inspect list → change → source, search a known identifier, request a tiny response allowance and follow its cursor, then change the query with that cursor and confirm rejection. Repeat a source read and inspect deduplication; cancel a page and confirm progress was not marked complete.
- [ ] **Step 6: Verify and commit.** Run formatting, `bun run check` and `git diff --check`. Commit as `feat(context): add bounded retrieval and evidence tracking`.

**Discuss:** A search hit identifies a place to investigate. Reading it establishes source evidence; neither operation means the model has received it.

## Task 5: Assemble bounded context and compose the engine

**Files:** Create `assembly.ts` and `engine.ts`; update exports and walkthrough.

**Interfaces:**

- Consumes: `EvidenceSnapshot`, `ToolRequest`, `GitSnapshot` and optional `TokenBudget`.
- `AssembleInput`: `{ evidenceIds: readonly string[]; maxBytes: number; tokens?: TokenBudget }`.
- `ContextPacket`: immutable `{ format: 'daphne-context-v1'; packetId: string; identity: ReviewIdentity; includedEvidenceIds: readonly string[]; omittedEvidenceIds: readonly string[]; notices: readonly ContextNotice[]; renderedContext: string; byteCount: number; tokenCount: number | null }`. Exact selected source and bounded navigation are encoded inside `renderedContext`; avoid duplicating their text in the envelope.
- `assembleContext(snapshot: EvidenceSnapshot, input: AssembleInput): Promise<ContextPacket>`.
- `ContextEngine` exposes `identity`, `execute(input: unknown): Promise<ToolResult>`, `evidence(): EvidenceSnapshot`, `assemble(input: AssembleInput): Promise<ContextPacket>` and `close(): Promise<void>`.
- `createContextEngine(snapshot: GitSnapshot, options: OperationOptions): ContextEngine` transfers snapshot cleanup ownership to the engine.

- [ ] **Step 1: Implement explicit selection/rendering.** Validate requested IDs and budget, preserve caller priority, remove repeated IDs, and serialize source/reference/navigation/limitation data deterministically. Default CLI selection is inventory order; no learned ranking or index query belongs here.
- [ ] **Step 2: Implement whole-entry budget admission.** Count the final UTF-8 rendering, including all omissions and metadata; remove lower-priority entries until it fits. If token limits are supplied, await and validate the provided counter on that exact string as well. Recount after every rendering change; do not assume separately counted fragments add up. An envelope that cannot fit yields a typed limit error.
- [ ] **Step 3: Implement immutable packet identity.** Use SHA-256 over the final rendering plus identity/format and counting configuration metadata (`counterId` and token cap, or null); record the admitted counts without claiming the full provider request was counted. Keep retained ledger data unchanged by assembly; return defensive copies or frozen records so public snapshots cannot mutate its state.
- [ ] **Step 4: Compose the public engine.** Route validated requests to the tool session, record only completed results, and delegate assembly/cleanup. No generic inheritance, model SDK, autonomous loop or placeholder RCI/PCG provider.
- [ ] **Step 5: Manually inspect assembly.** Retrieve two sources, assemble with room for both, then a smaller limit. Compare actual `Buffer.byteLength(packet.renderedContext, 'utf8')` with `byteCount`, inspect omissions and confirm the ledger still has both sources. Unknown IDs, conflicting sources and an impossibly small envelope must fail explicitly. Token counting remains `null` without a supplied counter; review the callback branch in source rather than inventing a fake tokenizer.
- [ ] **Step 6: Verify and commit.** Run formatting, `bun run check` and `git diff --check`. Commit as `feat(context): assemble bounded evidence packets`.

**Discuss:** Retention and presentation have different lifecycles. Assembling a packet is not sending it, and passing a byte cap is not passing a model token cap.

## Task 6: Deliver the PR URL inspection command

**Files:** Create `apps/cli/src/context.ts` and `apps/cli/src/output.ts`. Modify `apps/cli/src/main.ts`, `package.json`, `tsconfig.build.json`, `bun.lock` and the walkthrough.

**Interfaces:**

- Consumes: PR metadata APIs from `@daphne/pr-review` (Task 1) and repository/context APIs from `@daphne/context-engine` (Tasks 2–5).
- `parseContextArgs(args: readonly string[]): { pr: string; output: string }` uses Node `util.parseArgs` and rejects unexpected flags/positionals.
- `runContextInspect(input: { pr: string; output: string }, signal: AbortSignal): Promise<0 | 1 | 2>` writes stdout/stderr/artifacts according to the spec.
- `createRunDirectory(path: string): Promise<string>` requires a new directory.
- `writeArtifact(directory: string, filename: 'context.json' | 'run.json', value: unknown): Promise<void>` writes inside the owned directory through a temporary file and rename.

- [ ] **Step 1: Add workspace consumption and dispatch.** Declare `@daphne/pr-review: workspace:*` and `@daphne/context-engine: workspace:*` and both build references; update the lock. Keep no-argument behavior unchanged and route `context inspect` explicitly.
- [ ] **Step 2: Implement the acquisition → inspection → assembly flow.** Read the optional GitHub token in the host and pass it only to pr-review. Before resolution, start one acquisition deadline using `contextLimits.acquisitionTimeoutMs`, combined with user cancellation. Resolve the URL through pr-review, explicitly copy repository URLs and commit IDs into `RepositoryComparisonInput`, and acquire the snapshot through context-engine with the same acquisition signal. Never pass `ResolvedPullRequest`, its `ref` or the token into the engine. After acquisition, use the user-cancellation signal for inspection rather than the expiring acquisition signal. Create the engine, enumerate changes in stable path order and inspect source through its public tools. Track remaining changes and stop fetching additional text once the 65,536-byte source inspection allowance is reached; this is a source-read allowance, separate from final rendering admission. Assemble retained evidence in that order and record all exclusions.
- [ ] **Step 3: Implement safe artifacts and terminal status.** Claim the new output directory with owner-only permissions before external work; use exclusive temporary-file creation and reject pre-existing artifact names. Save the context packet and bounded run metadata, print the compact JSON summary, and use 0/2/1 for successful/partial/failed inspection. Any incomplete tool chain, unsupported changed content, omitted change or source-budget stop makes the inspection partial. No “review passed” claim.
- [ ] **Step 4: Implement interruption and cleanup.** Convert SIGINT/SIGTERM into one AbortController, await child cleanup, save a stopped run where possible and close the engine in `finally`. An existing destination fails before acquisition; preserve any existing data.
- [ ] **Step 5: Run the end-to-end manual demonstration.** Set `taskPrUrl` to the accessible public URL from Task 1 and `taskRunDir` to a nonexistent path under an owned temporary directory. Run `bun run cli -- context inspect --pr "$taskPrUrl" --output "$taskRunDir"` after `bun run build`. Inspect both artifacts, compare pinned commits/selected excerpts with Git, and explain any exit 2 limitations. Repeat with the same output path and confirm rejection; interrupt a fresh run and inspect cleanup.
- [ ] **Step 6: Review, verify and commit.** Apply `daphne-code-readability`, obtain an independent implementation review, format touched files, run `bun run check` and `git diff --check`. Confirm no test files/dependencies were added or changed. Commit as `feat(cli): inspect PR context from a URL`; do not push without a request.

**Discuss:** This command demonstrates the context engine. It does not yet evaluate findings, group changes or prove review quality.

## Completion and next boundary

- Record commands actually run, source inspections and limitations in the walkthrough. Existing tests cover the existing CLI smoke behavior only.
- Record which defaults stopped any manual run and why; do not silently raise them to obtain a green demonstration.
- Keep this six-task implementation separate from the next plan: model runtime/tool-call presentation and a first review or split-pr consumer.
- Add RCI/PCG integration only when the qualified index/session APIs exist. No new indexes are needed to finish this plan.
- Task 1 is complete. The next learner checkpoint is Task 2's repository/revision input and immutable Git snapshot. Do not execute all remaining tasks without the requested explanations and walkthroughs.

## Planning self-review

- Spec coverage: PR URL/HTTP security and limits → Task 1; independent comparison inputs, context limits and Git lifecycle → Task 2; bytes and unsupported source → Task 3; tools/cursors/retention → Task 4; context admission/composition → Task 5; artifacts/cancellation/CLI → Task 6.
- Interface consistency: Task 1 exports only pr-review contracts; Task 2 owns comparison inputs and context limits; Task 6 explicitly maps between packages. Tasks 3–5 consume no PR types. Source/evidence/packet identities remain distinct; RCI/PCG contracts are deliberately not invented.
- User overrides: main branch and no added tests replace worktree/TDD defaults. Manual checks do not establish automated regression coverage.
- Proportion: implementation bodies are left to the implementer; files, external contracts, limits and expected demonstrations are specified.
- Execution status: Task 1 is complete in pr-review. Tasks 2–6 remain pending; there is no context-engine placeholder. Step 1 was manually demonstrated and independently reviewed, with the existing check gate passing and no new tests.

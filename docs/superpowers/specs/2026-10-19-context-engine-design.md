# Context Engine Design

Status: revised boundaries, 2026-10-19; corrected Step 2 was approved and implemented in git-source; Step 3 source evidence, Step 4 bounded tools and Step 5 independent retention/assembly are implemented; Step 6 CLI composition is implemented. This is a new TypeScript foundation, not a port of the Rust agent loop or a claim of Rust output compatibility.

## Intent and learning goal

Build a reusable context engine that retains supplied evidence and assembles inspectable packets for a read-only AI review agent. Separate Git and review-evidence packages establish the exact code under review and expose bounded retrieval operations. The first CLI workflow starts from a GitHub PR URL, resolved outside the engine. TypeScript/JavaScript repositories are the first supported review scope.

The developer should be able to trace a source excerpt from a model-facing packet back to its committed bytes and explain why it was included. Work one task at a time: explain the boundary, implement it, demonstrate it, inspect the result, and discuss the tradeoff before the next task.

## User decisions

- Work directly on `main` in `/Users/pietroputelli/Desktop/daphne-node`; no new branch or worktree.
- Do not add tests, test fixtures, test dependencies, or a replacement test harness in this implementation.
- Keep existing checks enabled; use manual demonstrations and source review for new behavior.
- Use TypeScript with Node as runtime and Bun for installation/scripts.
- RCI and PCG own indexing and repository semantics, following the Rust domain boundaries.
- Do not implement indexing, source-code parsing, BM25, embeddings, vector storage, or graph construction here.
- Keep the implementation readable and small enough to understand step by step.
- Keep PR URLs, GitHub HTTP/authentication and PR transport types in `@daphne/pr-review`; repository/revision inputs belong to `@daphne/git-source`. The host maps values explicitly.
- Keep Git access in `@daphne/git-source`, bounded retrieval in `@daphne/review-evidence`, and supplied-evidence retention/assembly in `@daphne/context-engine`. The host owns retrieval orchestration and Git cleanup; do not introduce a generic acquisition package or provider framework.

## Ownership and non-goals

RCI owns facts and deterministic navigation for an immutable extracted revision. PCG owns changes and qualified current navigation for an exact review comparison. Neither owns model prompts or evidence selection. Review-evidence owns bounded retrieval. Context-engine owns retained source evidence, recorded query progress, and the projection supplied to a consumer.

This slice provides Git-backed access while RCI/PCG are deferred. Raw text search is a bounded navigation operation over committed blobs, not a competing code index. No syntax parser, symbol map, dependency inference, semantic matching, or graph DTO is introduced.

Later, RCI/PCG integration in review-evidence will produce qualified locators which the same committed-source reader resolves. That integration must validate the required baseline snapshot, repository, revisions, extraction interpretation and PCG build binding. A serialized PCG alone must not be assumed to contain hydrated HEAD navigation. Do not define that adapter until those packages exist.

Model transport, prompt policy, autonomous exploration, finding generation, semantic grouping, split-pr acceptance, GitHub comment publication, and running repository code are separate features. The first command is `context inspect`, not a pretend implementation of `split-pr`. The future `split-pr --pr URL` can consume the same engine.

## Architecture

Use four focused packages, introduced only with their first working behavior. PR resolution is implemented in Task 1; Git access starts in Task 2; evidence materialization starts in Task 3; context retention and assembly start in Task 5.

| Owner                            | Responsibilities                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@daphne/pr-review`              | PR URL validation, GitHub metadata/authentication, HTTP limits and acquisition errors                                         |
| `@daphne/git-source`             | Repository/revision inputs, immutable Git snapshots, comparison, exact blob reads, Git search, subprocess limits and disposal |
| `@daphne/review-evidence`        | Validated source evidence, bounded repository operations, session-local cursors and later RCI/PCG integration                 |
| `@daphne/context-engine`         | Retention of supplied evidence, deduplication, recorded query progress and bounded packet assembly                            |
| CLI / future agent orchestration | Connect public APIs, choose retrieval/selection, own deadlines, cancellation, resource lifetime and output                    |
| RCI / PCG                        | Future indexing and qualified semantic navigation                                                                             |

The context engine neither retrieves source nor owns repository resources. Its constructor receives an immutable evidence-session identity and context limits. It accepts supplied source evidence and completed tool results; it does not accept PR metadata, repository acquisition inputs, a `GitSnapshot`, a source reader, or a retrieval callback. It exposes no `execute` or repository `close` method. No provider registry, generic acquisition package, dependency container or engine superclass is required.

Allowed package dependencies:

- `pr-review` and `git-source` are independent; neither imports the other or the two downstream packages.
- `review-evidence` implementation imports the public `git-source` API. Its `@daphne/review-evidence/contracts` subpath exports only I/O-free evidence/tool data types and imports no Git implementation or Git types. The implementation maps Git facts into these contracts.
- `context-engine` imports those contracts with `import type` only. It has no runtime dependency on review-evidence execution and no direct or re-exported dependency on Git handles, PR acquisition, filesystem or subprocess APIs. Its package manifest declares the workspace type dependency, but emitted JavaScript must not load the retrieval package. The contracts subpath must resolve directly to its own compiled module, never through a runtime barrel.
- The CLI composes all four packages through their public exports. Internal imports remain one-way and avoid public barrels.

Contract ownership follows the receiving responsibility. `git-source/contracts.ts` owns `RepositoryComparisonInput` (target/head repository URLs and exact commits), `GitSnapshotIdentity` and `GitChange`. The host explicitly maps PR metadata into Git input. Two URLs preserve fork support.

`review-evidence/contracts.ts` owns `ReviewIdentity`, `Side`, `ByteRange`, `SourceRef`, `SourceEvidence`, `Change`, notices and tool data. The identity contains session/repository/target/base/head metadata copied from the snapshot; it is not a resource handle. Source provenance can contain commit/blob IDs without making context assembly execute or understand Git. Retention rechecks session/range/conflict invariants, but establishing correspondence with committed bytes belongs to review-evidence and git-source.

`context-engine` owns its ledger snapshot, packet, selection and token-counting contracts. It retains original evidence independently of packet selection. Assembly is in-memory except for an optional caller-supplied token counter; it never invokes retrieval or fills missing evidence.

This preserves the Rust responsibility split: `git-source` reads repository facts, `review-evidence` exposes pinned repository operations, and `review-agent/src/context.rs` retains evidence and query progress. Rust currently has transitive package dependencies through review-evidence; the TypeScript contracts subpath deliberately avoids a runtime retrieval dependency in context-engine. This is an architectural adaptation, not a claim of exact crate or output parity.

These documents and ADR 0002 supersede the earlier instruction to keep Git inside context-engine. Corrected Task 2 synchronizes broader workspace ownership docs and lint rules, rehomes the Git draft into git-source, and removes the old context-engine registration. Step 3 adds a working review-evidence source session, Step 4 adds bounded tools and Step 5 introduces independent context retention and assembly.

Information flow:

1. The CLI resolves the PR URL through pr-review and maps the remote repository URLs and exact commits into git-source input.
2. The host acquires a snapshot through git-source, pinning target, head and the computed merge base.
3. Review-evidence borrows that snapshot and exposes validated source reads and bounded repository operations.
4. The host executes retrieval and explicitly records successful results in context-engine.
5. The host selects evidence IDs; context-engine assembles a bounded packet.
6. The host emits artifacts and closes the Git snapshot in `finally`, even if retrieval or assembly fails.

Closing Git resources cancels/waits for their in-flight work. Review-evidence does not take cleanup ownership. Already retained evidence and packets remain usable after the snapshot is closed; new repository operations fail explicitly.

## Acquisition and snapshot identity

In pr-review, initially accept canonical HTTPS `github.com/<owner>/<repository>/pull/<positive-integer>` URLs, optionally with a trailing slash. Reject credentials, query strings, fragments, alternative hosts, and arbitrary clone URLs. GitHub Enterprise and private-repository authentication flows are deferred. The host may read `GITHUB_TOKEN` and pass it to pr-review for metadata read access/rate limits. The library does not read environment variables; never log the token, embed it in a clone URL or pass it to context-engine.

Use Node `fetch` for the single PR metadata endpoint. Request JSON, pin API version `2026-03-10`, bound response size, and validate consumed fields from `unknown`. Construct fetch URLs from the trusted GitHub origin and validated repository names. Reject redirects and private base/head repositories for this first slice.

Git-source independently validates its remote repository inputs before running Git. The first remote transport policy allows only credential-free canonical HTTPS GitHub repository URLs without query strings, fragments or redirects; arbitrary hosts and SSH remain unsupported. This transport restriction requires no PR metadata or GitHub API call. Local-checkout acquisition is out of scope; the only acquisition entry point fetches these remote commits.

Record separately:

- `targetCommit`: caller-supplied target revision (the target branch tip for a PR);
- `headCommit`: caller-supplied head revision (the reported PR head in the CLI workflow);
- `baseCommit`: the unique merge base computed from the acquired commits.

Use merge base → head for the review diff. Never substitute the latest branch after a run begins. Reject unavailable objects, multiple merge bases, and supplied/fetched-commit mismatch with actionable errors. A newly pushed PR requires a new session; acquisition is not a publication freshness guarantee.

Use a fresh temporary bare repository per run. Fetch the required base/head history without a shallow boundary; fetch the validated fork repository when needed. Use git-source-owned refs to retain fetched objects through the run. No shared cache, lock manager, incremental indexing, submodule fetch, or dependency installation in this slice.

Initially support complete SHA-1 repositories on macOS/Linux; reject shallow or borrowed object stores, non-UTF-8 paths and unsupported platforms explicitly. These are Git adapter limits, not context-builder requirements.

All Git invocations use argument arrays, a controlled environment/configuration, disabled external diff/text conversion, noninteractive authentication, deadlines, bounded stdout/stderr and explicit cleanup. No shell tool is exposed. A bare repository avoids executing checked-out files but does not replace subprocess controls.

## Exact evidence and unsupported content

Review-evidence materializes source evidence from exact git-source reads. A source reference includes session identity, side, commit, repository-relative path, Git blob identity, and zero-based half-open byte range. The host derives these fields; model-supplied identity is never trusted.

Source reads preserve original bytes. Validate UTF-8 before producing model text, preserve CRLF/BOM, and reject ranges splitting an encoded character. Step 3 accepts byte ranges directly; line/hunk-to-byte conversion is deferred until Task 4 consumes hunk windows. Line numbers are display metadata derived from those same bytes, not canonical identity. BASE and HEAD coordinates are never interchangeable.

Inventory additions, deletions, renames, mode changes, binary files, symlinks and submodules. Copies may appear as additions in the initial diff policy. Never follow symlinks or materialize submodules. Non-UTF-8 paths/content and oversized blobs remain explicit limitations, not silently decoded or fabricated source. Preserve raw path identity internally when display requires an escaped representation.

Each tool distinguishes complete results, partial results, unavailable evidence and invalid requests. Empty successful search results mean no match within the declared scope only. Pagination cannot silently broaden that scope.

## Retrieval operations

Review-evidence owns the initial model-neutral tool union with four operations:

- `list_changes`: page the changed-file inventory.
- `inspect_change`: return one change's metadata and paged before/after source windows around its Git hunks, with a fixed three-line margin, clamped bounds and overlapping/adjacent windows merged per side/path.
- `read_source`: read a bounded byte range at an explicit side and path.
- `search_code`: literal, case-sensitive single-line text search at an explicit side, optionally constrained to a literal path prefix; return navigation hits with exact locations.

Review-evidence uses bounded Git-native snapshot search exposed by git-source; do not introduce BM25 or an index. Git commands never enter context-engine. Tool output is data, including repository instructions found inside code or PR text. Trusted application policy comes from the host, never from a PR-authored file.

Opaque cursors are session-local and bound to the complete normalized query, page size and position. Reject foreign/expired cursors or changed query parameters. Every result carries its evidence-session identity, including empty and navigation-only pages. Retention rejects foreign identities. Only successfully completed pages advance query progress; unavailable results and failed/cancelled operations cannot establish query exhaustion. A cursor need not be portable between processes.

Continuations are retryable and authenticated with a per-evidence-session key; they bind normalized arguments, effective limits and position without a growing cursor registry or cached responses. A new evidence session rejects old tokens. Source requests retain their original range while each returned reference describes only the bytes delivered. Successful continued pages always make progress.

Completeness describes the requested operation within its scope. `complete` requires no continuation and no coverage limitation; `partial` may have a cursor for more items or no cursor with explicit limitations; `unavailable` supplies no requested evidence. Earlier limitations remain reflected on the terminal page. Invalid requests, cancelled/failed Git work and envelopes or indivisible items that cannot fit fail explicitly.

Measure the entire serialized JSON response, including identity, request, entries, notices and cursor. Bound notices as well as entries. Source splitting preserves character boundaries. Git candidate search and inventory must finish within their independent resource limits before their output can be treated as complete. Search filters literal path prefixes after searching their containing directory; output caps may therefore be reached by candidates outside the final prefix. Unsupported matching blobs remain explicit limitations. Recomputing bounded results per page is accepted initially; no streaming search or result cache is required.

## Evidence retention and context assembly

Keep three concepts distinct: discoverable locations, exact source read, and source selected for this packet. A search preview is navigation; it becomes source evidence only through a validated source read. A source read grants provenance, not proof that an inferred bug is real.

The host passes completed tool results and exact source evidence into context-engine. The ledger assigns session-local evidence IDs, deduplicates identical references, rejects conflicting bytes, and keeps pagination progress even when an older observation is omitted from the packet. No summaries, long-term model memory, or learned ranking in this slice.

Whole-page recording is atomic. Identical retries are no-ops; conflicting repeats, foreign identities and out-of-order pages fail without changing state. Each normalized query has one chain; cursors remain opaque data. Same-source overlap must agree byte-for-byte, and one side/commit/path cannot name inconsistent blobs. Consistent overlapping excerpts remain separate.

Retention defaults to 4 MiB of deterministic serialized ledger data: identity, unique sources, query/page bookkeeping, navigation and notices. Page source entries use retained IDs. Reject over-budget transactions atomically without eviction; this is not a claim about exact JavaScript heap or transient memory. Callers may lower this independent cap.

Assembly captures immutable state before any asynchronous token counting. Admit host-selected source in priority order, then whole navigation observations/notices in recorded order without displacing admitted source. Mandatory query completion summaries and explicit omissions preserve limitations even when detailed observations are omitted. Standalone assembly validates supplied snapshots without Git or retrieval.

The host provides an ordered list of evidence IDs to the assembler. Keep that priority order; deduplicate identical IDs; reject unknown IDs. Include whole evidence entries while they fit, record omitted IDs, and never clip source silently. Omission bookkeeping and serialization overhead count toward the byte limit. If the required envelope cannot fit, fail explicitly.

`ContextPacket` contains the frozen identity, selected/omitted evidence IDs, structured limitations and rendering metadata. Selected exact sources and bounded navigation observations are encoded inside `renderedContext`, the exact model-neutral string whose size was admitted; do not duplicate source text in the envelope. It does not contain trusted system instructions.

Assembly always enforces a UTF-8 byte limit. An optional caller-supplied named token counter and token limit can additionally constrain the exact rendered string; without that counter, token count is explicitly `null`. Bytes are not tokens. A future provider adapter must count the full request including instructions, tool schemas and output allowance before sending it.

Each assembly returns an immutable packet with a content-derived ID; identical rendering, identity and counting configuration may reproduce the same ID. Creating a packet is preparation, not proof of delivery: a future model runtime records which packet was actually sent. Inspection reports may say “assembled,” never “model reviewed.”

## Proposed operational defaults

These are initial implementation decisions, not performance claims. Each library owns its limits; overrides must be positive safe integers and may only lower defaults. Do not create a shared configuration package.

- `pr-review/src/limits.ts` owns `PullRequestLimits`, with `httpTimeoutMs: 30_000` and `maxHttpBytes: 2_097_152`, plus `defaultPullRequestLimits` and `resolvePullRequestLimits`. Its `ResolvePullRequestOptions` contains `signal`, these `limits` and an optional `token`. HTTP work obeys both the caller signal and the request timeout through body consumption.
- `git-source/src/limits.ts` owns `GitLimits`: `acquisitionTimeoutMs: 300_000`, `gitTimeoutMs: 30_000`, `maxGitOutputBytes: 16_777_216` and `maxBlobBytes: 2_097_152`. It exports `defaultGitLimits`, `resolveGitLimits` and `GitOperationOptions` containing `signal` and these `limits`.
- Starting in Task 4, `review-evidence/src/limits.ts` owns `EvidenceLimits`: `maxToolBytes: 16_384` and `maxPageEntries: 100`, with `defaultEvidenceLimits` and `resolveEvidenceLimits`. `EvidenceOperationOptions` in Task 3 contains only `signal` and explicitly named `gitLimits`; Task 4 adds these tool `limits`; forwarding Git limits to its concrete Git dependency does not expose them to context-engine.
- `context-engine/src/limits.ts` owns `ContextLimits: { maxContextBytes: number; maxRetainedBytes: number }`, defaulting to `65_536` rendered bytes and `4_194_304` retained bytes, with `defaultContextLimits` and `resolveContextLimits`. Token counting remains an optional per-assembly input. Context construction needs neither an acquisition signal nor Git options.
- The CLI owns the deadline spanning PR resolution and snapshot acquisition. It starts one 300,000 ms deadline before metadata resolution and passes the combined deadline/user-cancellation signal to both I/O libraries. Git-source additionally bounds standalone acquisition by its own limit. Subsequent inspection uses user cancellation and operation limits, not the completed acquisition phase's deadline.

| Limit                                          | Value                        |
| ---------------------------------------------- | ---------------------------- |
| Overall acquisition deadline                   | 300,000 ms                   |
| HTTP metadata request deadline / response      | 30,000 ms / 2,097,152 bytes  |
| Local Git operation deadline / captured output | 30,000 ms / 16,777,216 bytes |
| One readable blob                              | 2,097,152 bytes              |
| One tool response, including metadata          | 16,384 UTF-8 bytes           |
| List/search page maximum                       | 100 entries                  |
| Retained evidence ledger, serialized JSON      | 4,194,304 bytes              |
| One assembled context string                   | 65,536 UTF-8 bytes           |

Fetch processes use the acquisition deadline, not the local-operation deadline. All I/O operations also accept an `AbortSignal`; context retention and byte assembly perform no I/O. When a cap prevents completeness, return a declared partial result or an explicit limit error; never report complete review coverage. Network transfer/disk use remain a single-run resource concern; a shared/multi-tenant service needs separate quotas before deployment.

## Inspectable command and artifacts

Add:

    bun run cli -- context inspect --pr https://github.com/OWNER/REPO/pull/NUMBER --output NEW_DIRECTORY

The command composes all four public APIs: resolve PR metadata through pr-review, map it into git-source comparison input, acquire a snapshot, and create a borrowing review-evidence session. Construct context-engine from the evidence-session identity. Execute retrieval through review-evidence, explicitly record successful results in context-engine, and assemble supplied evidence in stable inventory order. The host closes the Git snapshot in `finally`, including when evidence-session creation or assembly fails. PR-specific metadata can be recorded in the CLI run report; context identity and source evidence contain no PR reference or authentication data. Admit whole inspection pages up to 65,536 UTF-8 source-text bytes. Reject a crossing page without recording or rewriting it, mark its change unfinished, and stop further inspection; already fetched bytes are outside this admission accounting. Report inventory completeness, each known change's inspection status and packet omissions separately; this policy is a transparent demonstration, not relevance ranking.

Output directory must be newly created with owner-only permissions. Persist `context.json` (format `daphne-context-v1`) and `run.json` (format `daphne-context-run-v1`) using exclusive temporary files and atomic hard-link publication without replacing destinations, followed by removal of temporary links. No overwrites, credentials or hidden model reasoning. `run.json` records stages, counts, timings, limitations and errors; it must not claim semantic coverage.

Stdout contains one JSON summary with session ID, pinned commits, changed-file count, included/omitted evidence counts, limitations and artifact paths. Diagnostics go to stderr. A completed bounded inspection without packet omissions exits 0; a partial inspection or packet omission exits 2 with artifacts; invalid input, cancellation, acquisition/operation/cleanup/output failure exits 1; a failure after output-directory creation retains `run.json`.

Retain the current no-argument CLI bootstrap behavior so the existing smoke check is not rewritten as part of this slice. Unknown commands return a nonzero status. Cancellation closes processes, writes a stopped run where possible and cleans only this run's temporary repository.

## Validation and mentoring

No new automated tests or fixtures. Keep the existing suite and strict checks. Each task has a reproducible manual demonstration with expected output, plus source inspection of the affected trust boundaries. Do not create a hidden assertion harness to work around the user's no-test instruction.

Task 1 demonstrates live metadata resolution independently through pr-review. Use an accessible public PR and its exact remote commits for acquisition and later source-retrieval demonstrations. Prefer existing examples covering rename, deletion, Unicode and CRLF; compare returned data with ordinary Git and report any cases unavailable in those examples rather than creating an unsupported local-input API. Confirm the allowed import graph holds and supplied evidence can still be assembled after Git cleanup without invoking retrieval. No model key, paid call, or GitHub write is needed.

Compilation and existing tests do not cover these new semantics. Keep that limitation visible in the implementation closeout. Do not call this release production-validated; the architectural foundations are the goal of this iteration.

For each task discuss one concept: trust boundaries, immutable snapshots, byte coordinates, bounded tools, evidence versus model context, and composition. Record the decision and a concrete observed result in the walkthrough.

## Research and domain references

- [Anthropic: context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents): bounded context and on-demand retrieval; not a reason to build a new index.
- [Anthropic: tool design](https://www.anthropic.com/engineering/writing-tools-for-agents): clear tool boundaries, useful errors and response limits.
- [OpenHands condenser](https://docs.openhands.dev/sdk/guides/context-condenser): retained state and the model-visible projection have different lifecycles.
- [GitHub PR endpoints](https://docs.github.com/en/rest/pulls/pulls): identity acquisition; API patch listings have limits and do not replace committed source.
- [Git grep](https://git-scm.com/docs/git-grep) and [Git diff options](https://git-scm.com/docs/diff-options): snapshot reads and external-helper controls.
- [Anthropic containment](https://www.anthropic.com/engineering/how-we-contain-claude): tools must enforce permissions outside model judgment.
- Rust domain boundary references: `/Users/pietroputelli/Desktop/daphne/docs/architecture/rci-design.md`, `docs/architecture/pcg-design.md` and `crates/pcg/README.md` in that repository. Their ownership contracts guide future integration; this plan does not port or validate those implementations.

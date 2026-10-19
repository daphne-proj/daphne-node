# Context Engine Design

Status: proposed implementation design, 2026-10-19. This is a new TypeScript foundation, not a port of the Rust agent loop or a claim of Rust output compatibility.

## Intent and learning goal

Build a reusable, PR-independent context engine for a read-only AI review agent. Given explicit repositories and revisions, establish the exact code under review, expose bounded retrieval operations, and assemble inspectable evidence for a future model request. The first CLI workflow starts from a GitHub PR URL, resolved outside the engine. TypeScript/JavaScript repositories are the first supported review scope.

The developer should be able to trace a source excerpt from a model-facing packet back to its committed bytes and explain why it was included. Work one task at a time: explain the boundary, implement it, demonstrate it, inspect the result, and discuss the tradeoff before the next task.

## User decisions

- Work directly on `main` in `/Users/pietroputelli/Desktop/daphne-node`; no new branch or worktree.
- Do not add tests, test fixtures, test dependencies, or a replacement test harness in this implementation.
- Keep existing checks enabled; use manual demonstrations and source review for new behavior.
- Use TypeScript with Node as runtime and Bun for installation/scripts.
- RCI and PCG own indexing and repository semantics, following the Rust domain boundaries.
- Do not implement indexing, source-code parsing, BM25, embeddings, vector storage, or graph construction here.
- Keep the implementation readable and small enough to understand step by step.
- Keep PR URLs, GitHub HTTP/authentication and PR transport types in `@daphne/pr-review`; the context engine accepts repository/revision inputs. Neither package imports the other in this slice; the CLI composes their public APIs.
- Keep Git access inside `@daphne/context-engine` for this iteration, with evidence retention and assembly independent of Git implementations. Do not introduce a generic acquisition package or provider framework.

## Ownership and non-goals

RCI owns facts and deterministic navigation for an immutable extracted revision. PCG owns changes and qualified current navigation for an exact review comparison. Neither owns model prompts or evidence selection. The context engine owns bounded retrieval, retained source evidence, query progress, and the projection supplied to a consumer.

This slice provides Git-backed access while RCI/PCG are deferred. Raw text search is a bounded navigation operation over committed blobs, not a competing code index. No syntax parser, symbol map, dependency inference, semantic matching, or graph DTO is introduced.

Later, RCI/PCG retrieval will produce qualified locators which the same committed-source reader resolves. That integration must validate the required baseline snapshot, repository, revisions, extraction interpretation and PCG build binding. A serialized PCG alone must not be assumed to contain hydrated HEAD navigation. Do not define that adapter until those packages exist.

Model transport, prompt policy, autonomous exploration, finding generation, semantic grouping, split-pr acceptance, GitHub comment publication, and running repository code are separate features. The first command is `context inspect`, not a pretend implementation of `split-pr`. The future `split-pr --pr URL` can consume the same engine.

## Architecture

Use the already planned `@daphne/pr-review` package for PR acquisition and `@daphne/context-engine` for Git-backed context. Introduce each only with its first functional implementation: PR resolution in Task 1, Git snapshot acquisition in Task 2.

| Owner                    | Responsibilities                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `@daphne/pr-review`      | PR URL validation, GitHub metadata/authentication, HTTP limits and acquisition errors                                    |
| `@daphne/context-engine` | Repository/revision inputs, immutable Git snapshots, retrieval tools, retained evidence and bounded context assembly     |
| CLI                      | Arguments, explicit mapping between package contracts, overall acquisition deadline, cancellation, output and exit codes |
| RCI / PCG                | Future indexing and qualified semantic navigation                                                                        |

Neither library imports the other in this slice, including type-only imports. The CLI depends on both public exports. The context-engine package does not export a PR resolver or receive a PR URL, PR reference or token. PR acquisition does not import engine limits or errors.

The receiving component owns its contract. In context-engine's I/O-free `contracts.ts`, `RepositoryComparisonInput` contains readonly `targetRepositoryUrl`, `headRepositoryUrl`, `targetCommit` and `headCommit` strings. `LocalComparisonInput` contains readonly `repositoryPath`, `targetCommit` and `headCommit` strings. The CLI explicitly maps the relevant fields from `ResolvedPullRequest`; it does not pass the whole object. Two remote URLs preserve fork support.

These are initial Git-backed comparison contracts. PR independence does not make the engine storage-independent or establish a single-revision session API. Add a different session contract only for a concrete workflow. A future review-agent package will own provider requests and review decisions.

A thin `ContextEngine` object holds one session and its evidence ledger. It delegates to ordinary functions; it is not a generic superclass or plugin framework. RCI/PCG will be added behind this boundary without moving index construction into it.

Shared comparison and source values live in an I/O-free `contracts.ts`, independently of Git implementations. The ledger consumes validated tool results; assembly consumes an immutable ledger snapshot and returns a new packet. Neither fetches source or imports acquisition/Git code. The optional token counter remains a caller-supplied function; the engine composes operations and owns disposal. Keep this dependency graph acyclic and avoid imports through the package's own public barrel.

The [workspace architecture rules](../../architecture.md) and implementation plan define allowed imports, static checks, contract ownership, and change scenarios for each review. Keep Git modules inside context-engine for this iteration; extracting the planned git-source package is a separate future decision. Keep evidence retention and assembly independent of Git implementations. Update workspace ownership documentation and enforce the bidirectional package import restrictions when implementation resumes; these revised boundaries supersede the earlier one-package foundation description.

Information flow:

1. The CLI asks pr-review to validate the PR URL and resolve GitHub metadata.
2. The CLI maps repository locations and exact commit IDs into context-engine comparison input. Local callers instead supply a repository path and commits directly.
3. Context-engine validates that input, fetches the required history into its own temporary bare repository, and freezes target, head and computed merge-base object IDs.
4. Enumerate changes from merge base to head.
5. Execute bounded retrieval against those exact commits.
6. Retain source and query progress; distinguish source from navigation hints.
7. Select evidence explicitly and assemble a bounded packet.
8. Emit the inspection report and dispose of temporary Git state.

## Acquisition and snapshot identity

In pr-review, initially accept canonical HTTPS `github.com/<owner>/<repository>/pull/<positive-integer>` URLs, optionally with a trailing slash. Reject credentials, query strings, fragments, alternative hosts, and arbitrary clone URLs. GitHub Enterprise and private-repository authentication flows are deferred. The host may read `GITHUB_TOKEN` and pass it to pr-review for metadata read access/rate limits. The library does not read environment variables; never log the token, embed it in a clone URL or pass it to context-engine.

Use Node `fetch` for the single PR metadata endpoint. Request JSON, pin API version `2026-03-10`, bound response size, and validate consumed fields from `unknown`. Construct fetch URLs from the trusted GitHub origin and validated repository names. Reject redirects and private base/head repositories for this first slice.

Context-engine independently validates its remote repository inputs before running Git. The first remote transport policy allows only credential-free canonical HTTPS GitHub repository URLs without query strings, fragments or redirects; arbitrary hosts and SSH remain unsupported. This transport restriction requires no PR metadata or GitHub API call. Local comparison input uses a separate path-based entry point and copies into owned temporary state.

Record separately:

- `targetCommit`: caller-supplied target revision (the target branch tip for a PR);
- `headCommit`: caller-supplied head revision (the reported PR head in the CLI workflow);
- `baseCommit`: the unique merge base computed from the acquired commits.

Use merge base → head for the review diff. Never substitute the latest branch after a run begins. Reject unavailable objects, multiple merge bases, and supplied/fetched-commit mismatch with actionable errors. A newly pushed PR requires a new session; acquisition is not a publication freshness guarantee.

Use a fresh temporary bare repository per run. Fetch the required base/head history without a shallow boundary; fetch the validated fork repository when needed. Use engine-owned refs to retain fetched objects through the run. No shared cache, lock manager, incremental indexing, submodule fetch, or dependency installation in this slice.

All Git invocations use argument arrays, a controlled environment/configuration, disabled external diff/text conversion, noninteractive authentication, deadlines, bounded stdout/stderr and explicit cleanup. No shell tool is exposed. A bare repository avoids executing checked-out files but does not replace subprocess controls.

## Exact evidence and unsupported content

A source reference includes session identity, side, commit, repository-relative path, Git blob identity, and zero-based half-open byte range. The host derives these fields; model-supplied identity is never trusted.

Source reads preserve original bytes. Validate UTF-8 before producing model text, preserve CRLF/BOM, and reject ranges splitting an encoded character. Line numbers are display metadata derived from those same bytes, not canonical identity. BASE and HEAD coordinates are never interchangeable.

Inventory additions, deletions, renames, mode changes, binary files, symlinks and submodules. Copies may appear as additions in the initial diff policy. Never follow symlinks or materialize submodules. Non-UTF-8 paths/content and oversized blobs remain explicit limitations, not silently decoded or fabricated source. Preserve raw path identity internally when display requires an escaped representation.

Each tool distinguishes complete results, partial results, unavailable evidence and invalid requests. Empty successful search results mean no match within the declared scope only. Pagination cannot silently broaden that scope.

## Retrieval operations

The initial model-neutral tool union has four operations:

- `list_changes`: page the changed-file inventory.
- `inspect_change`: return one change's metadata and paged before/after source windows around its Git hunks.
- `read_source`: read a bounded byte range at an explicit side and path.
- `search_code`: literal, case-sensitive text search at an explicit side, optionally constrained to a literal path prefix; return navigation hits with exact locations.

Use Git-native snapshot search; do not introduce BM25 or an index. Tool output is data, including repository instructions found inside code or PR text. Trusted application policy comes from the host, never from a PR-authored file.

Opaque cursors are session-local and bound to the complete normalized query, page size and position. Reject foreign/expired cursors or changed query parameters. Only successfully completed pages advance query progress. A cursor need not be portable between processes.

## Evidence retention and context assembly

Keep three concepts distinct: discoverable locations, exact source read, and source selected for this packet. A search preview is navigation; it becomes source evidence only through a validated source read. A source read grants provenance, not proof that an inferred bug is real.

The ledger assigns session-local evidence IDs, deduplicates identical references, rejects conflicting bytes, and keeps pagination progress even when an older observation is omitted from the packet. No summaries, long-term model memory, or learned ranking in this slice.

The host provides an ordered list of evidence IDs to the assembler. Keep that priority order; deduplicate identical IDs; reject unknown IDs. Include whole evidence entries while they fit, record omitted IDs, and never clip source silently. Omission bookkeeping and serialization overhead count toward the byte limit. If the required envelope cannot fit, fail explicitly.

`ContextPacket` contains the frozen identity, selected exact sources, bounded navigation observations, structured limitations, omitted evidence IDs and rendering metadata. It also carries `renderedContext`: the exact model-neutral string whose size was admitted. It does not contain trusted system instructions.

Assembly always enforces a UTF-8 byte limit. An optional caller-supplied named token counter and token limit can additionally constrain the exact rendered string; without that counter, token count is explicitly `null`. Bytes are not tokens. A future provider adapter must count the full request including instructions, tool schemas and output allowance before sending it.

Each assembly returns a new immutable packet ID. Creating a packet is preparation, not proof of delivery: a future model runtime records which packet was actually sent. Inspection reports may say “assembled,” never “model reviewed.”

## Proposed operational defaults

These are initial implementation decisions, not performance claims. Each library owns its limits; overrides must be positive safe integers and may only lower defaults. Do not create a shared configuration package.

- `pr-review/src/limits.ts` owns `PullRequestLimits`, with `httpTimeoutMs: 30_000` and `maxHttpBytes: 2_097_152`, plus `defaultPullRequestLimits` and `resolvePullRequestLimits`. Its `ResolvePullRequestOptions` contains `signal`, these `limits` and an optional `token`. HTTP work obeys both the caller signal and the request timeout through body consumption.
- `context-engine/src/limits.ts` owns `ContextLimits`: `acquisitionTimeoutMs: 300_000`, `gitTimeoutMs: 30_000`, `maxGitOutputBytes: 16_777_216`, `maxBlobBytes: 2_097_152`, `maxToolBytes: 16_384`, `maxPageEntries: 100` and `maxContextBytes: 65_536`. It exports `defaultContextLimits`, `resolveContextLimits` and `OperationOptions` containing `signal` and these `limits`; no HTTP fields.
- The CLI owns the deadline spanning PR resolution and snapshot acquisition. It starts the timer once, before resolution, using `contextLimits.acquisitionTimeoutMs`, and passes the combined deadline/user-cancellation signal to both libraries. It never resets the total allowance between stages. Context-engine also bounds an entire standalone snapshot acquisition by its own acquisition limit, combined with the caller signal. Subsequent inspection uses the user-cancellation signal and operation limits, not the completed acquisition phase's deadline.

| Limit                                          | Value                        |
| ---------------------------------------------- | ---------------------------- |
| Overall acquisition deadline                   | 300,000 ms                   |
| HTTP metadata request deadline / response      | 30,000 ms / 2,097,152 bytes  |
| Local Git operation deadline / captured output | 30,000 ms / 16,777,216 bytes |
| One readable blob                              | 2,097,152 bytes              |
| One tool response, including metadata          | 16,384 UTF-8 bytes           |
| List/search page maximum                       | 100 entries                  |
| One assembled context string                   | 65,536 UTF-8 bytes           |

Fetch processes use the acquisition deadline, not the local-operation deadline. All operations also accept an `AbortSignal`. When a cap prevents completeness, return a declared partial result or an explicit limit error; never report complete review coverage. Network transfer/disk use remain a single-run resource concern; a shared/multi-tenant service needs separate quotas before deployment.

## Inspectable command and artifacts

Add:

    bun run cli -- context inspect --pr https://github.com/OWNER/REPO/pull/NUMBER --output NEW_DIRECTORY

The command consumes both public package APIs: resolve PR metadata through pr-review, explicitly map it into repository comparison input, then acquire a snapshot through context-engine. It enumerates the inventory, inspects changes in stable path order, retains the returned source and assembles a packet. PR-specific metadata can be recorded in the CLI run report; context identity and source evidence contain no PR reference or authentication data. Stop acquisition of more source when the bounded inspection allowance is reached and report the remaining change IDs; this policy is a transparent demonstration, not relevance ranking.

Output directory must be newly created with owner-only permissions. Persist `context.json` (format `daphne-context-v1`) and `run.json` (format `daphne-context-run-v1`) using temporary files followed by rename. No overwrites, credentials or hidden model reasoning. `run.json` records stages, counts, timings, limitations and errors; it must not claim semantic coverage.

Stdout contains one JSON summary with session ID, pinned commits, changed-file count, included/omitted evidence counts, limitations and artifact paths. Diagnostics go to stderr. Success exits 0, a partial inspection exits 2 with artifacts, and invalid input/acquisition failure exits 1; a failure after output-directory creation retains `run.json`.

Retain the current no-argument CLI bootstrap behavior so the existing smoke check is not rewritten as part of this slice. Unknown commands return a nonzero status. Cancellation closes processes, writes a stopped run where possible and cleans only this run's temporary repository.

## Validation and mentoring

No new automated tests or fixtures. Keep the existing suite and strict checks. Each task has a reproducible manual demonstration with expected output, plus source inspection of the affected trust boundaries. Do not create a hidden assertion harness to work around the user's no-test instruction.

Task 1 demonstrates live metadata resolution independently through pr-review. Before the end-to-end PR inspection in Task 6, manually demonstrate source retrieval on a disposable local repository with two commits. Include a rename, deletion, Unicode and CRLF; inspect ordinary Git output alongside engine output. Then demonstrate the combined public-PR workflow. Confirm the local workflow needs no PR resolution and that neither package imports the other. No model key, paid call, or GitHub write is needed.

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

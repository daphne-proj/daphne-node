# Workspace architecture

## Current implementation

`apps/cli` provides PR commands; `apps/eval` provides a synthetic Langfuse smoke command. The CLI's no-argument entry point preserves the setup response; `context inspect` composes the four implemented libraries. The compiled-process test exercises ESM output on Node from outside the repository directory. `packages/pr-review` now provides public GitHub PR URL parsing and bounded metadata resolution. `packages/git-source` provides immutable Git snapshots, deterministic change inventories and exact blob reads. `packages/review-evidence` now materializes validated source excerpts and exposes bounded repository tools through a borrowing session. `packages/context-engine` retains supplied evidence and assembles bounded packets without loading retrieval or Git code. The `context inspect` CLI consumes their public exports, owns its diagnostic retrieval policy and Git cleanup, then assembles context after closing Git. `packages/semantic-split` owns the reusable split workflow and its policy/validation; `packages/review-agent` owns model calls and provider response handling. Remaining package names below reserve ownership, not working APIs.

The experimental `split-pr` command delegates to `splitPullRequest` from `@daphne/pr-review/split`. This reusable workflow owns PR metadata resolution, Git acquisition, inventory/hunk collection and cleanup, then supplies the evidence to `runSemanticSplit` from semantic-split, which calls `paginateDiffContext`. The existing pr-review root export remains metadata-only; the split entry point is separate so acquisition consumers do not load model orchestration. Context-engine owns packing and fragment splitting within the token and byte budgets; semantic-split supplies a callback that counts complete requests through review-agent’s OpenAI adapter. Git closes before paging and generation. Semantic-split derives expected IDs from the original Git inventory and checks emitted page IDs before generation. Semantic-split validates JSON, structure and exact unit coverage independently of model claims, and owns the prompts and proposal schema. One page goes directly to whole-hunk grouping; multiple pages use separate string-input analyses followed by grouping from their notes. The prompt prioritizes independently reviewable responsibilities and required dependencies over topical similarity.

Semantic-split owns one local grouping history and a bounded generate/validate/correct loop: at most three corrections after the first reply, with success allowed on generation four and failure after four invalid replies. Every replacement is revalidated against the same inventory. Corrections retain complete provider output items and append diagnostics plus all original pages for missing/duplicated known IDs that have not already been supplied as raw evidence. Page order and every fragment are preserved. The adapter uses `store: false` and exposes validated reasoning/message items, retaining encrypted reasoning and assistant metadata. Every turn checks its full serialized history against 64 KiB and counts the exact message array, instructions, reasoning settings and schema against the token limit; only an identical first single-page request reuses the pager's count. Budgets can stop the loop early without truncation. Provider/refusal/incomplete/count/timeout/cancellation failures stop immediately, with no transport retries. Page analyses and counts are separate from the grouping-generation limit. Review-agent exports the concrete `createOpenAI` adapter, `ModelRequest`, `ModelReply` and `ModelError`. It owns counting, generation, provider deadlines, request counters and validation of replayable provider output; it has no workspace dependencies or split decisions. No generic provider or session framework is introduced.

`runSemanticSplit(input, options)` is exported by `@daphne/semantic-split` and takes supplied identity, changes and hunks plus explicit API key, model, input-token limit and cancellation signal. It returns a discriminated complete/failed result with pages, analyses, completed attempts and call counts in both cases. Failed results retain the original error and null accepted proposal/response. A synchronous optional page callback preserves CLI progress reporting; a callback failure also returns collected work. The caller must keep input evidence stable until the operation completes. The operation owns no Git resources, environment loading, filesystem output or process state. It checks cancellation before work and before accepting success, including empty inventories and completed replies. `splitPullRequest` owns Git lifetime and retains both retrieval and cleanup errors. The CLI maps these errors into its existing artifact contract and owns local finalization. Shared CLI errors live in `apps/cli/src/errors.ts`; `context.ts` implements only the separate `context inspect` command and its inspection policy.

The `daphne-split-pr-v3` artifact adds `maxCorrections: 3` and ordered `attempts` with generation number, input token count, answer text, raw response and validation result. Completed replies are recorded before any later asynchronous work can fail; failed provider calls do not create completed attempts. Page analyses retain their `{ text, response }` shape, with output items under `response.output`. Only a valid final result populates top-level `proposal`/`response` and yields exit 0; failures yield exit 1 while preserving collected evidence, analyses and attempts through finalization. An uncancelled empty inventory requires no generation. Artifacts do not provide durable checkpoints or crash resume. Coverage validation does not establish semantic correctness, independent patch applicability or Rust semantic-split parity.

`apps/eval` owns the Langfuse client, OpenTelemetry provider, explicit configuration, process cancellation and experiment completeness checks. Its `langfuse-smoke` command sends two synthetic arithmetic cases through the native SDK and verifies identities, scores and finalization. One provider spans all experiments in a command; success is printed after cleanup. SDK diagnostic capture detects logged export errors that do not reject flush promises. This app owns its telemetry process and must not share another provider's lifecycle. No library imports Langfuse, and normal checks stay offline. Domain evaluation and Rust evaluation parity remain future work.

Bun handles installation and scripts. Node 24 is the production runtime. TypeScript compiles with NodeNext modules; `tsc -b` manages dependency order. Tests use Vitest on Node. Libraries export compiled JavaScript and declarations, with no package-private source imports.

## Target ownership

| Location                         | Responsibility / Rust reference                                 |
| -------------------------------- | --------------------------------------------------------------- |
| `apps/cli`                       | User command composition and process exit behavior              |
| `apps/eval`                      | Evaluation suites, trials, grading, and reports                 |
| `packages/context-engine`        | Supplied-evidence retention and bounded packet assembly         |
| `packages/domain`                | Shared domain values, identities, serialized contracts          |
| `packages/git-source`            | Git snapshots, revision comparison and exact blob access        |
| `packages/review-evidence`       | Exact evidence, bounded repository tools and borrowing sessions |
| `packages/tree-sitter-extractor` | Syntax extraction and byte/position boundaries                  |
| `packages/scip-extractor`        | SCIP data decoding and semantic extraction                      |
| `packages/revision-extractor`    | Normalized extraction and coverage                              |
| `packages/rci`                   | Revision code index                                             |
| `packages/pcg`                   | Graph model and validation                                      |
| `packages/pcg-builder`           | Graph construction                                              |
| `packages/lifecycle`             | Review/revision state and promotion                             |
| `packages/semantic-split`        | Semantic grouping workflow, validation and investigation state  |
| `packages/review-agent`          | Model calls and provider adapters                               |
| `packages/pr-review`             | Pull-request acquisition and review orchestration               |
| `packages/integration-tests`     | Cross-package scenarios once multiple implementations exist     |

This is a future ownership map, not a requirement to create all these packages. For Rust migrations, derive import edges from the source dependency graph. The new context foundation follows the acquisition/evidence/context split below; Git access belongs to git-source. Domain contracts must not depend on apps, provider SDKs, Git subprocesses, or extraction runtimes. Apps compose libraries; libraries never import apps. IO lives at adapter boundaries. Avoid introducing a generic shared package that bypasses ownership.

Use ordinary packages and explicit build references first. Add a build orchestrator, package publishing, web framework, service container, or cache only for a measured need. Native parser/protobuf/model dependencies are selected during their migration, when compatibility tests exist.

## Module design rules

Use the `codebase-design` skill when defining or changing a module contract. A contract includes the values callers pass and receive, invariants, failure behavior, ordering, and resource ownership. Keep public surfaces small; keep implementation details with the module that owns them. Internal modules need not become separate packages.

- Compose ordinary functions and focused objects. Introduce a replaceable dependency only for a concrete external boundary or actual variation; no generic engine superclass, service container, or interface for every function.
- Domain values and context decisions remain independent of GitHub transport, subprocesses, CLI output, and model providers. Validate external values in their adapter before passing them inward.
- Shared evidence contracts belong outside Git implementation files. Retention owns its ledger; assembly consumes an immutable ledger snapshot and returns a new packet. Assembly does not fetch missing evidence.
- The composition layer connects operations and owns cleanup; it delegates retrieval and selection algorithms. Keep error, cancellation, and disposal behavior explicit in its contract.
- Apps consume public package exports. Libraries never import apps. Internal files use direct relative imports rather than their own public barrel. Keep the dependency graph acyclic and avoid cross-package relative imports.
- Record significant decisions with the problem, alternatives, choice, consequences, and a condition for revisiting the choice. Reuse `docs/adr/`; do not create an ADR for every helper.

ESLint rejects static imports into workspace `src`/`dist` internals and app imports from libraries. PR acquisition files and their metadata-only root export cannot import Git, evidence, context or model workflow modules, including type-only imports and package subpaths. Git-source cannot import PR, evidence, context or model workflow packages. The explicit pr-review split entry point composes these packages without creating a reverse dependency; [ADR 0003](adr/0003-reusable-pr-split-workflow.md) records this extension to ADR 0002. Review-evidence contracts reject all imports, and retrieval code routes repository I/O through git-source. Git data contracts and limits reject filesystem/process/network imports and direct `fetch`, `process` or `console` usage. Context-engine permits only type imports from the dedicated evidence contracts export; runtime retrieval, Git and filesystem/process/network imports are rejected. Semantic-split’s proposal, prompt and schema modules retain the pure evidence-contract import rules and cannot load the workflow. Its workflow may import context-engine, review-agent and evidence-contract types, with direct Git, retrieval, filesystem/process/network I/O forbidden. Review-agent cannot import other workspaces, filesystem/process modules or use process/console globals; its provider adapter owns HTTP. These rules supplement review: dynamic/global access, aliases and dependency cycles still need inspection.

## PR acquisition, Git source and reusable context

The [boundary decision](adr/0002-context-engine-boundary.md) explains the package split; the [walkthrough](context-engine-walkthrough.md) traces the implemented workflow and its verification.

- `@daphne/pr-review` owns PR URL parsing, GitHub HTTP/authentication, metadata validation and HTTP limits/errors. Its separate `@daphne/pr-review/split` entry point owns the complete PR-to-split application workflow.
- `@daphne/git-source` owns repository/revision inputs, immutable snapshots, subprocess controls, Git limits/errors and change inventory. Tasks 2–4 provide this behavior, exact source reads and bounded matching-file search.
- `@daphne/review-evidence` now owns source materialization through a borrowing Git session. Bounded tools and pagination are implemented; qualified RCI/PCG navigation remains later work. Its dedicated contracts export contains only I/O-free data types, without Git imports. Session options contain cancellation, Git limits and separate evidence response/page limits. Retryable authenticated cursors keep bounded continuation state outside context-engine.
- `@daphne/context-engine` retains supplied evidence, assembles packets and owns diff packing and fragment splitting. It receives evidence identity/data, never a Git snapshot, acquisition inputs or retrieval callback. It imports only evidence-contract types and performs no source retrieval or repository cleanup.
- The CLI now composes these packages in `context inspect`: it explicitly maps PR metadata to Git input, admits whole inspection pages under a 64 KiB source allowance and closes the snapshot in `finally` before assembly. It reports inventory, per-change progress and packet omissions separately. Future agent orchestration can replace this host policy without changing library ownership.

Each library owns its configuration. Git-source has acquisition/operation/output/blob limits; evidence retrieval has page/response limits; context has separate retained-data and packet limits (4 MiB and 64 KiB by default). No shared options base class or provider framework.

The current Git adapter supports complete SHA-1 repositories on macOS/Linux, public canonical HTTPS GitHub origins. It rejects unsupported input explicitly. Those restrictions apply to Git access, not to packet assembly. Both review-evidence and context-engine are working packages. The latter retains plain provenance data without depending on Git resource lifetime.

RCI/PCG retain indexing and qualified navigation ownership. Model requests and review/grouping policy remain outside these packages. Source identity is preserved through data contracts, not resource ownership. See the [walkthrough](context-engine-walkthrough.md) for reading order and observed checks.

Architecture review asks:

1. Does changing repository acquisition leave context retention and assembly unchanged?
2. Can supplied evidence be assembled after the Git snapshot is closed?
3. Does packet rendering leave Git access unchanged?
4. Does future RCI/PCG navigation belong to review-evidence without moving index construction into context-engine?

The second scenario was demonstrated in Task 5: retained source and recorded pages assembled after Git cleanup, including standalone assembly from a JSON-roundtripped snapshot.

References: [ports and adapters](https://alistair.cockburn.us/hexagonal-architecture/), [Node package exports](https://nodejs.org/api/packages.html#package-entry-points), [ESLint import restrictions](https://eslint.org/docs/latest/rules/no-restricted-imports).

# Workspace architecture

## Current implementation

`apps/cli` is the only executable workspace. Its no-argument entry point preserves the setup response; `context inspect` composes the four implemented libraries. The compiled-process test exercises ESM output on Node from outside the repository directory. `packages/pr-review` now provides public GitHub PR URL parsing and bounded metadata resolution. `packages/git-source` provides immutable Git snapshots, deterministic change inventories and exact blob reads. `packages/review-evidence` now materializes validated source excerpts and exposes bounded repository tools through a borrowing session. `packages/context-engine` retains supplied evidence and assembles bounded packets without loading retrieval or Git code. The CLI consumes their public exports, owns retrieval policy and Git cleanup, then assembles context after closing Git. Other package names below reserve ownership, not working APIs.

The experimental `split-pr` command collects exact hunks through review-evidence, then supplies them together to `paginateDiffContext`. Context-engine owns packing and fragment splitting within the token and byte budgets; the CLI supplies a callback that counts complete requests through OpenAI. One page goes directly to whole-hunk grouping; multiple pages use separate string-input analyses followed by grouping from their notes. Grouping uses an item-array input whose exact message representation, instructions, reasoning settings and schema are also counted by the pager. The CLI checks serialized grouping input against a 64 KiB ceiling, including wrappers and JSON escaping, even when raw evidence pages fit. The local provider adapter preserves complete validated reasoning/message output items for manual continuation, with `store: false`; the command still makes only one grouping attempt, without correction turns. Page analyses retain their `{ text, response }` artifact shape, with output items already present under `response.output`. The prompt prioritizes independently reviewable responsibilities and required dependencies over topical similarity. Its single provider adapter and orchestration remain local to the CLI; no provider framework or additional package is introduced. Git closes before paging and generation. A versioned local JSON artifact retains collected hunks, pages, responses, request counts and the proposal, including partial evidence and completed analyses when a later operation fails. This command does not establish Rust semantic-split parity.

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
| `packages/semantic-split`        | Semantic grouping and investigation state                       |
| `packages/review-agent`          | Model orchestration and provider adapters                       |
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

ESLint rejects static imports into workspace `src`/`dist` internals and app imports from libraries. PR acquisition and git-source cannot import each other or downstream review-evidence/context-engine, including type-only imports and package subpaths. Review-evidence contracts reject all imports, and retrieval code routes repository I/O through git-source. Git data contracts and limits reject filesystem/process/network imports and direct `fetch`, `process` or `console` usage. Context-engine permits only type imports from the dedicated evidence contracts export; runtime retrieval, Git and filesystem/process/network imports are rejected. These rules supplement review: dynamic/global access, aliases and dependency cycles still need inspection.

## PR acquisition, Git source and reusable context

The [boundary decision](adr/0002-context-engine-boundary.md) explains the package split; the [walkthrough](context-engine-walkthrough.md) traces the implemented workflow and its verification.

- `@daphne/pr-review` owns PR URL parsing, GitHub HTTP/authentication, metadata validation and HTTP limits/errors. Task 1 is implemented.
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

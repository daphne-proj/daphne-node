# Workspace architecture

## Current implementation

`apps/cli` is the only executable workspace. Its entry point reports that setup is ready. The compiled-process test exercises ESM output on Node from outside the repository directory. `packages/pr-review` now provides public GitHub PR URL parsing and bounded metadata resolution. `packages/git-source` provides immutable Git snapshots and deterministic change inventories. The CLI does not consume these libraries yet. Other package names below reserve ownership, not working APIs.

Bun handles installation and scripts. Node 24 is the production runtime. TypeScript compiles with NodeNext modules; `tsc -b` manages dependency order. Tests use Vitest on Node. Libraries export compiled JavaScript and declarations, with no package-private source imports.

## Target ownership

| Location                         | Responsibility / Rust reference                                  |
| -------------------------------- | ---------------------------------------------------------------- |
| `apps/cli`                       | User command composition and process exit behavior               |
| `apps/eval`                      | Evaluation suites, trials, grading, and reports                  |
| `packages/context-engine`        | Planned supplied-evidence retention and packet assembly          |
| `packages/domain`                | Shared domain values, identities, serialized contracts           |
| `packages/git-source`            | Git snapshots and revision comparison; exact source access later |
| `packages/review-evidence`       | Evidence/session contracts and correspondence                    |
| `packages/tree-sitter-extractor` | Syntax extraction and byte/position boundaries                   |
| `packages/scip-extractor`        | SCIP data decoding and semantic extraction                       |
| `packages/revision-extractor`    | Normalized extraction and coverage                               |
| `packages/rci`                   | Revision code index                                              |
| `packages/pcg`                   | Graph model and validation                                       |
| `packages/pcg-builder`           | Graph construction                                               |
| `packages/lifecycle`             | Review/revision state and promotion                              |
| `packages/semantic-split`        | Semantic grouping and investigation state                        |
| `packages/review-agent`          | Model orchestration and provider adapters                        |
| `packages/pr-review`             | Pull-request acquisition and review orchestration                |
| `packages/integration-tests`     | Cross-package scenarios once multiple implementations exist      |

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

ESLint rejects static imports into workspace `src`/`dist` internals and app imports from libraries. PR acquisition and git-source cannot import each other or downstream review-evidence/context-engine, including type-only imports and package subpaths. Git data contracts and limits reject filesystem/process/network imports and direct `fetch`, `process` or `console` usage. Context-engine is reserved for I/O-free behavior; Task 5 will permit only type imports from the dedicated evidence contracts export when it exists. These rules supplement review: dynamic/global access, aliases and dependency cycles still need inspection.

## PR acquisition, Git source and reusable context

The [context-engine design](superpowers/specs/2026-10-19-context-engine-design.md), [implementation plan](superpowers/plans/2026-10-19-context-engine.md) and [ADR 0002](adr/0002-context-engine-boundary.md) define this slice.

- `@daphne/pr-review` owns PR URL parsing, GitHub HTTP/authentication, metadata validation and HTTP limits/errors. Task 1 is implemented.
- `@daphne/git-source` owns repository/revision inputs, immutable snapshots, subprocess controls, Git limits/errors and change inventory. Task 2 provides this behavior; exact source reads follow in Task 3.
- `@daphne/review-evidence` will own source materialization and bounded retrieval. It borrows a Git snapshot and later integrates qualified RCI/PCG navigation. Its dedicated contracts export will contain I/O-free data types without Git imports.
- `@daphne/context-engine` will retain supplied evidence and assemble packets. It receives evidence identity/data, never a Git snapshot, acquisition inputs or retrieval callback. It imports only evidence-contract types and performs no source retrieval or repository cleanup.
- The CLI/future agent host composes these packages, explicitly maps PR metadata to Git input, decides retrieval/selection policy and owns deadlines and snapshot cleanup in `finally`.

Each library owns its configuration. Git-source has acquisition/operation/output/blob limits; future evidence retrieval has page/response limits; future context assembly has packet limits. No shared options base class or provider framework.

The current Git adapter supports complete SHA-1 repositories on macOS/Linux, public canonical HTTPS GitHub origins or local repositories copied into owned state. It rejects unsupported input explicitly. Those restrictions apply to Git access, not to packet assembly. Neither review-evidence nor context-engine has a placeholder workspace.

RCI/PCG retain indexing and qualified navigation ownership. Model requests and review/grouping policy remain outside these packages. Source identity is preserved through data contracts, not resource ownership. See the [walkthrough](context-engine-walkthrough.md) for reading order and observed checks.

Architecture review asks:

1. Does changing repository acquisition leave context retention and assembly unchanged?
2. Can supplied evidence be assembled after the Git snapshot is closed?
3. Does packet rendering leave Git access unchanged?
4. Does future RCI/PCG navigation belong to review-evidence without moving index construction into context-engine?

The second scenario will be demonstrated when context-engine exists in Task 5; it is not an implemented capability yet.

References: [ports and adapters](https://alistair.cockburn.us/hexagonal-architecture/), [Node package exports](https://nodejs.org/api/packages.html#package-entry-points), [ESLint import restrictions](https://eslint.org/docs/latest/rules/no-restricted-imports).

# Workspace architecture

## Current implementation

`apps/cli` is the only executable workspace. Its entry point reports that setup is ready. The compiled-process test exercises ESM output on Node from outside the repository directory. Other package names below reserve ownership, not working APIs.

Bun handles installation and scripts. Node 24 is the production runtime. TypeScript compiles with NodeNext modules; `tsc -b` manages dependency order. Tests use Vitest on Node. Libraries will export compiled JavaScript and declarations, with no package-private source imports.

## Target ownership

| Location                         | Responsibility / Rust reference                             |
| -------------------------------- | ----------------------------------------------------------- |
| `apps/cli`                       | User command composition and process exit behavior          |
| `apps/eval`                      | Evaluation suites, trials, grading, and reports             |
| `packages/domain`                | Shared domain values, identities, serialized contracts      |
| `packages/git-source`            | Git access and revision comparison                          |
| `packages/review-evidence`       | Evidence/session contracts and correspondence               |
| `packages/tree-sitter-extractor` | Syntax extraction and byte/position boundaries              |
| `packages/scip-extractor`        | SCIP data decoding and semantic extraction                  |
| `packages/revision-extractor`    | Normalized extraction and coverage                          |
| `packages/rci`                   | Revision code index                                         |
| `packages/pcg`                   | Graph model and validation                                  |
| `packages/pcg-builder`           | Graph construction                                          |
| `packages/lifecycle`             | Review/revision state and promotion                         |
| `packages/semantic-split`        | Semantic grouping and investigation state                   |
| `packages/review-agent`          | Model orchestration and provider adapters                   |
| `packages/pr-review`             | Pull-request acquisition and review orchestration           |
| `packages/integration-tests`     | Cross-package scenarios once multiple implementations exist |

Preserve these ownership boundaries initially; actual import edges must be derived from the Rust dependency graph for each migration. Domain contracts must not depend on apps, provider SDKs, Git subprocesses, or extraction runtimes. Apps compose libraries; libraries never import apps. IO lives at adapter boundaries. Avoid introducing a generic shared package that bypasses ownership.

Use ordinary packages and explicit build references first. Add a build orchestrator, package publishing, web framework, service container, or cache only for a measured need. Native parser/protobuf/model dependencies are selected during their migration, when compatibility tests exist.

## Module design rules

Use the `codebase-design` skill when defining or changing a module contract. A contract includes the values callers pass and receive, invariants, failure behavior, ordering, and resource ownership. Keep public surfaces small; keep implementation details with the module that owns them. Internal modules need not become separate packages.

- Compose ordinary functions and focused objects. Introduce a replaceable dependency only for a concrete external boundary or actual variation; no generic engine superclass, service container, or interface for every function.
- Domain values and context decisions remain independent of GitHub transport, subprocesses, CLI output, and model providers. Validate external values in their adapter before passing them inward.
- Shared evidence contracts belong outside Git implementation files. Retention owns its ledger; assembly consumes an immutable snapshot and returns a new packet. Assembly does not fetch missing evidence.
- The composition layer connects operations and owns cleanup; it delegates retrieval and selection algorithms. Keep error, cancellation, and disposal behavior explicit in its contract.
- Apps consume public package exports. Libraries never import apps. Internal files use direct relative imports rather than their own public barrel. Keep the dependency graph acyclic and avoid cross-package relative imports.
- Record significant decisions with the problem, alternatives, choice, consequences, and a condition for revisiting the choice. Reuse `docs/adr/`; do not create an ADR for every helper.

ESLint rejects static imports into `src`/`dist` trees from production files, known app imports from libraries, and acquisition/Git/composition imports from context-engine contracts, evidence, limits, and assembly. The latter modules also reject imports of process, filesystem, and networking APIs, and direct uses of `fetch`, `process`, and `console`. These checks supplement source review: import spelling rules do not resolve every path, detect cycles, or prove the absence of runtime I/O. Review computed imports, global access, and aliases explicitly. Add a resolved dependency-graph tool only when these limitations become a practical maintenance problem.

## Context-engine foundation (planned)

The [context-engine design](superpowers/specs/2026-10-19-context-engine-design.md) and [implementation plan](superpowers/plans/2026-10-19-context-engine.md) define the next slice, superseding the broad migration ordering for this work. One `@daphne/context-engine` package will contain Git-backed retrieval and context assembly; it is not implemented by this policy change. The plan records the allowed internal dependencies and the owning file for each shared contract.

RCI/PCG retain indexing and qualified navigation ownership. Their future integrations will translate into the context engine's evidence contracts; assembly will not depend on index construction. Model requests and review/grouping policy remain outside the engine.

For each implementation task, review these change scenarios:

1. Adding local repository input should leave evidence retention and assembly unchanged.
2. Changing packet rendering should leave Git acquisition and exact source reads unchanged.
3. Adding RCI/PCG navigation may change retrieval/composition, while preserving committed-source validation and packet contracts.
4. Adding a model provider should leave Git access and the evidence ledger unchanged.

Explain any broader change in the walkthrough before adding abstraction. These are design review questions, not claims that future integrations are already supported.

References: [ports and adapters](https://alistair.cockburn.us/hexagonal-architecture/), [Node package exports](https://nodejs.org/api/packages.html#package-entry-points), [ESLint import restrictions](https://eslint.org/docs/latest/rules/no-restricted-imports).

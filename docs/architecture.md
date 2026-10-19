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

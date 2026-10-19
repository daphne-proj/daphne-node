# Libraries

`@daphne/pr-review` provides PR URL parsing and bounded public GitHub metadata resolution. It reads no environment variables and imports no Git or context package.

`@daphne/git-source` provides remote immutable Git snapshots, deterministic change inventories and bounded exact blob reads and committed-file text search. It owns subprocess controls and cleanup mechanics; the caller must close acquired snapshots. Its public API contains no PR resolver, retrieval tool or context builder.

`@daphne/review-evidence` materializes exact source evidence through a borrowing session. Its direct `./contracts` export contains data types without Git/runtime imports. Bounded list/inspect/read/search tools and retryable pagination are implemented.

`@daphne/context-engine` retains supplied evidence and assembles packets without Git handles or retrieval callbacks. Its only workspace imports are evidence-contract types. Defaults cap serialized retention at 4 MiB and each rendered packet at 64 KiB. See its [README](context-engine/README.md) for the public API and admission rules. The CLI host composes these APIs in `context inspect`; RCI/PCG retain indexing ownership.

Import compiled public exports. See [the architecture map](../docs/architecture.md), [the walkthrough](../docs/context-engine-walkthrough.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for ownership and package conventions.

# Libraries

`@daphne/pr-review` provides PR URL parsing and bounded public GitHub metadata resolution. It reads no environment variables and imports no Git or context package.

`@daphne/git-source` provides remote immutable Git snapshots, deterministic change inventories and bounded exact blob reads. It owns subprocess controls and cleanup mechanics; the caller must close acquired snapshots. Its public API contains no PR resolver, retrieval tool or context builder.

`@daphne/review-evidence` materializes exact source evidence through a borrowing session. Its direct `./contracts` export contains data types without Git/runtime imports. Bounded tools and pagination are deferred. Context-engine will retain supplied evidence and assemble packets without Git handles or retrieval callbacks. The host will compose these APIs; RCI/PCG retain indexing ownership. Context-engine has no placeholder workspace.

Import compiled public exports. See [the architecture map](../docs/architecture.md), [the walkthrough](../docs/context-engine-walkthrough.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for ownership and package conventions.

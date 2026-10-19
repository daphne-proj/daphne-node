# Libraries

`@daphne/pr-review` provides PR URL parsing and bounded public GitHub metadata resolution. It reads no environment variables and imports no Git or context package.

`@daphne/git-source` provides remote immutable Git snapshots and deterministic change inventories. It owns subprocess controls and cleanup mechanics; the caller must close acquired snapshots. Its public API contains no PR resolver, retrieval tool or context builder.

Review-evidence will materialize exact evidence and expose bounded retrieval. Context-engine will retain supplied evidence and assemble packets without Git handles or retrieval callbacks. The host will compose these APIs; RCI/PCG retain indexing ownership. Neither deferred package has an empty workspace.

Import compiled public exports. See [the architecture map](../docs/architecture.md), [the walkthrough](../docs/context-engine-walkthrough.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for ownership and package conventions.

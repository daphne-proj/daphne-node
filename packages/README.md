# Libraries

`@daphne/pr-review` provides PR URL parsing and bounded public GitHub metadata resolution. Import its compiled public exports; its library code does not read environment variables or depend on context-engine.

The planned `@daphne/context-engine` package starts with repository/revision acquisition in Task 2. The CLI will compose both packages, while RCI/PCG retain indexing ownership. See [the architecture map](../docs/architecture.md) and [the walkthrough](../docs/context-engine-walkthrough.md).

Add each package with useful behavior and appropriate verification using [CONTRIBUTING.md](../CONTRIBUTING.md). Do not create empty package placeholders.

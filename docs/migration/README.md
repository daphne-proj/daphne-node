# Migration sequence

The foundation is separate from application migration. `reference.json` records the source commit, not a passing Rust baseline. Do not treat a green TypeScript bootstrap as proof of parity.

## Current foundation slice

The TypeScript foundation now resolves public PR metadata in `@daphne/pr-review`, pins revisions and reads Git blobs in `@daphne/git-source`, exposes bounded repository tools in `@daphne/review-evidence`, and retains supplied evidence for packet assembly in `@daphne/context-engine`. The CLI composes these packages in `context inspect`, choosing retrieval policy and closing Git resources. [Architecture](../architecture.md), [ADR 0002](../adr/0002-context-engine-boundary.md) and the [walkthrough](../context-engine-walkthrough.md) describe the boundaries and observed checks.

This foundation does not establish Rust behavior parity. RCI/PCG indexing, model integration and semantic splitting remain later work. No new automated tests were added for this slice at the user's request; the walkthrough records manual demonstrations and existing checks.

## Later Rust migration sequence

1. **Capture the baseline.** Pin the Rust reference, run its relevant tests, inventory CLI/JSON/error contracts, and collect sanitized representative fixtures. Record environment, extractor versions, and timing/memory measurements. Resolve uncommitted source changes explicitly.
2. **Domain and evidence contracts.** Port identities, validated values, serialization, evidence/session types, and pure invariants with differential tests. Preserve names and observable ordering.
3. **Git and pure normalization.** Port Git source behavior and deterministic transformations. Exercise invalid revisions, unusual paths, missing files, and failure diagnostics.
4. **Extraction and indexes.** Validate tree-sitter/SCIP package choices against byte positions, language support, protobuf behavior, and fixtures. Port extraction coverage, normalization, and revision indexing in dependency order.
5. **Graph and lifecycle.** Port graph validation/building and state transitions. Test promotion, persistence compatibility, and incomplete evidence before enabling writes.
6. **Review workflows.** Port semantic grouping, review orchestration, provider adapters, and PR acquisition. Keep model calls opt-in and compare deterministic components independently of generated text.
7. **CLI and evaluation.** Extend the CLI with migrated commands, then port evaluation suites and reporting. Compare end-to-end outputs and failure exit codes against the reference. Command shells can be introduced earlier only to exercise a completed vertical slice.
8. **Cutover.** Require agreed parity, representative performance, platform/native dependency checks, and an operational rollback plan before retiring Rust paths.

For each step: name the slice and its dependencies; capture expected Rust behavior; add the target package; implement; run differential/contract checks; review; record the result. Package boundaries follow [architecture](../architecture.md), and detailed parity rules live in [parity.md](parity.md). A deliberate behavior change needs a separately recorded decision, not a silently updated golden file.

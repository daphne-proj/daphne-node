# Migration sequence

The foundation is separate from application migration. `reference.json` records the source commit, not a passing Rust baseline. Do not treat a green TypeScript bootstrap as proof of parity.

## Current foundation slice

The [context-engine plan](../superpowers/plans/2026-10-19-context-engine.md) takes precedence over the broad migration order below for the current work. Task 1 introduces `@daphne/pr-review` for PR URL and public GitHub metadata resolution. Task 2 introduces `@daphne/git-source` for immutable snapshots and change inventory. Task 3 introduces review-evidence source materialization and Git blob reads; Task 4 adds bounded repository tools and pagination; context-engine will retain supplied evidence and assemble packets. The CLI later composes these packages and owns Git cleanup. RCI/PCG retain indexing and semantic navigation ownership.

This is a new TypeScript foundation, not a Rust behavior port. Git acquisition/comparison and exact source evidence reads are implemented. Bounded retrieval tools and pagination are implemented. Model integration, context assembly and CLI integration remain deferred. No new automated tests were added at the user's request; the walkthrough records manual demonstrations and existing checks.

## Later Rust migration sequence

1. **Capture the baseline.** Pin the Rust reference, run its relevant tests, inventory CLI/JSON/error contracts, and collect sanitized representative fixtures. Record environment, extractor versions, and timing/memory measurements. Resolve uncommitted source changes explicitly.
2. **Domain and evidence contracts.** Port identities, validated values, serialization, evidence/session types, and pure invariants with differential tests. Preserve names and observable ordering.
3. **Git and pure normalization.** Port Git source behavior and deterministic transformations. Exercise invalid revisions, unusual paths, missing files, and failure diagnostics.
4. **Extraction and indexes.** Validate tree-sitter/SCIP package choices against byte positions, language support, protobuf behavior, and fixtures. Port extraction coverage, normalization, and revision indexing in dependency order.
5. **Graph and lifecycle.** Port graph validation/building and state transitions. Test promotion, persistence compatibility, and incomplete evidence before enabling writes.
6. **Review workflows.** Port semantic grouping, review orchestration, provider adapters, and PR acquisition. Keep model calls opt-in and compare deterministic components independently of generated text.
7. **CLI and evaluation.** Replace the bootstrap with actual commands, then port evaluation suites and reporting. Compare end-to-end outputs and failure exit codes against the reference. Command shells can be introduced earlier only to exercise a completed vertical slice.
8. **Cutover.** Require agreed parity, representative performance, platform/native dependency checks, and an operational rollback plan before retiring Rust paths.

For each step: name the slice and its dependencies; capture expected Rust behavior; add the target package; implement; run differential/contract checks; review; record the result. Package boundaries follow [architecture](../architecture.md), and detailed parity rules live in [parity.md](parity.md). A deliberate behavior change needs a separately recorded decision, not a silently updated golden file.

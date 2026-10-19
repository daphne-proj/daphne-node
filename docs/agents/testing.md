# Tests

Keep tests inside the workspace they exercise, under `tests/`, outside production `src/`. Use `*.test.ts` with explicit imports from `vitest`. Typechecking is separate from Vitest's TypeScript transformation.

The default suite is deterministic and offline. No API keys or paid model calls are required. Use temporary directories for Git/filesystem integration tests and clean them afterward. Keep network/provider tests opt-in when they are added.

Test observable outcomes and failure behavior; avoid snapshots of incidental implementation details. Cross-runtime migration requires golden fixtures and differential checks against the pinned Rust reference, not just new unit tests. See `docs/migration/parity.md`.

Store golden inputs under the owning workspace's `tests/fixtures/`. Formatters, Git line-ending conversion, test discovery, and TypeScript inclusion must preserve or exclude fixture source appropriately. Declare provenance and explain any approved normalization; do not rewrite fixture bytes to make tests pass.

`bun run test` builds before Vitest so the CLI smoke test checks real emitted Node code. Watch mode builds only at startup; run `bun run build` after changing the CLI source while watching. Default tests fail when no tests are found or focused tests remain. Coverage tooling and thresholds are added with real domain code, not to score the bootstrap.

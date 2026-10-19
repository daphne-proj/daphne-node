# TypeScript quality

Use the smallest complete implementation. Inspect callers, serialization, tests, and downstream consumers before changing a contract. Prefer Node standard-library functions over dependencies for small operations.

- Keep strict compiler and typed lint checks enabled. Use `unknown` at untrusted boundaries, narrow it, and validate before use. Types alone do not validate JSON, provider output, subprocess output, or persisted data.
- Model alternatives as discriminated unions and handle them exhaustively. Do not use casts, non-null assertions, `any`, or lint suppression to conceal an unproved invariant.
- Treat errors as explicit boundary behavior. Preserve causes and distinguish invalid input, unavailable evidence, and internal failures. Never turn extraction failure into an empty successful result.
- Await promises; define cancellation and deadlines for external work. Preserve bounded concurrency and clean up resources. Pass Git arguments as arrays, not interpolated shell commands.
- Preserve deterministic ordering. JavaScript strings use UTF-16; use bytes for Rust byte offsets. Check Rust integer range against JavaScript safe integers and serialized formats before conversion.
- Keep data immutable where it protects an invariant; do not force a new functional architecture onto every port. Separate transport data from validated domain values when needed.
- Keep module exports intentional. Use `import type` and `.js` ESM relative specifiers. Consumers use public package exports, never a sibling's `src` tree.
- Test meaningful behavior and failure cases in `tests/`; review the final diff for unnecessary abstractions and dependencies.

Tool changes follow [CONTRIBUTING.md](../../CONTRIBUTING.md). Bun configuration uses seconds for `minimumReleaseAge`; keep Node as the script runtime and use `bun run test` for Vitest. Use the migration parity reference before translating Rust behavior.

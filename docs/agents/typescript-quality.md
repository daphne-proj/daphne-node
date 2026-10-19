# TypeScript quality

Use the smallest complete implementation. Minimize unnecessary complexity, not line count; readable, explicit code takes precedence over compressed expressions. Inspect callers, serialization, tests, and downstream consumers before changing a contract. Prefer Node standard-library functions over dependencies for small operations.

- Keep strict compiler and typed lint checks enabled. Use `unknown` at untrusted boundaries, narrow it, and validate before use. Types alone do not validate JSON, provider output, subprocess output, or persisted data.
- Model alternatives as discriminated unions and handle them exhaustively. Do not use casts, non-null assertions, `any`, or lint suppression to conceal an unproved invariant.
- Treat errors as explicit boundary behavior. Preserve causes and distinguish invalid input, unavailable evidence, and internal failures. Never turn extraction failure into an empty successful result.
- Await promises; define cancellation and deadlines for external work. Preserve bounded concurrency and clean up resources. Pass Git arguments as arrays, not interpolated shell commands.
- Preserve deterministic ordering. JavaScript strings use UTF-16; use bytes for Rust byte offsets. Check Rust integer range against JavaScript safe integers and serialized formats before conversion.
- Keep data immutable where it protects an invariant; do not force a new functional architecture onto every port. Separate transport data from validated domain values when needed.
- Keep module exports intentional. Use `import type` and `.js` ESM relative specifiers. Consumers use public package exports, never a sibling's `src` tree.
- Test meaningful behavior and failure cases in `tests/`; review the final diff for unnecessary abstractions and dependencies.

Tool changes follow [CONTRIBUTING.md](../../CONTRIBUTING.md). Bun configuration uses seconds for `minimumReleaseAge`; keep Node as the script runtime and use `bun run test` for Vitest. Use the migration parity reference before translating Rust behavior.

## Readability

- Name values and functions after their domain meaning. Include units when they prevent ambiguity, such as `timeoutMs` or `byteOffset`; avoid vague names such as `data` when a precise name is available.
- Keep the main flow visible. Use guard clauses for invalid inputs and terminal cases when they reduce nesting. Keep equally meaningful alternatives together when an `if`/`else` or `switch` reads better.
- Use braces for every control-flow body. Use `if`/`else` or `switch` for multi-way choices; nested ternaries are rejected by ESLint. A simple two-way ternary is fine.
- Give complex conditions or intermediate results a name when it explains intent. Prefer a plain loop over a dense chain when it makes state changes, error handling, or execution order easier to follow.
- Keep functions focused on one operation. Extract a helper when it gives a coherent operation a useful name or removes real duplication, not to satisfy an arbitrary line limit. Keep related logic together.
- Separate logical steps with blank lines. Comments explain non-obvious constraints or decisions; they should not narrate the syntax.
- Simplification must preserve evaluation order, side effects, cancellation, cleanup, errors, and serialized contracts. Do not remove validation or weaken types to make code look shorter.
- Format changed files with Prettier and run `bun run check`. Review the resulting diff for readability; passing formatting and linting alone does not establish clear design.

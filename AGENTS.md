# Working in Daphne Node

This is the TypeScript migration workspace for Daphne. Read `docs/architecture.md` and `docs/migration/README.md` before changing module boundaries. The Rust repository remains the behavioral reference; migrate business logic only when requested.

## Skills and policies

- For TypeScript implementation, refactoring, or review, use `.agents/skills/daphne-typescript/SKILL.md` and `docs/agents/typescript-quality.md`.
- For Rust-to-TypeScript migration, use `.agents/skills/daphne-migration-parity/SKILL.md` and `docs/migration/parity.md`.
- Do not write or modify tests unless the user explicitly asks. Implementation and bug-fix requests alone do not authorize test changes. Run the existing required checks and report any verification limitations. Update tests only when newly added stuff are breaking existing ones.
- When tests are explicitly requested, use `.agents/skills/vitest/SKILL.md` and `docs/agents/testing.md`. Repository conventions override generic skill examples and test-driven-development workflows.
- When designing or changing module contracts, use `.agents/skills/codebase-design/SKILL.md` with `docs/architecture.md`. Daphne domain names, ownership, and explicit task constraints take precedence over upstream terminology and workflow advice. Do not add interfaces, adapters, or remove tests solely to satisfy a skill heuristic.
- The five reasoning workflows in `.agents/skills/README.md` remain explicit-only. Do not load the whole skill collection for every task.
- Make the smallest complete change. Minimize unnecessary complexity, not line count. Prefer readable, explicit code over compressed expressions. Independently review nontrivial behavior or architecture changes before completion.
- Prefer small, focused files when separation makes code easier to read or navigate. Extract cohesive helpers into clearly named files even when only one caller uses them, if that keeps the main logic clearer. Keep related files together and preserve module boundaries.
- Whenever creating a package, add a concise `README.md` in its root. Explain its purpose and boundaries, how it fits into Daphne, its main public APIs and types, and the key APIs or dependencies it uses and why. Summarize the main flow so a reader can understand how the package works at a glance. Keep it an overview; link to deeper documentation instead of cataloging every symbol or implementation detail.
- In tests, move substantial setup, fixture builders, and test doubles into nearby `*.helpers.ts` files; reserve `*.test.ts` for test scenarios and assertions. Avoid generic utility files and unnecessary splitting of short, cohesive code.
- When writing, editing, reviewing or presenting any code, use `.agents/skills/daphne-code-readability/SKILL.md`. Apply logical spacing to source, scripts, tests, configuration, documentation examples and chat snippets in every language, respecting its syntax and formatter. Check grouping before presenting snippets and before completing edits; keep changes within the task scope.
- Write comments for a teammate seeing the code for the first time: explain purpose, constraints and non-obvious choices in plain language. Follow the comment guidance in `docs/agents/typescript-quality.md`; clear code does not need a comment above every block.

## Commands

Use Node from `.node-version` and Bun from `.bun-version`. Bun is the package manager, Node is the runtime. Run `bun install --frozen-lockfile`, then `bun run check`. Use `bun run test` for Vitest; `bun test` is a different runner. Before completing code changes, format the changed files with the repository Prettier configuration and run `bun run check`. Run compiled CLI code with `bun run build && bun run cli`.

## Boundaries

- Keep tests under the owning workspace's `tests/`, outside `src/`.
- Import packages through their public exports; use `workspace:*` for internal dependencies. Keep relative ESM imports suffixed `.js`.
- Do not introduce Bun-specific APIs into production code without a runtime ADR.
- Do not change fixture bytes, identifiers, hashing, ordering, JSON contracts, or unknown/absent semantics to make parity tests pass.
- Add packages only with their first real implementation. No catch-all `utils` package or speculative adapters.
- Keep `bun.lock` and all runtime/tool version pins consistent. Never weaken strictness to make a port compile.

Issues and specs remain in `daphne-proj/daphne` during migration; always select that repository explicitly. See `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`. Follow `docs/agents/domain.md` for domain vocabulary and ADRs. Report checks actually run and any remaining limitations; do not claim application parity from setup checks.

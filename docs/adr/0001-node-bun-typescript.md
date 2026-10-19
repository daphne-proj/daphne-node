# ADR 0001: Node runtime, Bun workspace tooling

Status: accepted for repository foundation, 2026-10-19.

The migration uses a separate `daphne-node` repository. The user selected Bun instead of pnpm. Bun manages isolated workspace dependencies and runs package scripts; Node 24 LTS executes compiled applications and Vitest. The package manager decision does not imply a runtime rewrite.

Use strict TypeScript, native ESM, `tsc -b`, typed ESLint, Prettier, and Vitest. TypeScript 6.0.3 is deliberately pinned within the installed typescript-eslint supported range; adopting TypeScript 7 requires checking the complete lint/test toolchain first. Pin exact tools and a text `bun.lock`; CI uses frozen installs.

Consequences: both Node and Bun are required. `bun run test` invokes Vitest; `bun test` does not. Production packages must avoid `Bun.*` APIs. Native dependencies and their install scripts are reviewed when introduced. No library or domain migration is implied by this setup.

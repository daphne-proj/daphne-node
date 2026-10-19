# Contributing

Run the setup commands in the README. Keep changes on a focused branch. A change is ready when `bun run check` passes and its behavior has been tested at the relevant boundary. CI runs the same command on Linux and macOS. Paid integrations are never part of the default checks.

## Adding a workspace

Create a package only when migrating its first useful behavior:

1. Create `packages/<name>/package.json` with `name: "@daphne/<name>"`, `private: true`, `type: "module"`, and version `0.0.0`.
2. Declare every imported external dependency in that package and internal dependencies as `"@daphne/<dependency>": "workspace:*"`. Isolated installs make undeclared dependencies unreliable. Declare test/tool dependencies used by that package, as in `apps/cli`.
3. Add `src/index.ts` with intentional exports and a `tests/` directory. Libraries expose `exports["."].types` as `./dist/index.d.ts` and `exports["."].import` as `./dist/index.js`; do not export `src/` or use cross-package relative imports.
4. Follow `apps/cli/tsconfig.json` and `tsconfig.build.json`. Extend the root base, typecheck source and tests, emit only source into `dist/`. Exclude fixture source files from typechecking. Add `build` and `typecheck` scripts.
5. Add the build project to root `tsconfig.json` references. Add references to dependency build projects in its `tsconfig.build.json` so `tsc -b` orders builds. Build before typechecking a new consumer of another package's `dist` declarations.
6. Run `bun install` to update the workspace lock, then `bun run check`. Root test discovery already includes package `tests/**/*.test.ts`; no separate test configuration is needed.

Production imports use `.js` relative specifiers even in `.ts` files. Keep NodeNext resolution and emitted Node-compatible JavaScript; no bundler or path alias is required.

## Updating tooling and skills

Use reviewed exact dependency versions and commit the lockfile. Node types must match the supported runtime major. Change `.node-version`, `engines.node`, and Node types together when needed. Change `.bun-version`, `packageManager`, and `engines.bun` together. CI reads the version files.

Update vendored skills from a reviewed commit, preserve their license and explicit-only settings, and refresh `.agents/skills-sources.json` hashes. Do not run a moving `npx`/`bunx` skill installer in CI. The provenance manifest covers vendored files, not locally authored guidance.

Do not add an upstream license to the whole project without a maintainer decision; the existing repository has no project license. The vendored Vitest skill has its own MIT notice.

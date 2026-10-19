# Setup research and decisions

Reviewed 2026-10-19. Installed package versions and the committed lockfile are authoritative for this repository; upstream latest releases may change. These sources informed the setup, not a promise that every upstream feature is used.

| Decision                                                                       | Primary source                                                                                                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node LTS runtime                                                               | [Node release schedule](https://nodejs.org/en/about/previous-releases)                                                                                          |
| Bun workspaces and `workspace:*`                                               | [Bun workspaces](https://bun.sh/docs/pm/workspaces)                                                                                                             |
| Exact versions, isolated installs, release age in seconds, Node script runtime | [Bun configuration](https://bun.sh/docs/runtime/bunfig) and [isolated installs](https://bun.sh/docs/pm/isolated-installs)                                       |
| Frozen lockfile and lifecycle script trust                                     | [Bun install](https://bun.sh/docs/pm/cli/install) and [lockfile](https://bun.sh/docs/pm/lockfile)                                                               |
| Strict NodeNext and project builds                                             | [TSConfig](https://www.typescriptlang.org/tsconfig/) and [project references](https://www.typescriptlang.org/docs/handbook/project-references.html)             |
| Type-aware lint and compatible TS range                                        | [Typed linting](https://typescript-eslint.io/getting-started/typed-linting/) and [dependency versions](https://typescript-eslint.io/users/dependency-versions/) |
| Node-based test runner                                                         | [Vitest getting started](https://vitest.dev/guide/)                                                                                                             |
| Repository agent instructions and skill discovery                              | [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md/) and [skills](https://developers.openai.com/codex/skills/)                              |
| Vendored testing skill                                                         | [antfu/skills pinned source](https://github.com/antfu/skills/tree/feb0f3aba6566426f12230e7fc7a10d97c1293bb/skills/vitest)                                       |

The specific combination was installed and checked together. TypeScript 6 is retained for the installed linter's supported range instead of adopting TypeScript 7 in this initial setup. Node remains the runtime; the user's Bun choice replaces pnpm. The larger migration plan lives in the source repository at `docs/superpowers/plans/2026-10-19-typescript-repository-migration.md`; its pnpm recommendation and same-repository layout are superseded here by the user's choices.

No React/Next.js, database, provider SDK, parser bindings, build orchestrator, or broad skill pack is installed without code that needs it. This keeps the foundation maintainable while leaving the documented migration boundaries explicit.

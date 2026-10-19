# Daphne — TypeScript workspace

Foundation for migrating [Daphne](https://github.com/daphne-proj/daphne) to TypeScript. This repository currently contains tooling, agent guidance, and a CLI bootstrap. No review, extraction, graph, lifecycle, or evaluation logic has been migrated.

## Getting started

Install Node **24.22.0** and Bun **1.4.3**, matching `.node-version` and `.bun-version`. Bun manages dependencies and runs scripts; the application and Vitest execute on Node. Existing global tools are not upgraded by this repository.

```sh
bun install --frozen-lockfile
bun run check
bun run cli
```

`bun run cli` runs the compiled bootstrap after the build performed by `check`. After a source edit, run `bun run build` first. The bootstrap only reports that the workspace is ready; it does not implement Daphne commands.

| Command                | Purpose                                                                |
| ---------------------- | ---------------------------------------------------------------------- |
| `bun run build`        | Compile workspace projects in dependency order                         |
| `bun run typecheck`    | Check application, test, and tool types                                |
| `bun run lint`         | Run type-aware ESLint                                                  |
| `bun run format`       | Format owned files; preserve fixtures and vendored skills              |
| `bun run format:check` | Check formatting without changes                                       |
| `bun run test`         | Build, then run Vitest including the compiled CLI smoke test           |
| `bun run test:watch`   | Build once, then watch tests; rebuild after changing compiled CLI code |
| `bun run clean`        | Remove TypeScript build outputs                                        |
| `bun run check`        | Run formatting, lint, typecheck, build, and tests                      |

Use **`bun run test`**, not `bun test`: the latter selects Bun's separate test runner. Do not use `bun --bun` to run the Node tools.

## Structure

```text
apps/
  cli/                 Node CLI entry point; src/ and tests/
  eval/                Planned evaluation app; ownership documentation only
packages/              Planned library boundaries; created when code is migrated
docs/
  adr/                 Accepted architecture decisions
  agents/              Coding, testing, and issue-tracker policies
  migration/           Source baseline, sequence, and parity requirements
.agents/skills/        Focused TS/migration references and reusable reasoning skills
.github/workflows/    Linux and macOS checks
```

Start with [architecture](docs/architecture.md), [agent instructions](AGENTS.md), and the [migration sequence](docs/migration/README.md). Package creation instructions are in [CONTRIBUTING.md](CONTRIBUTING.md). Research and upstream references are recorded in [docs/setup-sources.md](docs/setup-sources.md).

## Dependency policy

Commit `bun.lock`; CI uses a frozen install. Direct versions are exact, installs use isolated dependency resolution, and newly published dependencies have a one-day minimum age. Dependency lifecycle scripts require deliberate review before adding to `trustedDependencies`. Run `bun pm untrusted` when an install reports blocked scripts. Do not enable every script to solve an installation error.

The workspace is private. No publishing workflow, credentials, external services, or Git hooks are required for local checks. Secrets belong in the environment; local `.env` files are ignored. Future fixture changes must remove secrets and preserve original bytes.

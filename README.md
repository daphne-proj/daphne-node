# Daphne — TypeScript workspace

Foundation for migrating [Daphne](https://github.com/daphne-proj/daphne) to TypeScript. This repository includes tooling, agent guidance and a bounded PR context-inspection command. The command connects PR metadata, pinned Git source, evidence retrieval and context assembly. AI review, semantic splitting, extraction, graph, lifecycle and evaluation logic remain future work.

## Getting started

Install Node **24.22.0** and Bun **1.4.3**, matching `.node-version` and `.bun-version`. Bun manages dependencies and runs scripts; the application and Vitest execute on Node. Existing global tools are not upgraded by this repository.

```sh
bun install --frozen-lockfile
bun run check
bun run cli
```

`bun run cli` preserves the original no-argument bootstrap response. After a source edit, run `bun run build` first.

Inspect a public GitHub PR into a new directory whose parent already exists:

```sh
bun run cli -- context inspect \
  --pr https://github.com/daphne-proj/pr-review-test/pull/2 \
  --output ./inspection-2
```

The command saves `context.json` and `run.json`, prints one JSON summary to stdout and sends diagnostics to stderr. Exit 0 means the bounded inspection completed; 2 means usable partial artifacts; 1 means invalid input, cancellation or an operational/output failure. Existing destinations are rejected. SIGINT/SIGTERM stop work and clean up Git before saving a stopped report where possible.

The host admits whole tool pages up to 64 KiB of source text. The engine separately bounds retained data at 4 MiB and rendered context at 64 KiB. Inventory completeness, per-change inspection and packet omissions are reported separately. This is deterministic change-order inspection, not a semantic coverage or AI-review claim. Optional `GITHUB_TOKEN` is used only for metadata access; private repository cloning is not supported. See the [walkthrough](docs/context-engine-walkthrough.md#step-6-compose-the-cli-inspection-workflow) for the data flow and limitations.

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
packages/              PR acquisition, Git source, evidence and context libraries
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

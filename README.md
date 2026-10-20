# Daphne — TypeScript workspace

Foundation for migrating [Daphne](https://github.com/daphne-proj/daphne) to TypeScript. This repository includes tooling, agent guidance, bounded PR context inspection and an experimental LLM split proposal command. The commands connect PR metadata, pinned Git source, evidence retrieval and context assembly. Rust workflow parity, extraction, graph, lifecycle and evaluation logic remain future work.

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

## Try an LLM split proposal

Put `OPENAI_API_KEY` in the ignored `.env` file or export it in your environment, then run:

```sh
make split-pr PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

This builds the CLI and uses `gpt-6.1-sol`. It sends each exact hunk through `paginateDiffContext` and analyzes the resulting pages independently. It then asks for a proposed grouping of whole hunks from those notes. Metadata-only changes are included. No branches, commits or GitHub PRs are created.

The command saves one `outputs/split-pr-*/run.json` containing pinned commits, the change inventory, exact pages, page analyses, provider responses and `proposal.groups`. Each group's `unitIds` refers to a change/hunk pair recorded on the pages; all fragments of a hunk stay together. The host checks that every unit appears exactly once. The proposal still needs human review: neither independence nor semantic correctness is verified.

Optional Make variables are `OUTPUT=NEW_DIRECTORY`, `MODEL=gpt-6.1-sol` and `MAX_INPUT_TOKENS=16384`. Existing output directories are rejected. The equivalent CLI command is:

```sh
bun run cli -- split-pr \
  --pr https://github.com/daphne-proj/pr-review-test/pull/2 \
  --output ./split-proposal \
  --model gpt-6.1-sol \
  --max-input-tokens 16384
```

Input counts come from the [OpenAI token-counting API](https://developers.openai.com/api/docs/guides/token-counting), including instructions and the final output schema. Each generation allows up to 4,096 output tokens, including reasoning, with a 120-second request deadline. Requests do not accumulate conversation history. The input limit applies per request, not to total spending; a large PR makes more calls. Source pages retain the pager's 64 KiB ceiling and Git's existing blob limits.

Final grouping uses page notes rather than all source text. If those notes exceed the input limit, or a request fails, the command exits 1 and saves completed page analyses with the error. Exit 0 means a proposal was produced and its unit coverage validated. This is a new end-to-end experiment, not a migration of the Rust semantic-split workflow. Paid calls occur only when explicitly running `split-pr`, never in `bun run check`.

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

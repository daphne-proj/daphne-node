# CLI

`@daphne/cli` is Daphne's Node command-line host. It parses arguments, handles signals and environment configuration, composes library workflows, and writes artifacts and summaries. Review logic stays in the libraries; this app owns user-facing behavior and exit codes.

## Commands and public APIs

| Entry point                                       | Purpose                                                                                                                       |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `context inspect --pr URL --output NEW_DIRECTORY` | Retrieve bounded PR evidence and build a context packet without model calls.                                                  |
| `split-pr --pr URL --output DIRECTORY`            | Collect exact PR evidence and request an intention-based split proposal; requires OpenAI credentials.                         |
| `@daphne/cli/command-output`                      | Export `formatCommandOutput(title, rows)` for shared terminal summaries.                                                      |
| `@daphne/cli/output-path`                         | Export `isGoldenDatasetPath(path)` so CLI and eval writers protect manually maintained gold cases, including symlink aliases. |

From the repository root, compile with `bun run build`, then use `bun run cli -- <command>`. `split-pr` also accepts `--model` and `--max-input-tokens`; it loads root `.env` when present. There is no library root export.

## Main types

- `CommandOutputRow`: the public formatter's label, value and optional status tone.
- `RunReport`: the internal inspection report tracking stages, inventory, evidence coverage, packet omissions and errors.
- `ContextPacket` / `SplitPullRequestResult`: library-owned results that the app serializes into local artifacts.

## How it works

1. Parse a command, install SIGINT/SIGTERM cancellation, and validate its PR and output arguments.
2. For inspection, resolve PR metadata, acquire Git, retrieve and retain tool pages, close Git, then build the packet. For splitting, delegate acquisition, cleanup and grouping to `splitPullRequest`.
3. Save completed work and failure diagnostics, then print a summary and set the exit code. Inspection writes `context.json` when available and `run.json`; splitting writes one `run.json` and replaces it on reruns.

`pr-review` supplies metadata and the split workflow. Inspection directly composes `git-source`, `review-evidence` and `context-engine`; `llm` errors are translated into user-facing diagnostics. Node's `parseArgs`, `loadEnvFile`, filesystem APIs and `styleText` provide argument parsing, configuration, artifact publication and terminal formatting without extra runtime libraries.

Inspection admits whole tool pages under a 64 KiB source allowance and distinguishes complete, partial and failed runs. Split success means validated unit coverage, not verified semantic quality. Output writers reject the gold dataset directory; inspection requires a new destination, while splitting reuses its destination and replaces the previous run artifact.

See the root [inspection instructions](../../README.md#getting-started) and [split instructions](../../README.md#try-an-llm-split-proposal) for usage and credentials, or [command dispatch](src/main.ts) for process behavior.

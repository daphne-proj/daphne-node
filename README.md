# Daphne — TypeScript workspace

Foundation for migrating [Daphne](https://github.com/daphne-proj/daphne) to TypeScript. This repository includes tooling, agent guidance, bounded PR context inspection and an experimental LLM split proposal command. The commands connect PR metadata, pinned Git source, evidence retrieval and context assembly. Rust workflow parity, extraction, graph, lifecycle and broader evaluation workflows remain future work.

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

The host admits whole tool pages up to 64 KiB of source text. The engine separately bounds retained data at 4 MiB and rendered context at 64 KiB. Inventory completeness, per-change inspection and packet omissions are reported separately. This is deterministic change-order inspection, not a semantic coverage or AI-review claim. Optional `GITHUB_TOKEN` is used only for metadata access; private repository cloning is not supported. See the [CLI overview](apps/cli/README.md#how-it-works) for the data flow and limitations.

## Try an LLM split proposal

Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the ignored `.env` file or environment. Select the provider in Make (OpenAI is the default):

```sh
make split-pr PR=https://github.com/daphne-proj/pr-review-test/pull/2 PROVIDER=openai

make split-pr PR=https://github.com/daphne-proj/pr-review-test/pull/2 PROVIDER=anthropic
```

This builds the CLI and uses the selected provider's default model. Update the two model-name strings in [`packages/llm/src/providers.ts`](packages/llm/src/providers.ts) when changing frontier models; defaults are `gpt-6.1-sol` and `claude-opus-5-5`, with no runtime model discovery. It reads exact hunks through review-evidence, then passes them together to `splitDiffIntoContextPages`, which owns packing and splitting within the request budget. When the diff fits one page, the initial generation groups the raw evidence directly. Larger inputs use page analyses followed by a grouping request. Groups represent independently reviewable responsibilities; sharing a file or module is not a reason to merge them. Metadata-only changes are included. No branches, commits or GitHub PRs are created.

The complete PR workflow is available as `splitPullRequest` from `@daphne/pr-review/split`. Supply a parsed PR reference, explicit model credentials/settings, a shared `RunBudget` and optional GitHub token. Create the budget before acquisition with `createRunBudget(policy, signal)` from `@daphne/evaluator-optimizer`. It resolves the PR, acquires Git, collects the inventory and exact hunks, closes Git, then runs the split. Its complete/failed result retains collected evidence, pages, analyses, attempts, call counts and all operation/cleanup errors. The existing `@daphne/pr-review` root export remains metadata-only.

Callers that already have evidence can use `runSemanticSplit` from `@daphne/semantic-split`. An optional synchronous `onPage` callback reports prepared pages. These operations do not read environment variables, print output or write artifacts. The CLI owns those concerns and serializes the existing v3 format with provider and model metadata. The compiled CLI still accepts `--model` for explicit reproducible runs. `@daphne/semantic-split` owns pagination coordination, page analysis, grouping history, coverage validation and correction feedback, alongside expected IDs, its Zod response schema and prompts. `@daphne/evaluator-optimizer` owns shared iteration and optional run limits. It uses `createModel` from `@daphne/llm` for token counting and generation. LLM owns provider request/response handling and replayable output items, with no split-policy dependencies.

The command saves one `outputs/split_pr_<pr_number>/run.json`. Reruns reuse the directory and atomically replace its previous `run.json` when the new complete or failed report is ready. Other files in the directory remain untouched. The artifact contains pinned commits, the change inventory, collected `hunks`, exact pages, provider responses and `proposal.groups`. Collected hunks preserve evidence even if a later retrieval or paging operation fails; their `changeId` references the inventory without duplicating full change metadata. The `daphne-split-pr-v3` format records each page's `unitIds`, its initial grouping-request `inputTokens`, and nullable `analysis`; a direct grouping has no intermediate analysis. It records `budget: { maxCandidates, deadlineAt }` (null means unset) and ordered `attempts`, each containing its one-based `number`, complete-request `inputTokens`, answer `text`, raw `response`, and `validation` result. Attempts record successfully returned grouping replies, including invalid drafts; a failed provider request creates no completed attempt. `calls` counts actual attempted token-count and generation requests separately, including page analyses. Each group's `unitIds` refers to a change/hunk pair recorded on the pages; all fragments of a hunk stay together.

The split workflow derives expected unit IDs from the original Git inventory: one per text hunk, or one metadata unit for a change without text hunks. Before any analysis or grouping generation, it checks that the pages contain exactly those distinct IDs; repeated IDs across fragment pages are allowed. It validates each proposal's JSON structure and requires every expected unit exactly once, reporting all missing, duplicate and unknown IDs together. Invalid JSON, structure or coverage triggers a complete replacement proposal in the same local conversation, until validation succeeds, cancellation/failure stops the run, or an optional host ceiling is reached. Every replacement is checked again; the final allowed candidate is evaluated before exhaustion. There is no default candidate ceiling or overall timeout. Use `--max-candidates N` and `--run-timeout-ms N` on the compiled CLI to select global limits; these cover acquisition, paging, analysis, grouping and publication checks. Empty inventory succeeds without generation unless the operation was cancelled. The proposal still needs human review: neither independence, patch applicability nor semantic correctness is verified.

Optional Make variables are `OUTPUT=DIRECTORY`, `PROVIDER=openai|anthropic` and `MAX_INPUT_TOKENS=16384`. Custom output directories use the same replacement behavior. The equivalent CLI command is:

```sh
bun run cli -- split-pr \
  --pr https://github.com/daphne-proj/pr-review-test/pull/2 \
  --output ./split-proposal \
  --provider openai \
  --max-input-tokens 16384
```

Input counts come from the selected provider's counting endpoint ([OpenAI](https://developers.openai.com/api/docs/guides/token-counting), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/token-counting)), including the same message-array input, instructions, reasoning settings and final output schema sent for grouping. The grouping input starts with one user message containing the raw page or serialized page notes. Corrections replay the complete provider output, including opaque reasoning content and message metadata, then append validation diagnostics and a request for a complete replacement. Each adapter preserves its provider's replay format. Missing or duplicated known IDs also receive all original fragment pages not already supplied as raw evidence, in page order. Unknown IDs have no source to retrieve.

OpenAI generations use `store: false`. Each provider allows up to 4,096 output tokens including reasoning, and has a 120-second request deadline. Page analyses remain separate string-input requests; they and token-count requests consume actual resources without consuming grouping-candidate slots. The input limit applies per request, not to total spending; a large PR makes more calls. Source pages retain the pager's 64 KiB ceiling and Git's existing blob limits. Every grouping turn checks its full accumulated history against the token limit and a 64 KiB serialized-input ceiling, including prior replies, added evidence, message wrappers and JSON escaping. These budgets can stop corrections early, even when raw evidence pages fit. History and evidence are never trimmed to force another attempt. Page analyses retain their `{ text, response }` shape; native output remains inside each raw provider response.

Exhausted candidate ceilings, input-capacity failures, provider errors, refusals, incomplete responses, counting failures, timeouts and cancellation stop the command with exit 1. Transport failures are not retried. Handled failures save collected evidence, completed analyses and completed grouping attempts, leaving top-level `proposal` and `response` null. Exit 0 means inventory coverage was validated; only then are top-level results accepted. Artifacts are written when the command finalizes, without crash recovery or resume. This is a new end-to-end experiment, not a migration of the Rust semantic-split workflow. Paid calls occur when a caller runs a model operation, never in `bun run check`.

## Explain a PR's intentions

For temporary experiments using your ChatGPT Codex allowance, sign in with `codex login` and select `PROVIDER=codex`:

```sh
make intentions PR=https://github.com/daphne-proj/pr-review-test/pull/2 PROVIDER=codex
make split-pr PR=https://github.com/daphne-proj/pr-review-test/pull/2 PROVIDER=codex
```

Codex generation defaults to `gpt-6.1-sol` with `high` reasoning effort. Set `REASONING_EFFORT` on `make intentions` or `make intentions-eval` to override it; the independent judge keeps its own settings. This requires Codex CLI on `PATH` (verified with 0.166.0), not an API key. Each generation starts a fresh process in a temporary directory, tells Codex to act as an API using only the supplied request, and disables local tools, project instructions, skills, memory and plugins. Daphne executes its own requested evidence functions as usual. This is context separation, not filesystem isolation. There is no API fallback. Subscription limits and any account credit billing still apply.

Codex input counts are conservative UTF-8 byte estimates of the visible request, not exact token counts; hidden CLI context is additional. Output-token limits are instructions rather than an API-enforced cap. Existing workflow validation still checks the final proposal. Artifacts identify `codex`, retain CLI usage, and leave USD cost unavailable. Switch back with `PROVIDER=openai` or `PROVIDER=anthropic`; use those providers for API-equivalent measurements.

With the selected provider's API key configured, run:

```sh
make intentions PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

The command shows colored intention tables with generation time, estimated USD cost and producer/reviewer details, and saves an inspectable `run.json` in a new `outputs/intentions-*` directory. Redirected output is indented JSON. Cards separate actual before/after behavior, desired outcome, motivation and supported potential issues. Purpose can be stated, inferred or unknown. Writer and reviewer can inspect relevant unchanged source in either revision to understand consequences. Acceptance means the account passed review, not that the PR is safe; empty issues do not certify correctness.

It uses the selected provider's default model; optional Make arguments are `OUTPUT=NEW_DIRECTORY`, `PROVIDER=openai|anthropic` and `MAX_INPUT_TOKENS=256000`. Each structurally valid candidate receives semantic review inside the existing evaluator-optimizer loop. It makes paid writer/reviewer calls and returns exit 0 only after the workflow and artifact publication succeed. The compiled CLI accepts optional `--max-candidates N` and `--run-timeout-ms N` flags; neither has a default. See the [CLI guide](apps/cli/docs/intentions.md) for output fields, budgets and failure handling.

## Evaluate against the golden dataset

Gold cases in `apps/eval/datasets/split-pr/cases` are created and edited manually. Repository commands only read them: CLI/eval output paths cannot target this directory, including through symlinks, and repository formatting skips it.

Capture splitter output with `make split-pr PR=URL`, then compare its `run.json` with a manually prepared case:

```sh
make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json
make split-pr-eval-all
```

Validation reports structural consistency and label coverage. Evaluation checks the supplied artifact and prints the overall pair agreement score and any violated pairs without changing either input or creating a report by default. An explicit `OUTPUT=NEW_FILE` exports a report outside the gold directory. Neither command approves labels. See the [labeling policy](apps/eval/datasets/split-pr/cases/README.md) and [saved-run evaluation](apps/eval/docs/commands.md#compare-a-saved-split-pr-run).

`split-pr-eval-all` builds once, reruns the model for the PR in each saved capture, and compares each fresh result with its gold case. Each case saves `run.json` and `eval.json` under a unique `outputs/split-pr-eval-all.*` directory, preserving the reference captures. The command refuses to score a PR whose commits or frozen evidence changed since its gold capture, continues after failures, and exits nonzero if any run or comparison fails. Pair violations are printed but retain the individual evaluator's successful exit status. This command makes paid model calls and never writes gold files.

Upload a completed saved batch explicitly with `make split-pr-langfuse-upload RUN_DIR=outputs/split-pr-eval-all.XXXXXX`. This reads and revalidates the saved scores, sends compact case inputs, pair labels, predicted groups and scores to a separate Langfuse experiment, and marks draft labels provisional. It makes no model calls and does not upload raw run artifacts. The batch directory receives an upload-attempt marker and, on success, a receipt with the experiment URL. See [the upload guide](apps/eval/docs/commands.md#upload-saved-batch-scores-to-langfuse) for retry behavior and credential setup.

## Verify Langfuse setup

Configure the three `LANGFUSE_*` variables listed in [.env.example](.env.example), preserving any existing `.env` values, then run:

```sh
bun run build
bun run eval -- langfuse-smoke
```

This explicitly sends two synthetic arithmetic cases and their scores to your configured Langfuse instance, with no model calls. The JSON result links to the experiment. See [the smoke check](apps/eval/tests/smoke/README.md) for its purpose and the official Langfuse references, and [the evaluation app](apps/eval/README.md) for configuration and failure behavior. Normal checks remain offline.

The evaluation app also imports saved split-pr evidence, validates frozen datasets and scores saved outputs against reviewed pair labels offline. The [dataset guide](apps/eval/datasets/split-pr/README.md) describes annotation and the first reviewed case; [saved-run scoring](apps/eval/docs/commands.md#score-a-reviewed-suite-case) explains the command and metrics. The [live evaluation command](apps/eval/docs/commands.md#run-reviewed-split-pr-evaluations) runs reviewed frozen cases and records native scores, model usage and timing in Langfuse while saving full local trials.

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
| `bun run check`        | Run formatting, typecheck/build, lint, and tests                       |

Use **`bun run test`**, not `bun test`: the latter selects Bun's separate test runner. Do not use `bun --bun` to run the Node tools.

## Structure

```text
apps/
  cli/                 Node CLI entry point; src/ and tests/
  eval/                Frozen split-pr datasets, scoring and live Langfuse experiments
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

# Evaluation application

`@daphne/eval` evaluates semantic-split output against manually maintained pair labels and judges saved intention cards through the Codex CLI. It owns evaluation policy, local reports and Langfuse reporting; reusable generation workflows stay in their packages.

## Commands and main APIs

From the repository root, run `bun run build`, then `bun run eval -- <command>`.

| Command             | Purpose                                                                  | External calls      |
| ------------------- | ------------------------------------------------------------------------ | ------------------- |
| `split-pr validate` | Check case/suite contracts, evidence and labels.                         | None                |
| `split-pr eval`     | Compare a saved run with one case; draft comparisons remain provisional. | None                |
| `split-pr score`    | Score a saved run against a reviewed suite case.                         | None                |
| `split-pr run`      | Run reviewed frozen cases through the splitter and report experiments.   | OpenAI and Langfuse |
| `split-pr upload`   | Revalidate and upload saved batch scores.                                | Langfuse            |
| `langfuse-smoke`    | Verify experiment reporting with two synthetic cases.                    | Langfuse            |
| `intentions judge`  | Judge a saved run using its original prompt, evidence and output.        | Codex CLI           |

This app has no public library exports. Internally, `runSplitCommand` dispatches evaluation commands, `withLangfuse` owns the telemetry lifecycle, and `createModelCallRecorder` captures provider timing and usage.

## Main types

- `FrozenSplitEvidence` / `SplitCase` / `PairLabel`: pinned evidence, review state and expected together/separate/unknown relationships.
- `SplitScores` / `SplitTrial`: structural acceptance, pair agreement, diagnostics and a trial's retained workflow result.
- `RecordedModelCall`: attempted calls and timings, with provider-reported `TokenUsage` imported from `@daphne/llm`; missing usage stays unavailable.
- `LangfuseConnection` / `ExperimentExpectations`: explicit service configuration and required case/score accounting.

## How it works

1. Load and validate frozen evidence and labels. Saved-run comparisons revalidate the proposal and check evidence consistency rather than trusting recorded validation.
2. Score known pair relationships offline, or run reviewed cases with bounded concurrency through `runSemanticSplit`, withholding labels from model input.
3. Preserve complete local trial artifacts. Live commands export experiment results and check case, score and model-call accounting before finalizing telemetry and reporting completion.

`semantic-split` provides generation and proposal validation; evidence contracts describe inputs, and `@daphne/llm` provides call observations and usage parsing. Eval retains Langfuse token-bucket mapping and reporting issues. Langfuse client/tracing APIs and OpenTelemetry provide experiments, scores and export lifecycle. CLI public subpaths share terminal formatting and gold-output protection. Node filesystem and crypto APIs provide safe JSON publication and input fingerprints.

Commands never edit gold cases or approve labels. A completed evaluation is distinct from good model quality; unknown/unlabeled pairs do not count toward agreement. Live benchmarks require reviewed cases and explicit credentials. Normal repository checks stay offline.

See the [command guide](docs/commands.md) for flags, artifacts, credentials and failure behavior; the [dataset guide](datasets/split-pr/README.md) for labeling; and [source contracts](src/split-pr/contracts.ts) for evaluation data shapes.

To judge intentions, run `make intentions-eval ARTIFACT=outputs/intentions-20261027-233537-54278/run.json`. The artifact supplies the original generation prompt, pinned evidence and accepted cards; the shared [rubric](prompts/intentions.md) defines the quality checks. A fresh output directory contains `input.json` and `report.json`. Optional `OUTPUT`, `MODEL` and `GENERATION_PROMPT` settings are described in the [command guide](docs/commands.md#judge-saved-intention-cards).

The judge lives in `src/intentions`; `codex-runner.ts` owns its fresh subprocess, context controls and cancellation. It does not regenerate intentions or upload to Langfuse. Context controls reduce inherited context but do not prove complete isolation from managed instructions or eliminate model bias. Use the [manual procedure](docs/commands.md#manually-evaluate-intention-cards) to calibrate judgments; split pair labels do not grade explanation quality.

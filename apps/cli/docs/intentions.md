# Intentions command

Build with `bun run build`; run compiled commands with `bun run cli -- ...`. The CLI owns environment loading, cancellation, terminal output and local artifacts. Library workflows take explicit configuration and do not print or write files.

## Explain a PR's intentions

Set `OPENAI_API_KEY` in the ignored root `.env` or environment, then run from the repository root:

```sh
make intentions PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

This builds the CLI, investigates the public PR using `gpt-6-sol`, and prints a JSON object containing `status`, `proposal`, `output` and `errors`. JSON uses two-space indentation on both interactive and redirected stdout. Terminal summaries use the shared `formatCommandOutput` helper on stderr, so stdout can be redirected to a JSON file. The proposal contains ordered `intentions` and `warnings`; the raw provider response is saved in the artifact.

Each run saves `run.json` under a fresh ignored `outputs/intentions-<timestamp>-<pid>` directory. Optional Make arguments are `OUTPUT=NEW_DIRECTORY`, `MODEL=gpt-6-sol` and `MAX_INPUT_TOKENS=256000`. An explicit output must be a new directory in an existing writable parent; existing runs and gold datasets are protected. The equivalent command is:

```sh
bun run build
bun run cli -- intentions \
  --pr https://github.com/daphne-proj/pr-review-test/pull/2 \
  --output ./intentions-2 \
  --model gpt-6-sol \
  --max-input-tokens 256000
```

Optional `GITHUB_TOKEN` authenticates PR metadata requests only; the Git adapter supports public repositories. Running this command makes paid model calls. Normal repository checks do not.

## Read the result

Each intention has a `title`, associated `changeIds`, `before` and `after` claims, and a `why`. Claims cite known changes or exact source bytes from the pinned base/head revisions. Code citations include source resolved by the host. Reasons distinguish `stated` PR quotations, `inferred` explanations with evidence, and `unknown`. An intention may overlap another; this is not the splitter's exactly-once hunk partition. Valid citations do not prove that the explanation is accurate.

The `daphne-intentions-v1` artifact preserves:

- `metadata`, `identity`, `changes`, collected `hunks` and acquisition `limitations`, including PR title/body and pinned commits.
- `investigation`: captured comparison, actual limits, retained evidence, hunk-to-evidence mappings, delivered evidence IDs, tool requests/results, completed turns, validation diagnostics and call counts. It is null when acquisition never reached the investigation.
- Top-level `proposal` and `response`: accepted output only when the whole run completes. A nested draft remains diagnostic if cleanup or publication subsequently fails.
- `modelCalls`: count/generation kind, sequence number within that kind, model, status, native `usage`, token-count endpoint `inputTokens`, and per-call timestamps/duration. Missing usage is null, not zero; it is not a cost estimate.
- `timing`: workflow start/end and elapsed milliseconds, including acquisition and cleanup but excluding artifact serialization/publication. `errors` contain safe stage/code/message descriptions without raw exception causes or configuration credentials.

Exit 0 requires a complete workflow and saved artifact. Exit 1 means invalid arguments, setup, acquisition, investigation, cleanup or publication failed. Handled failures preserve completed work where the filesystem permits; accepted top-level output is cleared. SIGINT/SIGTERM and the ten-minute host deadline cancel ongoing work before Git cleanup and failed-report finalization. Cleanup/finalization may outlast the deadline. A publication failure triggers one attempt to save a failed report; if that also fails, stdout reports `output: null`. Files left by a failed publication are not a confirmed successful run. Artifacts are saved at finalization, with no crash recovery or resume.

The current guardrails remain 256,000 input tokens per request, 16,384 output tokens, 24 generations, 24 tool executions, one final-output correction, 8 MiB context/request bytes and 32 MiB retained evidence. The complete request is counted before generation. Exceeding a budget stops explicitly and retains diagnostics; history is not trimmed. These are application limits, not model capacity claims. See the [intentions workflow](../../../packages/intentions/README.md) and [PR workflow](../../../packages/pr-review/README.md) for ownership and validation details.

The existing `context inspect` and `split-pr` commands are documented in the [root README](../../../README.md). Their behavior and defaults are unchanged.

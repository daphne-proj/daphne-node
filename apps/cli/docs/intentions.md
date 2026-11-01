# Intentions command

Build with `bun run build`; run compiled commands with `bun run cli -- ...`. The CLI owns environment loading, cancellation, terminal output and local artifacts. Library workflows take explicit configuration and do not print or write files.

## Explain a PR's intentions

Set the selected provider's `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in the ignored root `.env` or environment, then run from the repository root. OpenAI is the default; add `PROVIDER=anthropic` to switch providers:

```sh
make intentions PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

This builds the CLI, investigates the public PR using the selected provider's default model, and prints a JSON object containing `status`, `proposal`, `output` and `errors`. JSON uses two-space indentation on both interactive and redirected stdout. Terminal summaries use the shared `formatCommandOutput` helper on stderr, so stdout can be redirected to a JSON file. The proposal contains ordered `intentions` and `warnings`; the raw provider response is saved in the artifact.

Each run saves `run.json` under a fresh ignored `outputs/intentions-<timestamp>-<pid>` directory. Optional Make arguments are `OUTPUT=NEW_DIRECTORY`, `PROVIDER=openai|anthropic` and `MAX_INPUT_TOKENS=256000`. An explicit output must be a new directory in an existing writable parent; existing runs and gold datasets are protected. The equivalent command is:

```sh
bun run build
bun run cli -- intentions \
  --pr https://github.com/daphne-proj/pr-review-test/pull/2 \
  --output ./intentions-2 \
  --provider openai \
  --max-input-tokens 256000
```

Optional `GITHUB_TOKEN` authenticates PR metadata requests only; the Git adapter supports public repositories. Running this command makes paid model calls. Normal repository checks do not.

## Read the result

Each intention has a `title`, associated `changeIds`, actual `before` and `after` behavior, `intendedOutcome`, `why`, and `issues`. Intended outcome describes the desired result; why explains its motivation. Both distinguish `stated` PR quotations, `inferred` explanations with evidence, and `unknown`. Behavior claims cite known changes or exact source bytes from the pinned base/head revisions. Code citations include source resolved by the host. An intention may overlap another; this is not the splitter's exactly-once hunk partition. Valid citations do not prove that the explanation is accurate.

Potential issues explain implementation or engineering decisions that introduce, worsen or make a problem relevant to the transition. Each has narrative `text`, `relevance`, nullable `uncertainty` and nonempty `citations`. Issues may cite both revisions, including unchanged callers, contracts and dependencies inspected through the existing tools. Unknown premises must be explicit; inferred purpose is not a new requirement. An empty issues array means no supported concern was reported, not that the PR is correct.

Use `PROVIDER=anthropic` to switch both writer and semantic reviewer together. Defaults live in `packages/llm/src/providers.ts`; the compiled CLI also accepts `--model` for pinned comparisons. Only the selected provider's key is required.

The `daphne-intentions-v3` artifact preserves:

- `provider`, `model`, `metadata`, `identity`, `changes`, collected `hunks` and acquisition `limitations`, including PR title/body and pinned commits.
- `investigation`: captured comparison, resolved run budget, request/memory capacities, retained evidence, hunk mappings, conversation-specific delivery receipts, tool records, completed writer/reviewer turns with their actual instructions, candidate attempts and diagnostics. `acceptedCandidate` selects the exact writer draft and its approving review; top-level `response` is that writer response. It is null when acquisition never reached the investigation.
- Top-level `proposal` and `response`: accepted output only when the whole run completes. A nested draft remains diagnostic if cleanup or publication subsequently fails.
- `modelCalls`: count/generation kind, sequence number within that kind, writer/reviewer role, candidate number, conversation ID, model, status, native `usage`, token-count endpoint `inputTokens`, and per-call timestamps/duration. Missing usage is null, not zero; it is not a cost estimate.
- `timing`: workflow start/end and elapsed milliseconds, including acquisition and cleanup but excluding artifact serialization/publication. `errors` contain safe stage/code/message descriptions without raw exception causes or configuration credentials.

V3 reviewer reports include source-to-text coverage accounting, targets for individual
issues and host-derived dimension statuses. Accuracy/citation defects in asserted
behavior, purpose or observations block even if advisory; other material findings
and omissions also block. Advisory presentation and rationale preferences remain
nonblocking. Acceptance concerns the explanation, so a supported account of a flawed
PR can pass. It does not certify the PR or guarantee issue discovery.

The eval loader accepts only v3. Old saved runs remain unchanged and require their
corresponding old reader or a fresh run. Relabeling a v2 artifact is not migration:
new required fields and strict review validation still apply.

Exit 0 requires a complete workflow and saved artifact. Exit 1 means invalid arguments, setup, acquisition, investigation, cleanup or publication failed. Handled failures preserve completed work where the filesystem permits; accepted top-level output is cleared. SIGINT/SIGTERM and any explicitly configured run deadline cancel ongoing work before Git cleanup and failed-report finalization. Cleanup/finalization may outlast the deadline. A publication failure triggers one attempt to save a failed report; if that also fails, stdout reports `output: null`. Files left by a failed publication are not a confirmed successful run. Artifacts are saved at finalization, with no crash recovery or resume.

The CLI accepts optional `--max-candidates N` and `--run-timeout-ms N` flags. Neither has a default; create one budget before acquisition and retain it through writer/reviewer calls, repairs, cleanup and publication checks. Each terminal writer draft consumes one candidate slot, and the final allowed draft still requires semantic acceptance. Tool continuations and reviewer requests consume actual resources without candidate slots. Without a deadline or cancellation, a conversation can continue indefinitely. Request capacities remain 256,000 input tokens by default, 16,384 output tokens, 8 MiB context/request bytes and 32 MiB retained evidence. Oversized requests fail without trimming history; these capacities are separate from total run effort. Use the compiled CLI directly to supply global budget flags. See the [intentions workflow](../../../packages/intentions/README.md), [review module](../../../packages/intentions/src/review/README.md) and [PR workflow](../../../packages/pr-review/README.md).

The existing `context inspect` and `split-pr` commands are documented in the [root README](../../../README.md).

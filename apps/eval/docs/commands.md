# Evaluation command guide

See the [package overview](../README.md) for the main commands, types and dependencies. Run the commands below from the repository root.

The Node evaluation application reads and validates manually maintained split-pr datasets, scores saved outputs offline, and runs reviewed cases through live Langfuse experiments. It also provides a manual Langfuse integration check. The smoke command's two test files live together in [`tests/smoke`](../tests/smoke/README.md).

## Validate manually maintained split-pr cases

The golden dataset in `datasets/split-pr/cases` is maintained manually. Evaluation commands only read its files. CLI/eval output writers reject destinations inside this directory, including symlink aliases, before creating output files or directories. Repository formatting excludes the gold directory.

Capture model output separately with `make split-pr PR=URL`; it saves one `run.json` and does not create or edit gold cases. Evidence is read from that run, with optional review metadata under `caseMetadata`. Missing metadata means a development draft. Validation defaults to repository-root `outputs/split_<gold filename>/run.json`; use `--artifact PATH` when the capture and gold names differ. Suite cases use the filename convention and must be registered manually. Validation is offline and checks consistency, not approval.

Use `bun run eval -- split-pr validate --case PATH [--artifact PATH]` for one case, or `bun run eval -- split-pr validate --suite PATH` for the registered suite. Validation prints JSON and changes no case, review status or suite entry. Invalid input exits nonzero.

Each case summary reports label counts and coverage: all possible unordered pairs, unlabeled pairs, labeled-pair rate, known-pair count/rate and units with or without known relationships. A known relationship is `together` or `separate`; `unknown` contributes only to labeled coverage. Rates are fractions from 0 to 1, or `null` when there are fewer than two units. Only explicit labels count; transitive relationships are checked for contradictions but do not inflate coverage. These counts describe annotations, including draft proposals, not semantic correctness or human approval. Partial annotation is allowed; there is no minimum coverage gate.

## Compare a saved split-pr run

```sh
make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json
```

This builds and compares the saved groups directly against one case, without reading a suite or rerunning the splitter. It loads evidence directly from the supplied artifact, validates label IDs and exact unit coverage, and applies the deterministic pair scorer. No model calls, Git/network verification, credential loading or Langfuse initialization occur. Case and artifact bytes remain unchanged.

Run `make split-pr-eval-all` to rerun the model for every JSON case in the gold folder and compare each fresh output with its labels. The target reads each PR URL from its existing `outputs/split_<case filename without .json>/run.json`, builds once, and saves the new runs under a unique `outputs/split-pr-eval-all.*` directory. Each case directory contains both `run.json` and a deterministic `eval.json` score report. It refuses to score a PR whose commits or frozen evidence differ from the saved capture and continues after errors. Missing captures, failed model runs and invalid comparisons make the batch exit nonzero; label disagreements retain the individual evaluator's successful exit status. The target makes paid model calls and leaves the gold files and reference captures unchanged.

By default, direct comparison trusts the selected artifact as the input reference; choose the capture the labels describe, since minimal gold files contain no independent commit fingerprint. Suite scoring separately checks candidate evidence against the configured reference run, normalizing capture-specific session IDs.

Draft references are allowed as provisional comparisons: the report retains the original `review` object with `provisional: true`. Reviewed references retain their reviewer and timestamp with `provisional: false`. This command never approves labels; live benchmarks and the suite-based `score` command still require reviewed cases.

The terminal prints the overall `Score` line, counting each known together/separate label equally, followed by any violated pairs. Each violation shows the expected relationship and both unit IDs. An optional JSON export includes review status, annotation coverage, per-relation rates, validation details and violated pairs. Use `--reference PATH` with the direct evaluator when the labels belong to an original capture and the candidate is a later run; `split-pr-eval-all` supplies this automatically. Unknown and unlabeled pairs are never scored. Zero support prints `N/A` and stores a null rate; it cannot establish perfect agreement. Structural validity and annotation coverage are not quality scores.

`@daphne/cli/command-output` provides the shared `formatCommandOutput(title, rows)` helper for human-readable commands. It aligns labels and applies bold green for success, yellow for warnings and red for errors, respecting terminal color support and `NO_COLOR`. The split command uses it when stdout is a terminal and retains JSON summaries when redirected. The evaluation Make target suppresses command echo while preserving errors. Other commands retain their JSON output contracts.

By default evaluation prints a summary and creates no file. To explicitly export JSON, use `OUTPUT=NEW_FILE` in an existing directory outside the capture folder. Publication refuses to overwrite existing files. The equivalent compiled command without an export is:

```sh
bun run build
bun run eval -- split-pr eval \
  --case apps/eval/datasets/split-pr/cases/pr_1.json \
  --artifact outputs/split_pr_1/run.json
```

The `daphne-split-case-eval-v1` report contains source paths, case/input/artifact hashes, reference annotation coverage, unchanged review metadata, provisional status, all per-pair scores and fresh proposal validation diagnostics. Saved validation claims are ignored; the accepted proposal must also match the final grouping attempt.

The eval CLI exits `0` after a structurally accepted comparison, even when every known pair is violated or there are no known labels. Exit `1` means malformed/inconsistent inputs, a failed saved run, invalid predicted coverage/shape, cancellation or publication failure (Make propagates failure as a nonzero exit). Failed runs and invalid output can still export diagnostic reports with `status: "failed_run"` or `"invalid_output"` and null pair scores/rates. A completed comparison has `status: "complete"`; that status is not a quality verdict. Malformed inputs and mismatched evidence fail before publication.

## Upload saved batch scores to Langfuse

After `make split-pr-eval-all`, use the directory printed as `Fresh model runs`:

```sh
make split-pr-langfuse-upload RUN_DIR=outputs/split-pr-eval-all.XXXXXX
```

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in the environment or root `.env`. This explicit command reads the batch's `run.json` and `eval.json` files, recomputes every score against the registered gold case and original reference capture, and requires a report for every suite case before making a network call. It does not call the model. Old batches without `eval.json` can be scored offline with `split-pr eval --case ... --artifact ... --reference ... --output ...`; no model rerun is needed.

The `daphne-split-pr-saved` experiment receives case IDs and input hashes, expected pair labels, predicted group unit IDs, eight item scores and an `accepted_rate` run score. Per-item metadata includes the model, scorer inputs, review state and `provisional: true` for draft labels. Raw `run.json` content, model replies and source evidence stay local. Experiment task timing reflects the upload only; it is not original model latency or cost. Treat draft scores as exploratory until the labels are reviewed.

The uploader creates `langfuse-upload-attempt.json` before contacting Langfuse and writes `langfuse-upload.json` with the experiment link only after complete results and telemetry finalization. An attempt marker blocks another upload of the same directory, including after an uncertain network failure. If a failure leaves only the attempt marker, inspect the remote experiment by its saved `runName` before deciding whether to retry from a new copy of the batch. This guard prevents an accidental second upload; it cannot make remote writes transactional.

## Score a reviewed suite case

```sh
bun run build
bun run eval -- split-pr score \
  --suite apps/eval/datasets/split-pr/suite.json \
  --case-id YOUR_REVIEWED_CASE \
  --artifact outputs/YOUR_RUN/run.json \
  --output outputs/reviewed-case-scores.json
```

The selected case must be reviewed and registered in a valid suite. Every listed gold file and its configured reference run must be available locally. Direct-case comparison also supports drafts without granting approval. The command validates the v3 artifact's frozen evidence against the case's input hash, then uses the public split validator to recompute proposal shape and exact unit coverage. Saved validation claims are ignored. The source artifact remains unchanged, and the output must be a new file in an existing directory.

Each pair receives `1` when its expected relationship holds, `0` when violated, or `null` when unknown or unavailable. Together and separate rates have distinct denominators; unknown and unlabeled pairs contribute to neither. A class with no labels has a null rate. Failed runs and invalid proposals are unaccepted and have unavailable pair scores/rates; a retained valid reply cannot rescue a failed run. With scorer `split-pairs-v2`, `constraintsPassed` requires an accepted output, at least one known pair and satisfaction of every known pair. Earlier v1 reports treated zero known pairs as vacuously passing; v2 preserves pair rates but removes that misleading pass.

The versioned report includes all pair results, violated pairs, fresh validation diagnostics, first-reply/correction information and case/input/dataset/artifact hashes. It is also printed as JSON. Exit `0` means evaluation and report publication completed, even when the output scores poorly. Exit `1` means invalid evaluation inputs, an inconsistent artifact, cancellation or output failure. The command does not fetch Git, make model calls or initialize Langfuse. Scores measure agreement with the approved labels; they do not establish buildability or semantic correctness beyond those constraints.

## Run reviewed split-pr evaluations

```sh
bun run build
bun run eval -- split-pr run \
  --suite apps/eval/datasets/split-pr/suite.json \
  --partition development \
  --output outputs/split-pr-eval-first \
  --trials 1 \
  --concurrency 1
```

This explicitly calls OpenAI and writes experiments to Langfuse. Configure `OPENAI_API_KEY` and the three Langfuse variables below in your environment or root `.env`. Defaults are model `gpt-6.1-sol`, input budget `16384`, three independent trials and concurrency `2`; override them with `--model`, `--max-input-tokens`, `--trials` and `--concurrency`. The partition is required, every selected case must be reviewed, and the output directory must be new with an existing parent. Validation happens before credential loading or telemetry. The run uses frozen evidence without fetching GitHub or exposing labels to the splitter.

Each trial number creates one native experiment, with one item per selected case. Item scores are `completed`, `accepted`, `constraints_passed`, `together_rate`, `separate_rate`, `corrections`, `count_calls` and `generate_calls`. Unavailable rates use categorical `not_applicable`. The run's `accepted_rate` includes every scheduled case in its denominator, including missing or failed work. Acceptance means structurally valid output; `constraints_passed` additionally checks the reviewed relationships.

Langfuse stores the original compact evidence once as item input, reviewed labels as expected output, and only status plus proposal or sanitized error as output. Child `semantic-split`, `openai.count` and `openai.generate` observations record durations. Generations carry the actual response model and provider token usage, including usage from rejected replies. Cached input and reasoning output use separate, non-overlapping buckets. Count-endpoint estimates are not consumed tokens. Cost comes from matching Langfuse model prices; missing usage or prices means unavailable cost, never verified zero. Raw responses, replay items and repeated page text stay local.

The output directory contains an initial `scheduled.json`, full `trial-N-case-M.json` artifacts, and a final `manifest.json` with scores, hashes, Git commit/dirty state, prompt/schema hash, model configuration, SDK version and experiment links. Files are published without overwriting. Cancellation preserves completed work and every scheduled entry, including unstarted rounds. These artifacts support later regrading; they do not provide crash resume. A dirty-state flag identifies an uncommitted build but is not a source-code snapshot.

Exit `0` means all scheduled results, scores and telemetry finalization were accounted for, even when model quality is poor. Exit `1` means invalid configuration, cancellation, missing results/scores, artifact publication failure or a reported telemetry failure. The JSON summary separates quality failures from incomplete evaluation. Finalization failure retains local results and marks the manifest incomplete. Draft cases require review before live benchmarking; validation does not grant human approval. Agreement with a small reference set is not a general quality estimate. General regrading and reference/candidate comparisons remain future work.

## Run the smoke experiment

From the repository root, put these values in your ignored `.env` or export them. [.env.example](../../../.env.example) lists blank placeholders; preserve existing `.env` contents.

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` — an explicit absolute HTTP(S) URL without embedded credentials, query or fragment.

```sh
bun install --frozen-lockfile
bun run build
bun run eval -- langfuse-smoke
```

Each invocation writes a new `daphne-langfuse-smoke` experiment to the configured instance. Its JSON summary includes `experimentUrl`, expected/returned case counts, both `exact_match` scores and `all_cases_pass`. Open the URL to inspect the two observations and confirm the scores arrived. No hosted dataset is created.

Exit `0` requires both case IDs exactly once, each required score exactly once, all three scores equal to `1`, an experiment URL, no cancellation and no reported SDK/export failure. Missing/duplicate cases and rejected evaluators cannot disappear from the success denominator. A score of zero is a recorded quality failure, not missing evaluation. Exit `1` means configuration, execution, scoring, cancellation or telemetry finalization failed. An already computed summary remains visible with failed status if finalization fails. Credentials and raw provider errors are not printed.

SIGINT/SIGTERM request cancellation. The command waits for the native runner and cleanup to settle before exiting unsuccessfully; the SDK has no experiment-level abort parameter. The five-second SDK timeout applies per supported manager/export request. Direct API calls and retries have their own defaults; this is not a whole-command deadline.

## Code ownership

- `src/main.ts` owns command dispatch, signals and final stdout/exit status; only explicitly live commands load `.env`.
- `src/split-pr` owns frozen dataset contracts, evidence and label validation, fingerprints, pure scoring, saved-run evaluation, uploads and live experiments. Its `langfuse-scores.ts` maps split scores for both live experiments and saved uploads.
- `src/parse.ts` provides JSON reading, primitive validation, hashing and the app's `EvaluationError`; case-specific validation stays with each evaluation.
- `src/artifacts.ts` publishes complete JSON files without overwriting existing files and preserves golden-dataset write protection.
- `src/model-calls.ts` records model-call observations, normalizes OpenAI usage and checks workflow call accounting. It also owns the recorded-call and token-usage types.
- `src/langfuse.ts` validates the explicit connection and owns one client/provider lifecycle across a command's experiments.
- `src/langfuse-diagnostics.ts` captures SDK/OTel errors that are logged without rejecting export promises. Logger changes are scoped to this command; do not embed this lifecycle alongside another telemetry provider.
- `src/experiment-completeness.ts` checks case identity and required-score accounting independently of score quality for live experiments, saved uploads and the smoke command.
- `tests/smoke/langfuse-smoke.ts` runs the manual integration check and returns a summary, printed only after finalization.

The build includes these smoke files because the command imports them. It preserves the folder structure under `dist/`; the command entry point is `dist/src/main.js`. Building and typechecking the files does not execute the smoke check.

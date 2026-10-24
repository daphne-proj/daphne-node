# Evaluation application

The Node evaluation application provides offline split-pr dataset import, validation and saved-run scoring, plus a manual Langfuse integration check. Baseline commands and model experiments are not implemented yet. The smoke command's two test files live together in [`tests/smoke`](tests/smoke/README.md).

## Import and validate split-pr cases

```sh
bun run build
bun run eval -- split-pr import --artifact outputs/split-pr-20261023-192117-87636/run.json --case-id my-case --output /existing/parent/my-case.json
bun run eval -- split-pr validate --suite apps/eval/datasets/split-pr/suite.json
```

Import creates a draft case and refuses to overwrite files. Register its relative filename in your suite explicitly. Validation exits `0` for a structurally valid suite, including drafts, and `1` for malformed evidence or contradictory labels. These commands require no credentials and do not initialize telemetry or make network calls. See the [dataset guide](datasets/split-pr/README.md) for annotation, fingerprints and the first imported case.

## Score a saved split-pr run

```sh
bun run build
bun run eval -- split-pr score \
  --suite apps/eval/datasets/split-pr/suite.json \
  --case-id pr-review-test-2 \
  --artifact outputs/split-pr-20261023-192117-87636/run.json \
  --output outputs/pr-review-test-2-scores.json
```

The selected case must be reviewed. The command validates the v3 artifact's frozen evidence against the case's input hash, then uses the public split validator to recompute proposal shape and exact unit coverage. Saved validation claims are ignored. The source artifact remains unchanged, and the output must be a new file in an existing directory.

Each pair receives `1` when its expected relationship holds, `0` when violated, or `null` when unknown or unavailable. Together and separate rates have distinct denominators; unknown and unlabeled pairs contribute to neither. A class with no labels has a null rate. Failed runs and invalid proposals are unaccepted and have unavailable pair scores/rates; a retained valid reply cannot rescue a failed run. `constraintsPassed` requires an accepted output satisfying every adjudicated pair. With no adjudicated labels this is vacuously true, so always inspect the reported support counts.

The versioned report includes all pair results and reasons, violated pairs, fresh validation diagnostics, first-reply/correction information and case/input/dataset/artifact hashes. It is also printed as JSON. Exit `0` means evaluation and report publication completed, even when the output scores poorly. Exit `1` means invalid evaluation inputs, an inconsistent artifact, cancellation or output failure. The command does not fetch Git, make model calls or initialize Langfuse. Scores measure agreement with the approved labels; they do not establish buildability or semantic correctness beyond those constraints.

## Run the smoke experiment

From the repository root, put these values in your ignored `.env` or export them. [.env.example](../../.env.example) lists blank placeholders; preserve existing `.env` contents.

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

- `src/main.ts` owns command dispatch, signals and final stdout/exit status; only the live smoke branch loads `.env`.
- `src/split-pr` owns frozen dataset contracts, validation, fingerprints, import, pure scoring, saved-run evaluation and safe file publication.
- `src/langfuse.ts` validates the explicit connection and owns one client/provider lifecycle across a command's experiments.
- `src/langfuse-diagnostics.ts` captures SDK/OTel errors that are logged without rejecting export promises. Logger changes are scoped to this command; do not embed this lifecycle alongside another telemetry provider.
- `tests/smoke/experiment-completeness.ts` checks case identity and required-score accounting independently of score quality.
- `tests/smoke/langfuse-smoke.ts` runs the manual integration check and returns a summary, printed only after finalization.

The build includes these smoke files because the command imports them. It preserves the folder structure under `dist/`; the command entry point is `dist/src/main.js`. Building and typechecking the files does not execute the smoke check.

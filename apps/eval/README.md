# Evaluation application

The Node evaluation application currently provides a manual Langfuse integration check. Its two test files live together in [`tests/smoke`](tests/smoke/README.md), whose README explains their roles and links the official Langfuse documentation. It makes no model calls and does not evaluate semantic splitting.

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

- `src/main.ts` owns command parsing, `.env`, signals and final stdout/exit status.
- `src/langfuse.ts` validates the explicit connection and owns one client/provider lifecycle across a command's experiments.
- `src/langfuse-diagnostics.ts` captures SDK/OTel errors that are logged without rejecting export promises. Logger changes are scoped to this command; do not embed this lifecycle alongside another telemetry provider.
- `tests/smoke/experiment-completeness.ts` checks case identity and required-score accounting independently of score quality.
- `tests/smoke/langfuse-smoke.ts` runs the manual integration check and returns a summary, printed only after finalization.

The build includes these smoke files because the command imports them. It preserves the folder structure under `dist/`; the command entry point is `dist/src/main.js`. Building and typechecking the files does not execute the smoke check.

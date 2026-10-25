# Langfuse smoke check

This manual integration check verifies Daphne's Langfuse setup. It runs two predictable calculations, `2 + 3 = 5` and `4 + 7 = 11`, so no AI model or PR is needed. It does not measure semantic-split quality.

## When it runs

Only when explicitly requested. From the repository root, configure `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in your ignored `.env` or environment, then run:

```sh
bun run build
bun run eval -- langfuse-smoke
```

`bun run check` and `bun run test` do not execute this check. Each smoke invocation sends synthetic inputs, outputs, scores and traces to the configured Langfuse instance. It creates a new experiment, without creating a hosted dataset.

## What the files do

- [`langfuse-smoke.ts`](langfuse-smoke.ts) runs the calculations with `client.experiment.run()`. Each correct answer receives `exact_match = 1`; both passing gives `all_cases_pass = 1`. This follows Langfuse's documented [task, evaluator and run evaluator](https://langfuse.com/docs/evaluation/experiments/data-model#function-definitions) structure. The arithmetic and score names are our choices.
- [`experiment-completeness.ts`](../../src/experiment-completeness.ts) is shared with the evaluation commands and checks that both calculations returned exactly once with the required scores. If the first calculation appears twice and the second is missing, it reports both problems. This is our validation helper, not a Langfuse requirement. The SDK supports [isolating individual failures](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk#experiment-runner-sdk), so a returned experiment alone does not prove all work succeeded.

The command waits for reporting cleanup before printing its JSON summary, following Langfuse's [OpenTelemetry setup and shutdown guidance](https://langfuse.com/docs/evaluation/experiments/experiments-via-sdk#basic-usage). Exit `0` means the local checks passed; exit `1` means a failure was detected. Open `experimentUrl` from the summary to confirm both results and their scores arrived in Langfuse.

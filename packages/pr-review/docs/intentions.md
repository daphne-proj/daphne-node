# PR intentions workflow

`analyzePullRequestIntentions(ref, options)` resolves PR metadata, explicitly maps repository URLs and commits into Git acquisition, and collects the complete change inventory and exact hunk sources. It calls [`runIntentions`](../../intentions/README.md) with a borrowed evidence executor. Git stays open until investigation finishes because the agent may search or read changed and unchanged files in either pinned revision; BASE is the merge base. The workflow closes the snapshot in `finally`, including after cancellation or failure.

Options are `IntentionsOptions` without `executeTool`, plus optional `githubToken`. The calling app supplies `apiKey`, `model`, `signal`, `maxInputTokens` and optional `onModelCall`; it also owns the overall deadline. GitHub, Git and evidence retrieval retain their existing default limits. Intentions owns its model and context budgets. For example, an app with a parsed `ref` and configured `options` can call:

```ts
import { analyzePullRequestIntentions } from '@daphne/pr-review/intentions';

const result = await analyzePullRequestIntentions(ref, options);

if (result.status === 'complete') {
  displayCards(result.proposal.intentions);
}
```

The result retains `metadata`, pinned `identity`, `changes`, raw `hunks` and acquisition `limitations`. Metadata and identity stay null until acquired. `investigation` is null until the agent returns; otherwise it retains the agent's evidence ledger, hunk mappings, delivered evidence IDs, tool records, turns, budgets, call counts and diagnostics. Its limitations also include incomplete or unavailable optional retrieval. These fields remain available on failure so the caller can publish an inspectable report.

Additions and deletions retain their existing file side; renames, empty files and metadata-only changes remain in the inventory. Non-text changes receive an `unsupported_change` limitation and metadata-only hunk entry. Required text hunk reads must succeed: a failed read stops acquisition and returns the inventory and all previously collected hunks without invoking the agent. An uncancelled empty comparison returns no cards and makes no model requests.

Top-level `status: 'complete'` requires both a complete investigation and successful cleanup. Otherwise `proposal` and `response` are null, and `errors` retains each surfaced error tagged with its `acquisition`, `investigation` or `cleanup` stage. A valid proposal inside `investigation` remains a diagnostic draft if cleanup fails or cancellation arrives during cleanup; callers must check the top-level status before accepting it. Cleanup does not reuse the cancelled operation signal. Before a snapshot is returned, Git acquisition owns its own cleanup; its existing API may surface only the cleanup error if acquisition and internal cleanup both fail.

Callers that already have pinned evidence and a live executor can use `runIntentions` directly from `@daphne/intentions`; they then own acquisition and cleanup. Neither entry point loads environment configuration, writes artifacts, owns process exit or establishes Rust parity. Citation validation establishes provenance, not explanation quality or author motivation.

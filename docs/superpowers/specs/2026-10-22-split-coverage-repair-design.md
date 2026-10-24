# Split coverage and bounded repair

Status: the conversation approved this approach; the linked implementation plan is awaiting review. No implementation is authorized by this document alone.

## Goal and scope

Make the experimental `split-pr` command validate every model proposal against the original Git change inventory and continue correcting invalid proposals within one logical conversation. Accept a proposal only when its structure is valid and every expected unit appears exactly once. Stop explicitly when correction attempts or resources are exhausted.

This is coverage validation. It does not establish semantic grouping quality, dependency independence, patch applicability, source-fragment byte completeness or Rust migration parity. Keep existing whole-hunk grouping, metadata-only changes, exact evidence and independent page analyses. Do not add hashing, diff reconstruction, structured page summaries, dependency graphs, an additional reviewer model, packages, dependencies or CLI flags.

## Current behavior

At branch `feat/split-pr`, commit `8f02e38`, `apps/cli/src/split-pr.ts` collects exact hunks, pages them, and generates a grouping directly from one page or from analyses of multiple pages. `parseProposal` rejects missing, duplicate and unknown IDs, but its expected IDs come from emitted pages. An invalid final reply is lost when parsing throws before the reply reaches the report.

`apps/cli/src/openai.ts` uses HTTP Responses requests with `store: false`, no conversation replay, a 120,000 ms timeout per request and 4,096 maximum output tokens. The provider returns control to the application after each generation.

## Decisions

### Authoritative inventory

Derive expected IDs from the complete `report.changes` returned by `listSnapshotChanges`, before pagination. Preserve the existing ID convention: `${change.id}:${zeroBasedHunkIndex}` for every text hunk, or `${change.id}:metadata` for non-text changes and text changes with no hunks. Actual example: `change-1:0`.

After exhausting pagination successfully, compare distinct page IDs with the inventory. Missing or unknown page IDs are host/evidence failures: stop before page analysis or grouping rather than asking the model to repair absent input. Repeated IDs across pages are legitimate fragments. Consume every page; do not deduplicate its content or analysis. An empty inventory with no pages succeeds without generation.

Validate JSON and proposal structure first. Only structurally valid proposals receive coverage analysis. Report all missing, duplicated and unknown IDs in one result; keep missing IDs in inventory order and duplicate/unknown lists in first-occurrence order. A repeated unknown ID may appear in both diagnostic lists. Preserve existing group/title/warning constraints. Invalid JSON, invalid structure and coverage errors are repairable; successful proposals retain the existing groups/warnings shape.

### One local conversation

Use the documented manual conversation-state approach: retain the initial grouping input, provider output items and correction messages locally, passing accumulated input into each request with `store: false`. No server-managed conversation, `previous_response_id`, session framework or SDK is required.

Preserve complete replayable provider output items in order, including returned encrypted reasoning and assistant phase; do not rebuild history from extracted answer text. Keep existing model/effort settings. Preserving returned items does not promise model-specific reuse of earlier hidden reasoning. Resend grouping instructions and the structured-output schema on every turn.

Page analyses remain separate requests. The final grouping conversation starts with the existing raw-page input or existing page notes. A correction appends deterministic validation errors and asks for a complete replacement proposal. For missing or duplicated known IDs, add all original pages containing those units that are not already present as raw evidence in the conversation. Preserve page order and every fragment. Unknown IDs have no source to retrieve. JSON/shape errors need correction instructions and the retained draft, without guessing which evidence was omitted.

### Loop and stop policy

The controller runs an ordinary loop: generate, record the received draft, validate, then either accept or append a correction and repeat. It always revalidates the entire replacement against the same inventory. It never automatically assigns missing units or accepts the model's declaration of completeness.

- Allow three correction attempts after the initial proposal: at most four grouping generations. Page-analysis calls and token-count calls are outside that generation limit.
- Stop immediately on the first valid proposal, including one returned on the fourth generation.
- After an invalid fourth proposal, stop with failure and retain its diagnostics. No fifth generation.
- Provider errors, refusals, incomplete responses, cancellation, timeout, token-count failures and input-budget failures are terminal; they are not coverage-repair attempts. Add no transport retry policy.
- Count the complete next request, including accumulated history, instructions and output schema, against `--max-input-tokens`. Apply the existing 65,536-byte ceiling to serialized conversation input. A counted single-page request may reuse its count only when its representation is identical.
- Do not trim history, silently omit evidence, increase limits or switch to a fresh conversation to force a retry. Budgets can stop correction before three attempts; no capacity for a retry is guaranteed when the initial request nearly fills the budget.

The serialized-input byte ceiling is conservative: wrappers and returned opaque items count too. It can reject a conversation even when its raw evidence pages individually fit. Report this explicitly rather than modifying the shared pager's contract.

### Reports and failure behavior

Use `daphne-split-pr-v3` when the full repair workflow lands. Retain existing artifact fields and add `maxCorrections: 3` and an ordered `attempts` array. Every completed grouping reply records its one-based number, input token count, extracted answer text, raw provider response and validation result before another asynchronous operation can fail.

Set top-level `proposal` and `response` only on accepted success. On failure, leave them null and preserve completed attempts, evidence, page analyses and the terminal error. Keep `status: 'complete' | 'failed'`, exit 0 only on success and exit 1 on failure. Existing `calls` counters continue counting actual attempted provider requests. Artifacts are saved through the existing finalization path after handled failures; crash recovery and durable checkpoints are out of scope.

## Repository constraints

- Use Node `24.22.0` and Bun `1.4.3`; Bun installs/runs scripts, Node is the runtime.
- Add no packages, dependencies or CLI flags; keep implementation local to `apps/cli` and leave context-engine/review-evidence public contracts unchanged.
- Do not write or modify tests unless explicitly requested; run existing checks and report missing regression coverage.
- Preserve strict typing, `.js` relative imports, public workspace exports, source bytes, identifiers and deterministic ordering.
- Format changed files, run `bun install --frozen-lockfile` and `bun run check` for implementation, and independently review nontrivial changes before completion.
- Keep paid model calls opt-in; planning and normal checks do not invoke the provider.

## Alternatives and documentation

We selected deterministic ID comparison over rebuilding/hashing diffs: the model returns references to unchanged evidence, and ID diagnostics identify the exact repair target. We selected bounded local conversation replay over an unconditional second reviewer or a persistent session service. Three corrections are a project policy, not a provider default.

Official references checked on 2026-10-22:

- [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state): manual history replay and separate model requests form a multi-turn conversation.
- [Reasoning without stored responses](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses): retain returned reasoning items for stateless continuation; current documentation describes encrypted content as automatic with `store: false`.
- [Input-token count API](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens/methods/count): count item-array input with instructions, reasoning settings and text configuration. Generation-only fields stay out of the count request.
- [Coverage-controlled workflow](https://developers.openai.com/cookbook/examples/agents_sdk/security_scanners_with_agents_sdk): application code gates completion on coverage and bounds the loop's turns. We reuse the control pattern without introducing that SDK.

Implementation plan: [three progressive tasks](../plans/2026-10-22-split-coverage-repair.md).

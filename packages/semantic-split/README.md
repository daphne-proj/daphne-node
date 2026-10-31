# Semantic split

`@daphne/semantic-split` groups a PR's changes by **intention**: edits that serve one purpose belong together even across files, while unrelated purposes stay separate. It owns prompts, grouping history and proposal validation; `@daphne/evaluator-optimizer` owns iteration and the shared run budget. PR acquisition, Git cleanup and artifact persistence belong to its callers, including PR review and evaluation.

## Main APIs

| API                                       | Purpose                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `runSemanticSplit(input, options)`        | Turn supplied evidence into a validated proposal, retaining completed work on success or failure. |
| `getExpectedUnitIds(changes)`             | Derive one unit per text hunk, or one metadata unit for a change without text hunks.              |
| `validateProposal(text, expectedUnitIds)` | Check JSON, proposal shape and exactly-once coverage independently of model claims.               |

The package also exports its prompts and the generated plain `proposalSchema` so callers can inspect or fingerprint the exact request. The workflow has no fixed correction count.

## Main types

- `SemanticSplitInput` / `SemanticSplitOptions`: pinned identity, inventory and hunk evidence, plus model credentials, a per-request token limit, a shared `RunBudget` and callbacks.
- `Proposal` / `ProposalValidation`: intention groups with titles, reasons and unit IDs, or actionable validation diagnostics.
- `PageAnalysis` / `SplitAttempt`: each page's optional model notes and each completed grouping reply with its validation result.
- `SemanticSplitResult`: complete or failed output retaining the resolved budget snapshot, pages, attempts and call counts; failure carries an error and null accepted proposal/response.

## How it works

1. Ask context-engine to pack the exact diff into pages within request limits, then check their unit IDs against the original inventory.
2. Group a single page's raw diff directly. For several pages, generate separate notes with unit IDs, then group from all notes. A single-page run has no page analysis.
3. Produce and synchronously validate each proposal, retaining that reply even when cancellation arrives immediately afterward. The shared runner accepts a valid proposal or requests a complete replacement with diagnostics. Missing or duplicated known IDs also bring in every relevant original page/fragment not yet supplied as raw evidence, in page order. Unknown-only failures add no evidence pages. Complete provider output is replayed unchanged.

`context-engine` supplies `splitDiffIntoContextPages`; `llm` supplies `createOpenAI` for complete-request token counts, generation and replayable output. Only the identical initial single-page grouping request reuses the pager's count; analysis and revision requests are counted separately. `review-evidence/contracts` supplies data types without repository I/O. The workflow performs no direct Git or filesystem operations.

## Run policy

Hosts create one budget with `createRunBudget(policy, callerSignal)` before preparation, then pass it as `options.budget` through acquisition, paging, analysis, grouping and accepted-output publication. The optional policy fields are `maxCandidates` and `timeoutMs`; neither has a default. Page analyses and token-count requests do not consume candidate slots, but they share the deadline. An explicitly configured final candidate is still evaluated. Cancellation, exhaustion and provider failures retain completed work without accepting a draft. Empty input completes without model calls unless cancelled.

The CLI's `split-pr` command and eval's `split-pr run` command expose `--max-candidates N` and `--run-timeout-ms N`. Each concurrent eval case resolves a fresh budget from the same experiment policy when its task begins. Results and artifacts record `{ maxCandidates, deadlineAt }`, using `null` for unset limits; the signal is never serialized. Current readers require this shape. Historical artifacts are unchanged research records and are not accepted as current inputs.

Per-request token and conversation-byte limits remain independent capacity constraints. Completed page notes and attempts remain available to callers; the CLI stores them in `run.json` even when publication is cancelled.

## Proposal schema

Zod **4.6.7** owns the strict root/group shape in `src/schema.ts`, the inferred `Proposal` type and the generated request schema. Titles must contain a non-whitespace character, each group's unit list must be nonempty, and unknown fields are rejected. Reasons and warnings may still be empty strings. Parsing does not trim, coerce or transform any text.

`validateProposal` decodes JSON, parses that shape and then checks exactly-once coverage against the original inventory. Missing IDs retain inventory order; duplicate and unknown IDs retain first-seen order. A structurally valid empty proposal is valid for an empty inventory. Zod does not prove coverage or grouping quality, and this workflow does not establish Rust migration parity.

Native [Zod JSON Schema generation](https://zod.dev/json-schema) exports the same schema used for token counts, generation and eval prompt hashing. Its required fields, strict objects, string pattern and minimum array size were inspected against the [OpenAI structured-output subset](https://developers.openai.com/api/docs/guides/structured-outputs). Live provider acceptance remains unverified; no model calls are needed to build or inspect the schema. The common runner and CLI/eval packages have no direct Zod dependency.

See the [workflow](src/workflow.ts), [contracts](src/contracts.ts), [proposal validator](src/proposal.ts) and [architecture](../../docs/architecture.md) for details.

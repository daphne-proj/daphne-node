# PR Intentions Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce ordered, evidence-backed intention cards explaining what a PR changes and why.

**Architecture:** `intentions` owns the single-agent investigation. `pr-review/intentions` owns acquisition and Git lifetime; existing evidence tools supply code, context-engine retains and assembles it, and review-agent handles the model.

**Tech Stack:** Node 24.22.0, Bun 1.4.3, TypeScript 6.0.3, existing OpenAI Responses HTTP adapter; no new external dependency.

**Spec:** [Agreed flow and ownership](../specs/2026-10-25-intentions-agent-design.md). Read it with [architecture](../../architecture.md), [migration status](../../migration/README.md), and ADRs [0002](../../adr/0002-context-engine-boundary.md) / [0003](../../adr/0003-reusable-pr-split-workflow.md).

## Global Constraints

- Keep semantic-split's algorithm, prompts, defaults and artifact contract unchanged. Intentions may overlap and do not require exactly one intention per hunk.
- Context-engine receives supplied data only. Review-agent imports no workspace package. Environment loading, files, telemetry and process exit stay in apps.
- Use public exports, `workspace:*`, and `.js` relative imports. Preserve pinned commits, exact UTF-8 byte ranges, ordering and cleanup errors.
- Add no tests unless separately requested; only repair existing tests if an intentional new contract breaks them. Run existing checks. This repository rule overrides the skill's default TDD steps.
- Use focused files and plain `/* ... */` comments for non-obvious decisions. Update the owning README in the same task; explain the data flow, invariants and failure behavior, not every statement.
- No paid calls during normal checks. No Rust migration, UI, multi-agent system, index/graph work or generic evaluation framework.

## Review Focus

1. Tool-only turns retain their call IDs and reasoning items; ordinary splitter replies remain compatible (Task 2).
2. Larger configured packets survive every validation layer; oversized initial diffs fail explicitly (Tasks 1 and 4).
3. Wrong-side, unseen and invented evidence cannot become accepted citations; unknown rationale stays unknown (Task 4).
4. Line reads preserve UTF-8 and EOF semantics; added/deleted, renamed, empty and non-text changes remain represented with honest limitations (Tasks 3–5).
5. Cancellation, provider errors and Git cleanup failures preserve completed work and cannot publish success (Tasks 5 and 6).

These are manual review requirements, not claims of new automated coverage.

## Proposed contracts and budgets

- `runIntentions(input: IntentionsInput, options: IntentionsOptions): Promise<IntentionsResult>` accepts `{ identity, changes, hunks, pr: { url, title, body } }`. Reuse `ReviewIdentity`, `Change` and `DiffContextHunk`. Options provide `apiKey`, `model`, `signal`, `maxInputTokens`, `executeTool: (request: unknown) => Promise<ToolResult>`, and optional `onModelCall`. The caller keeps the borrowed executor alive until return.
- `IntentionsProposal` contains ordered `intentions` and `warnings`. Each intention has `title`, nonempty `changeIds`, `before`, `after`, and `why`. Before/after contain `text` and citations. Citations use `kind: 'code'` with `evidenceId` and an absolute `ByteRange`, or `kind: 'change'` with `changeId`. Why uses `basis: 'stated'` with text and `{ field: 'title' | 'body', quote }` citations, `basis: 'inferred'` with text and evidence citations, or just `basis: 'unknown'`. Require supporting citations for every known claim; absent file sides use change metadata.
- `IntentionsResult` retains evidence, hunk mappings, delivered evidence IDs, tool records, turns, validation diagnostics and call counts on both paths. `complete` has a proposal and nullable final response; `failed` has null accepted output and an error. Empty inventories return an empty proposal without generation. A completed proposal may carry explicit retrieval limitations.
- Proposed first-run defaults: CLI model `gpt-6-sol`, 256,000 input tokens per request, 16,384 maximum output tokens, 24 generations/tool executions, one final-output correction within that generation budget, and a 10-minute host deadline. `--max-input-tokens` can raise the input budget for a compatible model; these are application guardrails, not model capacity claims.
- Intentions uses 8 MiB packets and 32 MiB retained evidence; also cap the serialized complete model request at 8 MiB. Leave existing tool-page, Git/blob and splitter limits unchanged. Count the actual instructions, schema, tools and entire history before each generation. Exceeding any budget stops with retained diagnostics.

## Task 1: Make explicit context budgets work end to end

**Modify:** `packages/context-engine/src/{limits,evidence,assembly,engine}.ts`, `packages/context-engine/README.md`.

**Interface:** Keep existing calls valid. Extend `assembleContext(snapshot, input, limits?: ContextLimits)` and internal `captureSnapshot(value, maxRetainedBytes?)`; omitted limits retain current behavior.

- [x] Separate default limits from allowed upper bounds: retain 65,536 / 4,194,304-byte defaults; permit explicit packet/retention limits up to 8,388,608 / 33,554,432 bytes.
- [x] Pass resolved limits from `createContextEngine` through assembly and snapshot reconstruction. Remove the hidden default clamps in those paths; preserve atomic retention, conflict checks and omission reporting. Do not change `paging.ts`.
- [x] Comment why snapshot reconstruction must use the same retention allowance as the live ledger. Update the README with defaults versus explicit limits and the unchanged no-retrieval ownership rule.
- [x] Run `bun run check`; inspect both engine and standalone assembly call paths against Review Focus 2.

## Task 2: Support native tool turns without changing text-only callers

**Modify:** `packages/review-agent/src/{openai,index}.ts`, `packages/review-agent/README.md`. **Create:** `packages/review-agent/src/response.ts` for provider-output decoding, keeping transport in `openai.ts`.

**Interface:** Add optional `tools`, `parallel_tool_calls` and `max_output_tokens` to `ModelRequest`; add optional `functionCalls` to `ModelReply`. Each validated call has `id`, `call_id`, `name` and JSON argument text. Keep `createOpenAI`'s returned methods unchanged.

- [x] Send native function definitions to counting/generation; send the output cap only to generation, defaulting to the current 4,096 when absent. Count the same input-affecting fields used for generation.
- [x] Accept tool-only replies only for functions supplied by the request. Validate call identities, names and argument encoding; retain every accepted provider output item. Omit `functionCalls` entirely on ordinary replies so existing exact comparisons and test doubles remain valid.
- [x] Preserve refusal/incomplete handling, cancellation, observations and `store: false`. Request and replay encrypted reasoning when needed for tool continuation; keep argument interpretation and tool execution outside this package.
- [x] Comment the call-ID/replay requirement and the distinction between tool-only output and an empty final answer. Explain both in the README; follow the [official function-calling contract](https://developers.openai.com/api/docs/guides/function-calling).
- [x] Run `bun run check`; inspect existing adapter/splitter consumers against Review Focus 1.

## Task 3: Add line-based surrounding reads

**Create:** `packages/review-evidence/src/tools/lines.ts`.

**Modify:** `packages/review-evidence/src/contracts.ts`, `packages/review-evidence/src/tools/{validate,operations,execute}.ts`, `packages/context-engine/src/validation.ts`, and both packages' READMEs. Extend the existing executor and reuse its cursor codec and newline-offset helpers.

**Interface:** Add `read_source_lines` to `ToolRequest`, with `side`, `path`, one-based `startLine`, positive `lineCount`, and existing `cursor`/`maxBytes` fields. Keep byte-based `read_source` unchanged. Add a `source_window` navigation entry containing side/path, the resolved byte range, actual start/end lines, total lines and `eofClamped`; it describes the selected window, not every paginated fragment.

- [x] Resolve lines in review-evidence using existing blob reads and newline offsets, preserving original UTF-8 bytes and CRLF. Count an empty file as zero lines and a trailing newline as terminating its preceding line. For an empty file, a read from line 1 returns empty source and window bounds 0/0. Reject unsafe line arithmetic before reading.
- [x] Clamp an ending line beyond EOF and expose that fact in window metadata. A starting line beyond EOF returns an unavailable result with a notice giving valid bounds, allowing the agent to retry. Preserve the existing unavailable-content and cancellation behavior.
- [x] Reuse bounded source pagination and bind cursors to the normalized line request. Include the resolved window metadata on every page within the response budget. Individual source fragments retain exact byte references; do not insert line numbers into source text or describe a partial long-line fragment as the whole window.
- [x] Extend context validation to accept the new request and window entry, verify side/path and range consistency, and retain both through snapshot reconstruction. Line-to-byte translation stays in review-evidence; no retrieval enters context-engine.
- [x] Comment coordinate conversion and EOF behavior. Document searching, reading nearby lines, expanding reads, and continuing pages. Run `bun run check`; review Unicode, CRLF, empty files, EOF and long-line pagination under Review Focus 4.

## Task 4: Implement the intentions package

**Create:** `packages/intentions/src/{index,contracts,prompts,schema,proposal,context,tools,workflow}.ts`, `package.json`, `tsconfig.json`, `tsconfig.build.json`, `README.md`.

**Modify:** root `tsconfig.json`, `eslint.config.mjs`, `bun.lock`. The package declares context-engine, review-agent and evidence-contract dependencies; it never loads evidence retrieval or Git.

**Interface:** Export the contracts above and `runIntentions`. Export `validateIntentions(text: string, context: IntentionsValidationContext): IntentionsValidation`; context contains identity, inventory, captured PR text, retained sources and delivered IDs. Validation is `{ status: 'valid', proposal }` or `{ status: 'invalid', diagnostics: string[] }`.

- [ ] Implement schema and citation validation with the first real package behavior, then register its exports/build references. Validate model JSON at entry, referenced change IDs, source membership, revision side, UTF-8 bounds and PR quotation presence. Render snippets from retained bytes; structural validity does not prove semantic correctness.
- [ ] In `context.ts`, verify supplied hunks match the inventory, retain each source with `engine.retain`, and preserve its change/hunk mapping. Assemble all initial evidence and supply the complete inventory plus PR metadata in the same request. Fail on missing required hunk evidence, omitted sources or an oversized complete request.
- [ ] In `tools.ts`, expose `list_changes`, `inspect_change`, `search_code` and `read_source_lines` using provider-compatible schemas and forward calls through `executeTool`. Describe line reads as available across the entire pinned repository, including unchanged files. Use sequential calls (`parallel_tool_calls: false`). Record each returned page with `engine.record`; assemble its source evidence into the reply while retaining window metadata, cursor and notices. Out-of-range notices allow another read within the call budget. Track only actually delivered source IDs as citable; a search preview alone is insufficient.
- [ ] In `workflow.ts`, count, generate, record the turn, execute requested tools, append native results, and continue until a final proposal. Preserve all provider output for replay; reject reused call IDs and never accept text accompanying pending tool calls as final. Keep one bounded schema/citation correction, with provider, budget and cancellation failures stopping immediately. Count every attempted call and preserve previous work.
- [ ] Prompt for distinct PR-wide intentions and useful review order. Treat code/PR text as evidence, never instructions. Explain before/after from code and qualify inferred reasons. Preserve open/partial retrieval notices in the result, including non-text limitations.
- [ ] Add comments beside evidence visibility, before/after side checks, byte-range validation and failure retention. The README explains the loop, caller contract, budgets, example card and why code evidence does not prove author motivation. Add lint rules enforcing these owners and preventing lower packages from importing intentions.
- [ ] Run `bun install` for the workspace lock update, then `bun install --frozen-lockfile` and `bun run check`. Review Focus 2–4 at the public entry point.

## Task 5: Add the complete PR workflow

**Create:** `packages/pr-review/src/intentions.ts`.

**Modify:** `packages/pr-review/src/acquisition/pull-request.ts`, `packages/pr-review/{package.json,tsconfig.build.json,README.md}`, `eslint.config.mjs`, `bun.lock`.

**Interface:** Add validated `title: string` and `body: string | null` to `ResolvedPullRequest`. Export `analyzePullRequestIntentions(ref: PullRequestRef, options: IntentionsPullRequestOptions): Promise<IntentionsPullRequestResult>` only through `@daphne/pr-review/intentions`. Options are `IntentionsOptions` without `executeTool`, plus optional `githubToken`; the result retains nullable acquisition data, investigation progress and separate acquisition/investigation/cleanup errors.

- [ ] Acquire metadata and the pinned snapshot; collect the complete inventory and hunk sources using existing Git/evidence APIs. Map metadata explicitly into Git inputs. Preserve additions, deletions, renames and metadata-only changes. Unsupported non-text content gets a limitation; unavailable required text hunks fail acquisition with collected work.
- [ ] Call `runIntentions` with the borrowed evidence executor while the snapshot remains open. Close it in `finally` after investigation; cleanup failure makes the overall result failed even if a valid draft exists. Retain that draft in diagnostics. Acquisition failures also return collected work.
- [ ] Keep metadata root imports pure. Extend workflow lint restrictions to the new subpath without changing the splitter. Comment why this workflow keeps Git open; document ownership and the two entry points in the README.
- [ ] Update the lock and run `bun install --frozen-lockfile` and `bun run check`; inspect empty PR, unsupported content, cancellation and cleanup paths against Review Focus 4–5.

## Task 6: Expose inspectable CLI results

**Create:** `apps/cli/src/intentions.ts`, `apps/cli/README.md`.

**Modify:** `apps/cli/src/{main,errors}.ts`, root `README.md`, `Makefile`.

**Interface:** `intentions --pr URL --output NEW_DIRECTORY [--model MODEL] [--max-input-tokens NUMBER]`; `parseIntentionsArgs` validates arguments and `runIntentionsPr(options, signal): Promise<number>` owns command behavior.

- [ ] Reuse environment loading, cancellation, output formatting and artifact helpers. Combine the caller signal with the host deadline. Add the command and a matching `make intentions` convenience target.
- [ ] Write a `daphne-intentions-v1` `run.json`: PR metadata, pinned identity, limits, inventory, evidence/mappings, delivered IDs, tool requests/results, completed turns, diagnostics, final cards, native usage, timing and errors. Never serialize credentials or library configuration wholesale. Use a new output directory so comparison runs remain available.
- [ ] Print a compact TTY/JSON summary and artifact path; return 0 only for complete runs. Preserve a failed report on handled cancellation/publication failure using the existing artifact pattern.
- [ ] Comment why failed runs retain evidence and why accepted output is cleared on failure. Explain invocation, card fields, provenance, limits and artifact interpretation in the CLI README; link it from the root README.
- [ ] Run `bun run check`; review artifact publication and cancellation against Review Focus 5.

## Task 7: Document ownership and evaluate the result

**Modify:** `docs/architecture.md`, `docs/migration/README.md`, `packages/README.md`, `apps/eval/README.md`.

**Create:** `docs/adr/0004-pr-intentions-workflow.md`, recording this extension to the accepted ownership decisions.

- [ ] Document dependency direction, the borrowed executor, longer Git lifetime, context budget propagation and inference limits. Describe only implemented behavior; make no Rust parity claim.
- [ ] Add a short manual evaluation procedure for PRs 1–8 in `daphne-proj/pr-review-test`, using the new CLI and distinct output directories. Record pinned revisions, omissions, inaccurate before/after claims, unsupported reasons, duplicate/missing intentions, citation quality, tokens and latency. Reuse saved model observations; split pair labels cannot grade intentions. No new scorer or Langfuse orchestration is required for this first result.
- [ ] On an explicitly requested live evaluation, run those cases and record results alongside their artifacts. Compare repeated runs only with matching commits and captured PR metadata; saved diff-only fixtures cannot supply unchanged-code investigation. Otherwise report that live quality remains unverified.
- [ ] Format touched files, run `bun install --frozen-lockfile` and `bun run check`, and independently review runtime imports, public contracts, comments, READMEs and the five review concerns. Resolve findings before handoff; report the missing automated coverage honestly.

## Completion

The flow is ready for review when the public PR entry point and CLI produce inspectable cards or explicit failures, existing checks pass, and ownership/documentation agree with the implementation. Live explanation quality is a separate recorded result. Review this plan before implementation; no product code is authorized by this document alone.

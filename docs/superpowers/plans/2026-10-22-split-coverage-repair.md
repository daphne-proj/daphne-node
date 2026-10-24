# Split Coverage and Bounded Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate split proposals against the original Git inventory and correct invalid answers in one local conversation, with at most three corrections and explicit failure reporting.

**Architecture:** The CLI owns inventory validation, conversation history and the correction loop. A small CLI-local proposal module owns pure validation; the existing OpenAI adapter exposes replayable response items and counts complete requests. Page analyses and shared evidence/pagination packages retain their current responsibilities.

**Tech Stack:** Node 24.22.0, Bun 1.4.3, TypeScript/Node ESM, existing native-fetch Responses adapter and existing workspace packages; no new dependencies.

**Spec:** [Split coverage and bounded repair design](../specs/2026-10-22-split-coverage-repair-design.md). Read it with this plan. The user approved the approach and requested progressive implementation prompts; implementation starts only when a task is requested.

## Global Constraints

- Use Node `24.22.0` and Bun `1.4.3`; Bun installs/runs scripts, Node is the runtime.
- Add no packages, dependencies or CLI flags; keep implementation local to `apps/cli` and leave context-engine/review-evidence public contracts unchanged.
- Do not write or modify tests unless explicitly requested; run existing checks and report missing regression coverage.
- Preserve strict typing, `.js` relative imports, public workspace exports, source bytes, identifiers and deterministic ordering.
- Format changed files, run `bun install --frozen-lockfile` and `bun run check` for implementation, and independently review nontrivial changes before completion.
- Keep paid model calls opt-in; planning and normal checks do not invoke the provider.

## Review Focus

1. A textless/renamed/binary change or an entire unit missing from pages must not disappear from the expected inventory; Task 1 checks the inventory-to-page comparison.
2. A hunk spanning several pages must remain one assignment while retaining all fragments; Tasks 1 and 3 check page membership versus evidence selection.
3. A correction can introduce duplicates, unknown IDs or malformed JSON while fixing an omission; Tasks 1 and 3 validate the complete replacement every time.
4. Replayed output may include encrypted reasoning and assistant phase, and the full history can exceed budget; Tasks 2 and 3 preserve item fields and enforce request limits.
5. The last correction may succeed, or a later count/provider call may fail; Task 3 checks the generation limit, terminal state and preservation of prior attempts.

These are required manual validation/review cases, not permission to create tests. The existing CLI test only covers startup; a green repository check does not establish correction-loop regression coverage.

---

## File map and execution order

| File                                    | Responsibility                                                              | Tasks |
| --------------------------------------- | --------------------------------------------------------------------------- | ----- |
| Create `apps/cli/src/split-proposal.ts` | Expected unit IDs and pure proposal validation                              | 1     |
| Modify `apps/cli/src/split-pr.ts`       | Inventory preflight, request construction, correction loop and run artifact | 1–3   |
| Modify `apps/cli/src/openai.ts`         | Item-array requests and replayable provider output                          | 2     |
| Modify `README.md`                      | User-visible coverage, retry limits, output and failures                    | 1–3   |
| Modify `docs/architecture.md`           | CLI ownership and conversation lifecycle                                    | 2–3   |
| Modify `docs/migration/README.md`       | Final experimental workflow scope and verification limitations              | 3     |

Tasks run sequentially. Task 1 improves the current single-attempt behavior. Task 2 puts the real grouping request on the documented conversation representation while retaining one generation. Task 3 activates bounded correction and the versioned attempt history. Do not extract another framework or create speculative packages. Existing `main.ts`, argument parsing, Makefile and library exports need no changes.

Before each task, inspect the current diff and read `AGENTS.md`, the Daphne TypeScript/readability skills, `docs/agents/typescript-quality.md`, and this spec. Read architecture/ADR 0002 before altering ownership. Baseline inspected: `feat/split-pr` at `8f02e38`; use symbols below if line numbers move.

## Verification procedure for every task

The shell observed during planning has Node 22.23.3 and Bun 1.1.20. Activate or locate the repository-pinned versions before installation/checks; do not change pins to match the shell. If unavailable, report the blocked checks rather than claiming success.

Run `node --version` and `bun --version`; expect `v24.22.0` and `1.4.3`. Then run `bun install --frozen-lockfile`, use the task's formatting command, and run `bun run check`; expect exit 0 for all gates. Use `bun run test`, never `bun test`, if running the existing test suite separately.

Use interactive Node inspection of the compiled exports for the small pure-input examples below; do not add test files, fixture files, persistent smoke scripts or test-only production hooks. Review provider/loop scenarios against the implementation and, when available, an explicitly authorized live run. Record scenarios that could not be exercised; never imply that static review or bootstrap checks demonstrated model correction.

Each task ends with an independent code review, `git diff --check`, and a report of actual checks and limits. Stop before the next task. Commit checkpoints are optional and require existing user authorization; suggested messages are supplied below.

### Task 1: Validate against the original inventory

**Files:** create `apps/cli/src/split-proposal.ts`; modify `apps/cli/src/split-pr.ts` (`Proposal`, `parseProposal`, `proposeGroups`, `runSplitPr`, currently lines 45–48, 155–264 and 328–370); update `README.md` coverage description. No test changes.

**Interfaces:**

- Export `Proposal` from `split-proposal.ts`, preserving `{ groups: { title: string; reason: string; unitIds: string[] }[]; warnings: string[] }`.
- Export `getExpectedUnitIds(changes: readonly Change[]): ReadonlySet<string>` using the public evidence `Change` type.
- Export `validateProposal(text: string, expectedUnitIds: ReadonlySet<string>): ProposalValidation`.
- `ProposalValidation` is a discriminated union: `{ status: 'valid'; proposal: Proposal }`, `{ status: 'invalid_json' | 'invalid_shape'; message: string }`, or `{ status: 'invalid_coverage'; missingIds: string[]; duplicateIds: string[]; unknownIds: string[] }`.
- Add `expectedUnitIds: ReadonlySet<string>` as the first argument to local `proposeGroups`; its existing result remains `{ proposal: Proposal; response: Record<string, unknown> | null }`.

- [ ] **1. Implement inventory derivation.** Match the pager's existing ID spelling exactly. Include every text hunk, or one metadata unit for every change without readable hunks. In `runSplitPr`, derive once from the completed `report.changes` before pagination and pass the set to `proposeGroups`; never replace it with IDs from pages/model output.
- [ ] **2. Move and refine validation.** Catch JSON syntax errors as `invalid_json`; preserve the existing group/title/warning checks and enforce the requested schema's allowed keys. Return `invalid_shape` before computing coverage on malformed objects. For valid shapes, collect all three coverage lists without mutating the expected set. Every group must contain at least one ID; an empty groups array is valid only for an empty inventory. Return only a validated `Proposal` in the valid variant.
- [ ] **3. Wire the single-attempt command.** After successful pager exhaustion, compare distinct emitted IDs against expected IDs before any analysis/grouping generation; reject absent/unknown page IDs as a host failure. Repeated fragment IDs are allowed. Empty inventory requires empty pages and returns the existing empty success. Validate the model against original inventory; for now invalid results become `ModelError` messages containing their complete diagnostics, without retrying.
- [ ] **4. Verify pure cases interactively.** With valid change metadata and two hunks on `change-1`, plus a textless `change-2`, expect `change-1:0`, `change-1:1`, `change-2:metadata`. With expected IDs A/B/C, groups `[A, B, B, X, X]` yield missing `[C]`, duplicates `[B, X]`, unknown `[X]`; `[C, A, B]` is valid. Invalid JSON and empty group/title produce their structural diagnostics. Review that fragment pages containing A/A/B are complete for expected A/B, while A alone is an upstream failure. Record which checks were exercised versus inspected.
- [ ] **5. Document and verify the deliverable.** Describe authoritative inventory coverage in README without claiming repairs exist yet. Format with `node node_modules/prettier/bin/prettier.cjs --write apps/cli/src/split-proposal.ts apps/cli/src/split-pr.ts README.md`. Follow the shared verification procedure and review the moved parser for behavior changes. Suggested commit: `fix(cli): validate split coverage against the Git inventory`.

**Deliverable:** current single-attempt splitting rejects omissions relative to the original inventory and exposes exact diagnostics; no conversation or retry behavior yet.

### Task 2: Preserve a local grouping conversation

**Files:** modify `apps/cli/src/openai.ts` (`ModelRequest`, `ModelReply`, `createOpenAI`); modify `apps/cli/src/split-pr.ts` (`groupingRequest`, paging counter and initial grouping); update README and architecture's experimental-command paragraph. No test changes.

**Interfaces:**

- Broaden `ModelRequest.input` to `string | readonly Record<string, unknown>[]`; page analyses continue using strings.
- Add `output: readonly Record<string, unknown>[]` to `ModelReply`, retaining `text` and raw `response`. This output contains validated replayable provider items in original order; caller code treats their provider fields as opaque.
- Keep `createOpenAI`'s existing `count(request): Promise<number>` and `generate(request): Promise<ModelReply>` methods. No conversation class or new dependency.
- Change local `groupingRequest(input: readonly Record<string, unknown>[]): ModelRequest` so grouping callers explicitly supply item arrays.

- [ ] **1. Read the cited API contracts and extend the adapter.** Support item-array input in both generation and counting. Validate provider item kinds/envelopes in the adapter and expose accepted reasoning/message items intact. Preserve `encrypted_content`, `phase`, content and IDs when returned; keep current refusal/incomplete/unexpected-output failures. Do not reconstruct replay from `text` or force model-specific reasoning-context options.
- [ ] **2. Keep count/generate payloads aligned.** Both receive identical model, reasoning settings, instructions, input and text schema. Keep `store: false` and `max_output_tokens: 4096` on generation only. Preserve the 120,000 ms timeout and cancellation behavior. Use the official manual replay and input-count references in the spec; do not add `previous_response_id` or server storage.
- [ ] **3. Use the item representation in real grouping.** The initial input is `[{ role: 'user', content: initialContext }]`, with raw context for one page and the existing serialized notes for multiple pages. The pager's token callback must count that same wrapped request and schema. Keep each page-analysis request separate. There is still exactly one grouping generation in this task.
- [ ] **4. Make budget checks array-aware.** Measure `Buffer.byteLength(JSON.stringify(request.input))` against `defaultContextLimits.maxContextBytes` (65,536). Enforce the complete request token budget before generation; reuse a single-page count only for the identical request. Do not count only new messages or silently truncate input. Reject a serialized input that exceeds the byte ceiling even if its raw page fitted.
- [ ] **5. Review compatibility and verify.** Inspect the request paths for string page analyses, array grouping, reasoning-plus-message output and refusal/incomplete output. Confirm returned item fields survive unchanged and API keys never enter history/artifacts. When serializing page analyses, retain their existing `{ text, response }` shape; replayable items already exist under `response.output` and need no duplicate artifact field. Update documentation to describe local conversation-capable input without claiming iterative correction is enabled. Format with `node node_modules/prettier/bin/prettier.cjs --write apps/cli/src/openai.ts apps/cli/src/split-pr.ts README.md docs/architecture.md`, then run the shared checks; record that raw provider replay has not been proven by offline startup tests. Suggested commit: `feat(cli): preserve response items for local conversation turns`.

**Deliverable:** grouping uses a counted conversation input and the adapter returns the items needed for continuation, while current one-generation results remain compatible.

### Task 3: Run bounded corrections and preserve every completed attempt

**Files:** modify `apps/cli/src/split-pr.ts` (`proposeGroups`, report and finalization); update README, `docs/architecture.md`, and `docs/migration/README.md`. Consume Tasks 1–2 interfaces unchanged. No test changes.

**Interfaces:**

- Define local `const maxCorrections = 3`; no new flag.
- Define local `SplitAttempt` with `number: number`, `inputTokens: number`, `text: string`, `response: Record<string, unknown>`, and `validation: ProposalValidation`.
- Add `attempts: SplitAttempt[]` as the final argument to local `proposeGroups(expectedUnitIds, pages, model, maxInputTokens, attempts)`; the caller owns this report array so earlier attempts remain available when the operation throws. Keep the Task 1 return contract.
- Report format becomes `daphne-split-pr-v3`, with added `maxCorrections: 3` and `attempts: SplitAttempt[]`; preserve other fields and the existing stdout summary shape.

- [ ] **1. Implement the controller loop.** Retain one history array starting with Task 2's initial grouping input. After each completed generation, synchronously validate and append its text/raw response/result to the caller-owned attempts array before any further await. Return immediately on valid coverage. Otherwise, if this was generation four, throw the terminal exhaustion error. Never generate a fifth proposal or accept a partial one.
- [ ] **2. Build each correction turn.** Append every item in `reply.output`, then one user message containing the latest structured diagnostics and an instruction to return a complete corrected proposal. Add raw `page.context` for missing/duplicated known IDs when those pages have not already been supplied as raw context. Select by page IDs, preserve original page order, include all fragments, and track supplied page indexes locally. The initial single raw page is already supplied; notes do not count as raw pages. Do not invent sources for unknown IDs or parse source back out of rendered strings.
- [ ] **3. Gate every next call.** Use Task 2's complete-request counting/byte policy on accumulated history, including added evidence. If all selected evidence and history cannot fit, terminate with a budget error; do not drop fragments to squeeze it in. Provider/refusal/incomplete/count/timeout/cancellation failures propagate immediately. Reuse existing transport cancellation/deadlines and do not add transport retries, a no-progress heuristic or hidden limit increases.
- [ ] **4. Persist accepted and failed outcomes.** Initialize report attempts before calling the loop. Assign top-level proposal/response and mark complete only after a valid result returns; failures retain null top-level results, completed attempts, existing evidence/analyses and errors. Keep exit 0/1 behavior and actual provider call counters. Explain that attempts record completed grouping replies; a failed provider request has no fabricated completed draft. Preserve artifacts through the current handled-failure finalization path.
- [ ] **5. Check the complete state transitions.** Review/exercise: first reply valid → one generation; missing C then valid → two; missing C then duplicate B then valid → three; invalid replies followed by valid generation four → success; four invalid replies → failure with four attempts and no fifth call; valid shape with invented IDs never accepted; malformed draft can be corrected; budget/provider failure after earlier invalid replies retains those attempts; empty inventory uses zero generations; a fragmented missing unit supplies every original fragment page. Do not use paid calls or create test fixtures to force these cases without authorization; label unexercised cases honestly.
- [ ] **6. Finish docs and review.** Document three corrections/four grouping generations, separate page-analysis calls, growing-history limits, v3 fields, failure exits and semantic limitations. Format with `node node_modules/prettier/bin/prettier.cjs --write apps/cli/src/split-pr.ts README.md docs/architecture.md docs/migration/README.md`, then run the shared checks and independent review of the full change, including evidence retention and cancellation. Suggested commit: `feat(cli): repair invalid split proposals within bounded conversation turns`.

**Deliverable:** the complete agreed workflow, including terminal failures and inspectable drafts. No promise of semantic correctness, independently applicable PRs, crash resume or Rust parity.

## Copyable execution prompts

Use these sequentially from this repository. Each prompt requests one task only; the executor should inspect prerequisite completion rather than assume it from conversation history.

**Prompt 1**

> Implement Task 1 only from `docs/superpowers/plans/2026-10-22-split-coverage-repair.md`. Read its linked design and AGENTS.md. Add authoritative inventory validation and precise diagnostics, keeping single-attempt behavior. Follow the task's verification/review requirements and no-new-tests constraint. Stop after Task 1 and report changes, checks and limitations; do not start Task 2.

**Prompt 2**

> Implement Task 2 only from `docs/superpowers/plans/2026-10-22-split-coverage-repair.md`, after verifying Task 1 is complete. Read the linked design and official API references. Add local conversation input/output support with exact request counting and `store: false`, keeping one grouping generation. Follow the task's verification/review requirements and no-new-tests constraint. Stop after Task 2; do not start Task 3.

**Prompt 3**

> Implement Task 3 only from `docs/superpowers/plans/2026-10-22-split-coverage-repair.md`, after verifying Tasks 1–2 are complete. Add the bounded correction loop, targeted original evidence, v3 attempt artifacts and updated documentation. Preserve three corrections/four grouping generations, terminal failure behavior and the no-new-tests constraint. Run the required checks and independent full-change review, then report actual verification and remaining limitations.

## Approval summary

The sequence is inventory validation → local conversation support → bounded corrections and artifacts. The model keeps proposing whole-hunk groups; code controls acceptance and stopping. The final policy is three corrections, existing request timeouts/input limits, explicit failure when those limits intervene, and an artifact retaining all completed drafts. No new packages, SDK, flags, hash reconstruction, structured page notes or semantic reviewer are included. Existing automated checks remain required; new behavior lacks dedicated regression tests under the current repository policy.

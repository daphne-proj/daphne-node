# Split PR investigation implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkboxes for tracking. Delegate only when separately authorized.

**Goal:** Replace split-pr's page analysis with one tool-enabled conversation over the complete PR diff, followed by deterministic validation and repair, matching the intentions workflow.

**Architecture:** `semantic-split` owns grouping prompts, the model conversation and coverage validation. It reuses `runModelConversation`, `runEvaluatorOptimizer` and the existing evidence engine. Hosts own a pinned Git snapshot, repository tool execution, cleanup and artifact persistence; they keep the snapshot alive throughout the conversation.

**Tech stack:** TypeScript, Node 24.22.0, Bun 1.4.3, existing Daphne workspace packages, Zod and Vitest.

**Spec:** [Planned investigation workflow](../../../packages/semantic-split/README.md#planned-investigation-workflow), including its Mermaid diagram and limits.

**Branch:** `codex/split-pr-intentions-flow`.

## Global constraints

- Give the writer captured PR URL/title/body, the complete change inventory, stable unit IDs and all supported raw diff evidence upfront. Full contents of every changed file are not required; tools retrieve surrounding or unchanged code when useful.
- Use `list_changes`, `inspect_change`, `search_code` and `read_source_lines` against the same pinned BASE/HEAD comparison. Never retrieve against a moving branch during the run.
- Preserve the proposal contract: `groups` containing `title`, `reason` and `unitIds`, plus `warnings`. Text hunks use the existing unit IDs; changes without text hunks keep their metadata unit. Do not introduce intentions' issue/citation schema.
- Match intentions capacities: default input limit **256,000 tokens**, output limit **16,384 tokens**, complete context packet/request limit **8 MiB**, retained evidence limit **32 MiB**. Count each actual request, including tools, schema and history. These are application limits, not a claim about a model's advertised capacity.
- Preserve the shared `RunBudget`: optional `maxCandidates` and timeout, with no default candidate/deadline cap. Only completed terminal proposals consume candidates; tool turns do not. Evaluate the last allowed candidate.
- Oversized input or conversation growth fails explicitly. No summarization, compaction, truncation, overflow fallback, page-analysis path, semantic reviewer, new framework or new package.
- Keep completed turns, tool results, evidence and validation on failure. Cancellation or cleanup failure must prevent accepted output, including cancellation after a valid reply.
- Change all producers and consumers together. Remove obsolete split artifact readers and version markers; do not add compatibility modes. Preserve gold-label bytes, unit IDs, ordering, hashing rules not intentionally changed below, and unknown/absent semantics.
- Do not add tests. Update existing tests only where the implementation breaks their old contracts or behavior, preserving meaningful assertions. Run existing checks and report gaps in coverage.
- Follow the repository's architecture, TypeScript and readability policies. Public helpers must have real callers in both workflows; do not refactor unrelated intentions behavior.

## Current behavior and target

Today `semantic-split/src/workflow.ts` packs hunks into pages. A single page goes directly to grouping; multiple pages receive separate model summaries before grouping. Corrections can reattach original pages. `pr-review/src/split.ts` closes Git before the model runs, and evaluation runs directly from frozen hunks without a repository executor.

The replacement builds one complete initial packet and starts one conversation. The writer can inspect repository code, proposes groups, and receives precise JSON/schema/coverage diagnostics when invalid. Corrections continue in the same conversation with the original diff still available. Validation proves structural validity and exactly-once coverage; it does not prove that the groups are semantically ideal or independently buildable.

## Contracts and file ownership

| Owner                    | Planned contract/change                                                                                                                                                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `semantic-split` input   | Add required `pr: { url, title, body: string \| null }`; retain identity, changes and hunks.                                                                                                                                                                          |
| `semantic-split` options | Add required `executeTool(request: unknown): Promise<ToolResult>` and the existing intentions-style optional reasoning setting. Remove `onPage`; retain provider, model, budget and model-call observation.                                                           |
| `semantic-split` result  | Replace `pages` with evidence/hunk mappings, turns, tools, attempts, limits, diagnostics and limitations. Count token requests, generations and tool calls separately.                                                                                                |
| Split candidate records  | Store full provider replies once in `SplitTurn`; `SplitAttempt` refers to its `writerTurnNumber` and stores validation, nullable if interrupted before validation. `acceptedCandidate` identifies the accepted attempt/turn, or is null for failures and empty input. |
| `pr-review` result       | Retain captured metadata, identity, inventory, raw hunks, nullable investigation, accepted output and stage-tagged errors, following intentions' host result structure.                                                                                               |
| CLI/eval artifacts       | Persist the current result and model configuration, with explicit error serialization. Readers resolve candidate replies through turn references and reject malformed or inconsistent accepted output.                                                                |

The initial shared pieces are below; execution notes record the additional sharing requested during the final review:

- `context-engine/src/diff.ts`: public `DiffEvidenceInput` containing changes/hunks, `DiffHunkEvidence` containing change ID/hunk index/evidence IDs, `validateDiffInput(input): void`, and `retainDiff(input, engine, mappings): void`. Move the existing inventory/hunk validation and retention here; keep PR-text validation in each workflow. Preserve incremental retention when later evidence fails.
- `context-engine/src/complete-evidence.ts`: public `assembleCompleteEvidence(engine: ContextEngine, input: AssembleInput): ContextPacket`. Wrap existing packet assembly and reject omitted evidence or observations. Callers supply their byte limits; this helper performs no retrieval.
- `review-evidence/src/tool-definitions.ts`: expose the four existing JSON tool declarations as `repositoryTools`, plus `parseModelToolRequest(call: { name: string; arguments: string }): Record<string, unknown>`, through the public `@daphne/review-evidence/tool-definitions` subpath. This module has no Git or LLM dependency. It validates the model-call envelope; the existing evidence executor still validates domain arguments before I/O.

Keep split-specific conversation state and tool-result delivery in focused files beside `workflow.ts`, following intentions' existing layout. Do not create a generic agent framework or make split depend on the intentions package.

## Review focus

1. A rename, deletion, binary change or metadata-only change still receives the correct existing unit ID and exactly-once coverage. Task 2 preserves the validator and checks existing coverage scenarios.
2. Tool replies from the wrong comparison, malformed requests, incomplete source evidence or packet omissions cannot silently enter accepted context. Tasks 1–2 preserve evidence checks and inspect failure paths.
3. Cancellation after a completed tool/reply or a Git cleanup error retains the completed work but clears acceptance. Tasks 2–4 cover model, host and publication boundaries.
4. A frozen eval case from a fork must query its captured commits, not the PR's current head. Task 5 verifies repositories, commits and evidence before model calls.
5. History growth past the request limit must fail without dropping earlier diff/tool context. Task 2 removes the old initial-count reuse and checks actual-request counting.

## Task 1: Share the existing evidence building blocks

**Files:** Create `packages/context-engine/src/diff.ts`, `packages/context-engine/src/complete-evidence.ts`, and `packages/review-evidence/src/tool-definitions.ts`. Update those packages' exports/contracts/package configuration, `packages/intentions/src/{context,tools,contracts,schema}.ts`, affected READMEs and `eslint.config.mjs`.

**Consumes:** Existing intentions input validation, `retainDiff`, `assembleEvidence`, tool declarations and model tool-call parsing.

**Produces:** The three public interfaces described above, used by intentions without changing its observable investigation behavior.

- [x] Extract diff validation/retention, preserving BASE/HEAD ordering, exact bytes, path/line checks, identity checks and partial evidence on failure. Change intentions to use the shared mapping type and helpers.
- [x] Extract complete-packet assembly; retain intentions' current limits and query-page selection behavior.
- [x] Move tool declarations and envelope parsing into the pure public subpath. Remove helpers such as the tools-only `strictObject` from their old location once unused.
- [x] Narrowly update import-boundary lint rules for the pure tool subpath and planned orchestration files. Keep context-engine free of LLM/repository I/O and keep proposal/schema/prompt modules pure.
- [x] Run the existing intentions conversation suite after building. Review the extraction for unchanged validation, cancellation and evidence-delivery behavior; do not add a second implementation of these helpers.

## Task 2: Replace the split conversation and repair flow

**Files:** Rewrite `packages/semantic-split/src/{workflow,contracts,prompts,index}.ts`; add focused `context.ts`, `conversation.ts`, `tools.ts`, `runtime.ts` and `limits.ts`; delete `correction.ts`. Keep `proposal.ts` and `schema.ts` unless a necessary import/type adjustment is identified. Adapt broken assertions/helpers in `packages/semantic-split/tests/workflow.test.ts` and `workflow.helpers.ts`.

**Consumes:** Task 1's evidence helpers/tools; existing `runModelConversation`, `runEvaluatorOptimizer`, `RunBudget` and `validateProposal`.

**Produces:** `runSemanticSplit(input: SemanticSplitInput, options: SemanticSplitOptions): Promise<SemanticSplitResult>` with the new contracts and no page-analysis branch.

- [x] Before model calls, capture the pinned comparison, PR metadata and immutable unit-to-hunk mapping. Derive allowed IDs from the original Git inventory: `changeId:hunkIndex` for text hunks and the existing `changeId:metadata` unit otherwise. Reject duplicate change IDs and invalid hunk indices.
- [x] Require exactly one retained original hunk/metadata entry per expected ID; reject missing, extra, duplicate or mismatched entries. Text hunks retain their original sources for each existing BASE/HEAD side; metadata entries have no source text. Assemble the complete initial packet with the inventory and mappings; input failures stop before generation.
- [x] Replace page and grouping-summary prompts with one grouping prompt. Explain the four tools, group-by-intent semantics, complete coverage and the existing warning behavior for mixed-intent hunks. Treat PR/code text as evidence rather than instructions.
- [x] Use one model client and a continuing `runModelConversation` inside `runEvaluatorOptimizer`. Configure the capacities above and reuse intentions' provider reasoning defaults. Count each actual request; remove the old pager-derived token-count reuse.
- [x] Execute optional repository calls through the borrowed executor. Retain and validate tool results, source provenance and completeness notices. Record results before returning them to the model, and mark them delivered only when a completed subsequent reply establishes delivery, as intentions does.
- [x] Validate each terminal proposal with the existing strict JSON/schema and exactly-once checks against the captured inventory. Reject missing/unknown IDs and duplicates within or across groups; an empty proposal is valid only for empty input. Return actionable diagnostics for a complete replacement in the same history.
- [x] Resolve group IDs only through that comparison's captured mapping, using original source bytes and order. Repository tools add context, never assignable units; generic evidence IDs cannot replace unit IDs. Missing or inconsistent mappings fail the run instead of asking the model to reconstruct code.
- [x] Record each completed reply once; link attempts and accepted output to its turn. Preserve partial work on provider errors, invalid tool calls, evidence failures, capacity exhaustion and cancellation. Do not publish the last invalid draft when the budget ends.
- [x] Preserve empty-input behavior: no model/tool calls, an empty valid proposal if not cancelled, and no accepted-candidate reference.
- [x] Update existing workflow tests broken by page removal or new required options/results. Preserve their coverage, budget and cancellation assertions; run the existing workflow and proposal suites. Inspect untested tool-delivery and history-limit paths and report any verification gap.

## Task 3: Keep the PR repository available during splitting

**Files:** `packages/pr-review/src/{split,index}.ts` and `packages/pr-review/README.md`.

**Consumes:** Task 2's `runSemanticSplit` and existing snapshot acquisition/evidence session APIs.

**Produces:** `splitPullRequest` with a live repository executor and an intentions-style host result. `SplitPullRequestOptions` omits the executor from public host options because the host creates it.

- [x] Capture and retain PR metadata before acquisition; collect the full inventory and hunks from the pinned snapshot.
- [x] Move the model run inside the snapshot's lifetime and pass `session.execute` as `executeTool`. The same snapshot supplies initial evidence and all later searches/reads.
- [x] Close the snapshot in `finally` after the investigation. Retain acquisition, investigation and cleanup errors with their stages, including partial evidence when preparation fails.
- [x] Check cancellation before returning accepted output. On late cancellation or cleanup failure, clear proposal, response and accepted-candidate references at every published level while preserving the investigation history.
- [x] Verify the lifetime and error paths through existing checks and code review. Confirm that semantic-split itself never acquires, closes or directly reads a repository.

## Task 4: Update CLI output and invocation defaults

**Files:** `apps/cli/src/split-pr.ts`; add `apps/cli/src/split-pr-report.ts` for serialization; update `Makefile`, CLI help/README and existing `apps/cli/tests/split-pr.{test,helpers}.ts` where broken.

**Consumes:** Task 3's host result.

**Produces:** A current split `run.json` containing captured metadata/evidence, investigation records, resolved configuration/budget, accepted output and serialized errors.

- [x] Set split's default input token limit to 256,000 in CLI and relevant Make targets without changing unrelated context commands. Forward/record the same optional reasoning setting as intentions, including provider-specific defaults.
- [x] Remove page progress/counters and the `daphne-split-pr-v3` artifact discriminator. Use turns, tools, attempts and accepted group counts for reporting; add no replacement version marker or legacy branch.
- [x] Serialize model/tool errors explicitly using the existing intentions report pattern. Keep enough retained evidence and reply linkage for offline evaluation, without duplicating full replies in attempts.
- [x] Preserve split's existing output-directory and atomic-write policy. A cancellation during publication produces a failed artifact with retained work and no accepted output/reference.
- [x] Adapt broken existing CLI fixtures/assertions to the current result contract; run that suite. Check that help, Make defaults and the recorded configuration agree.

## Task 5: Keep evaluation reproducible with repository tools

**Files:** `apps/eval/src/split-pr/{contracts,case,evidence,source-consistency,trial,experiment,run,evaluate,upload,command}.ts`; add `artifact.ts` and `repository.ts`; update eval package/build references, `bun.lock` if the dependency edge requires it, `Makefile` and eval/dataset documentation. Inspect `dataset.ts`, `validation.ts` and `score.ts` for affected callers without changing scoring semantics.

**Consumes:** The new current artifact, frozen case evidence, original labels, Task 2's runner and existing Git/evidence APIs.

**Produces:** One current artifact reader and `runSplitCase(caseData: PreparedSplitCase, options: Omit<SemanticSplitOptions, 'executeTool'>): Promise<SemanticSplitResult>` in `repository.ts`, which runs a prepared frozen case with verified repository tools and always closes its snapshot. Offline scoring remains offline.

- [x] Extend frozen evidence with captured PR URL/title/body and acquisition data: target/head repository URLs and target/head commits. Include those model-visible/source inputs in `inputHash`; preserve existing canonicalization and case/label hashing outside this intentional input change.
- [x] Implement one current artifact reader used by case loading, evaluation and upload. Validate turn/attempt/accepted-candidate references; independently validate the accepted proposal and its agreement with the accepted terminal reply. Delete page/old-attempt/v3 readers.
- [x] Acquire the captured repositories and commits before live trials. Verify comparison identity, inventory and exact hunk/source content against frozen evidence. Never re-resolve a moving PR URL for a frozen run; support fork head repositories explicitly.
- [x] Handle fresh session IDs deliberately: compare all stable identity/content fields first, then rebind the in-memory frozen input and source references to the verified session. Keep persisted case bytes and its computed `inputHash` unchanged during this rebinding. Offline comparison may normalize session IDs only, never commits, paths, text or unit IDs.
- [x] Run the model with the verified session executor, retain the new records, and close Git in `finally`. Keep gold labels and scoring metadata out of model context. Repository unavailability or mismatch fails the case; do not supply a fake executor. Add the direct `@daphne/git-source` workspace dependency/build reference where needed.
- [x] Update trial serialization, model/prompt/tool fingerprints, costs/call counts, limits, candidate resolution and publication-cancellation handling. Change eval's default input limit to 256,000 and record resolved reasoning configuration.
- [x] Replace `split-pr-eval-all`'s live-PR re-resolution with the same frozen-case runner. Use a small app-local invocation if needed; do not introduce a second acquisition path or change upload behavior.
- [ ] Regenerate development captures that current commands depend on using captured pinned inputs and actual PR metadata. Preserve gold-label files byte for byte. If historical metadata/repositories are unavailable, report the affected cases; do not invent provenance or claim equivalent regeneration.
- [ ] Run existing offline case/suite validation and artifact scoring against regenerated current inputs. Inspect exact-commit acquisition, fork handling and cleanup. Live quality/cost comparison requires configured provider access; report it separately from offline validity and do not upload results without authorization.

## Task 6: Remove obsolete paths and finish documentation

**Files:** Delete `packages/context-engine/src/paging.ts` once callers are gone; update its `contracts.ts`/`index.ts`, package READMEs, `packages/context-engine/docs/context-and-paging.md`, `packages/review-evidence/docs/retrieval.md`, `docs/architecture.md` and active migration/ADR descriptions that claim split still uses pages.

**Consumes:** The integrated replacement from Tasks 1–5.

**Produces:** One supported split flow, accurate documentation and no unused old split paging code.

- [x] Remove `splitDiffIntoContextPages`, `DiffContextPage`, pager-only `TokenBudget`, `PageAnalysis`, `pageInstructions`, page correction/replay helpers, `onPage`, unused imports/exports and obsolete page-specific fixtures/assertions. Check every remaining reference before deleting shared code.
- [x] Retain `DiffContextHunk`, evidence query records, tool cursors and repository-result pagination. Those support bounded reads and are separate from the removed full-diff page analysis. Update their comments where they still imply the old split flow.
- [x] Rewrite `packages/semantic-split/README.md` around the implemented API, dependencies, tool access and limits. Keep its [deterministic validation checklist](../../../packages/semantic-split/README.md#deterministic-validation) explicit and concise: original IDs, retained-entry coverage, JSON/schema, exactly-once grouping and comparison-bound lookup, including stop-versus-repair behavior. Promote the Mermaid flow to the actual flow and remove obsolete algorithm sections.
- [x] Update intentions/context-engine/review-evidence/LLM/evaluator-optimizer/pr-review/CLI/eval documentation affected by shared helpers, call accounting or artifact contracts. Keep historical plans as historical records, adding a superseding link where useful rather than rewriting their history.
- [x] Audit references with `rg` for the removed symbol names and old artifact marker. Every remaining hit must be an intentional historical reference; no runtime producer, consumer or active guide may depend on them.

## Verification and completion

- [x] Use the repository-pinned Node and Bun versions. Run `bun install --frozen-lockfile`; if the new internal eval dependency requires a lock change, update it intentionally and rerun the frozen install.
- [x] Format changed files with repository Prettier and run `bun run check`. This includes the existing test suite; do not use `bun test`.
- [x] Check the final diff for unintended gold-label changes, fixture-byte changes, version markers, legacy readers, new external dependencies, secret persistence or unrelated intentions changes.
- [x] Review the integrated behavior independently of the implementation pass, focusing on provenance, full-context retention, exact coverage, frozen eval replay and cleanup/cancellation. Report which conditions existing tests establish and which remain inspection-only.
- [ ] Where configured access is available, compare the new flow on the same frozen evaluation cases and report grouping scores, tokens, tool calls, latency and cost. Do not equate structural validation with grouping quality or migration parity.

The implementation is complete when CLI and eval use the same full-diff/tool/repair flow, current readers and captures work together, obsolete split paging code is deleted, and the README describes the actual implementation. Compression and oversized-PR strategies remain outside this change.

## Execution notes

Implemented on `codex/split-pr-intentions-flow` in the renamed `/Users/pietroputelli/Desktop/daphne` checkout. Changes remain uncommitted at the user's request. The eight historical split reference captures are absent, so regeneration, gold scoring and a comparable live benchmark remain unavailable; gold-label bytes are unchanged.

The user's final duplication review extended sharing to original-diff reading, pure tool-result retention, evidence notices and app-local artifact evidence/delivery readers. Prompts, proposals, citation/coverage rules and workflow result contracts remain separate. Review fixes cover context-limit wiring, tool provenance/delivery, repair order, failed diagnostics and intentions' use of the shared diff parser.

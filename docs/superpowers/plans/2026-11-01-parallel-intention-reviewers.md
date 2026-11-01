# Three Parallel Intention Reviewers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans when implementation is authorized. Respect repository restrictions on test changes and task delegation. Track the checkboxes below.

**Goal:** Implement the agreed producer/reviewer loop with completeness and coherence moved into a third concurrent reviewer.

**Architecture:** Keep the existing evaluator–optimizer runner and continuing producer. Inside evaluation, run deterministic validation, then three isolated reviewer conversations, then code-owned feedback combination and acceptance policy.

**Tech stack:** Existing TypeScript, Node 24.22.0, Bun 1.4.3, Zod, and model adapters. No new dependencies.

**Spec:** The user's three-reviewer request in this chat; repository [architecture](../../architecture.md) and [reviewer guide](../../../packages/intentions/src/review/README.md).

## Starting point and constraints

The code currently has **one broad reviewer**, not the agreed two-reviewer design. `workflow.ts` already validates drafts, supplies corrections/evidence to the continuing producer, and rechecks replacements. `review/review.ts` creates fresh reviewer histories. Attribution, tool numbering, accepted-review references, and artifact replay assume sequential conversations.

The inspected [provisional report](../../../outputs/intentions-eval-2026-11-01T15-36-50.392Z-30673/evaluation/report.json) records citation gaps and missing BASE explanations: complete transitions 7/9. Its generation trace shows review discovering an omitted exception-path issue and the producer adding it. Preserve these artifacts and frozen labels; they do not establish parallel-review benefits.

- Preserve producer output, provider/model selection, citation rules, existing acceptance thresholds, optional candidate/deadline ceilings, and empty-comparison behavior.
- Reviewer 2 owns missing issues; Reviewer 3 owns missing behavioral explanations. Any reviewer may report important cross-cutting findings.
- No new tests without authorization. Adjust existing tests/helpers only if this implementation breaks them, as permitted by `AGENTS.md`.

## Tasks

### Task 1: Define scoped reviews and deterministic combination

**Files:** `packages/intentions/src/review/{prompts,schema,contracts,validation,coverage}.ts`; create `review/combine.ts`.

- [x] Define fixed reviewer keys `accuracy`, `issues`, and `completeness`, with these responsibilities:

  | Reviewer                   | Required investigation                                                                                                              |
  | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
  | Accuracy and evidence      | Factual descriptions, attached citation support, stated/inferred/unknown purpose and motivation.                                    |
  | Issues                     | Reported and missing issues: mechanisms, reachability, counterevidence, relevance, consequences, uncertainty, supporting citations. |
  | Completeness and coherence | Consequential BASE-to-HEAD behavior and relationships; boundaries, behavioral omissions, duplication, reading order, clarity.       |

- [x] Reuse finding/remedy/index/omission contracts. Scope dimension explanations to accuracy/citations/rationale; accuracy/citations/coverage for issues; coverage/coherence for completeness. Allow findings under any criterion. Only completeness requires full inventory accounting; each role must link its omissions to valid anchored coverage entries.
- [x] Add `parseIntentionReviewerReport`, validating against **that conversation's delivered evidence**, before any union. Preserve quote, index, hunk-anchor, and omission checks.
- [x] Add `combineIntentionReviews`: require one valid report per role/candidate; merge findings by card index in fixed role order and remap omission indexes. Retain originals, disagreements, and duplicates; no semantic deduplication, voting, or LLM merge. Derive the five-dimension aggregate and decision under existing blocking policy.

### Task 2: Run the three conversations safely

**Files:** `packages/intentions/src/{conversation,workflow,contracts}.ts`, `review/review.ts`; create `runtime.ts` for conversation-bound clients and shared recording.

- [x] Snapshot the draft, limitations, source packets, and navigation before launch. Give each role identical draft/evidence bytes, separate histories/receipts, a unique candidate-and-role conversation ID, and existing read-only tools. Do not deliver peer findings or retrieval results during review.
- [x] Replace mutable `activeConversation` attribution with conversation-bound model clients. Preserve provider/model, limits, global deadline/capacity, and candidate accounting. Sum client counters; distinguish conversation-local call numbers from global completed-turn numbers.
- [x] Run exactly three conversations concurrently. Serialize shared tool execution/retention through a run-local queue; reserve unique tool records before awaiting. Confirm delivery only through the originating conversation's next successful request.
- [x] On failure/cancellation, abort further reviewer model work, prevent new tools, and await all branches/in-flight tools before collecting failure. Retain completed diagnostics; publish no unapproved draft. Validate all three reports before combination/acceptance.
- [x] Send combined feedback and newly delivered source bytes once to the continuing producer, preserving review origins. Replacements repeat validation and all three fresh reviews. Keep zero-call empty comparisons and existing stopping rules; add no configuration options.

### Task 3: Preserve publication and artifact verification

**Files:** `packages/intentions/src/{contracts,index}.ts`; `apps/cli/src/intentions.ts`; `apps/eval/src/intentions/{artifact,artifact-delivery,artifact-trace}.ts`.

- [x] Replace singular references with `reviewTurnNumbers`, keyed by reviewer, in evaluations, feedback receipts, and accepted-candidate records. Save the aggregate on the evaluation and scoped reports on terminal turns. Export required parsers/types/combination through the public entry point.
- [x] Update artifact producers and readers together without version markers or backward-compatibility handling.
- [x] Verify interleaved conversations and tool calls by conversation/call identity, not global delivery order. Reparse three raw reports against individual receipts; recompute combination/policy and exact accepted linkage. Reject missing, extra, duplicate, cross-candidate, or forged records. Keep gold, rubrics, judge packets, and accepted writer output unchanged.

### Task 4: Update the existing reviewer README

**File:** `packages/intentions/src/review/README.md`.

- [x] Replace the single-reviewer iteration description with the role table above and this concise explanation:

  > The producer writes or revises an intention draft. Code first validates structure, citation references, revisions, ranges, and exact quotations. Three reviewers then evaluate the same fixed draft and initial evidence concurrently in separate conversations, using read-only investigation tools. They assess semantic support. Issues owns missing issues; completeness owns missing behavioral explanations. Responsibilities guide attention without prohibiting cross-cutting findings. Code validates and combines reports without another LLM call. Acceptance requires all three completed reviews with no blocking defects; repairable defects return feedback and newly delivered evidence to the original producer. Replacements repeat every check. Unresolved blocking findings stop; failed reviews, cancellation, or exhausted limits never publish an unaccepted draft.

- [x] Cite [Anthropic's example](https://platform.claude.com/cookbook/patterns-agents-evaluator-optimizer) for generate/evaluate/revise, noting that its sample uses one evaluator call. Cite [Building Effective Agents](https://www.anthropic.com/research/building-effective-agents#combining-and-customizing-these-patterns) for parallel evaluation of separate aspects and composing patterns. Their combination supports this architecture, not proven Daphne benefits. Remove stale single-client/single-review claims elsewhere in this README.
- [x] Update only directly affected format/linkage statements in the package README, CLI guide, eval README/command guide, architecture, migration overview, and ADR 0006 implementation-status paragraph. Leave historical plans and artifacts untouched.

### Task 5: Verify the implementation when authorized

- [x] Use the pinned runtimes; run `bun install --frozen-lockfile`, format only changed files with repository Prettier, then `bun run check` (includes build, typechecking, lint, and existing Vitest). Focused existing checks: `bun run test packages/intentions/tests/conversation.test.ts` and `bun run test packages/llm/tests`.
- [x] Independently review the five failure cases below against runtime and artifact-reader code before completion. Existing tests do not establish concurrency correctness; report that limitation without adding unauthorized tests.
- [ ] For a separately authorized live comparison, use `make intentions-eval CASE=apps/eval/datasets/intentions/cases/pr_1.json` into fresh output. Compare per-role timing, total usage/cost where available, repair rounds, citation/behavior gaps, issue validity/discovery, and false concerns with the saved baseline. Do not expose gold to runtime reviewers or infer general gains from one provisional case.

## Review focus

- Out-of-order completion: attribution and call/tool references remain correct.
- Reviewer-only evidence: peers and producer cannot cite it without confirmed delivery.
- Missing, failed, or malformed review: no acceptance; sibling work is settled before return.
- Conflicting or duplicate findings: none silently disappears or weakens blocking policy.
- Cancellation, exhaustion, and forged linkage: completed diagnostics survive, accepted output stays null.

No implementation or live evaluation is part of this planning task. Workload balance, latency, cost, and quality benefits remain unmeasured.

Execution: implemented without commits. Existing checks pass; fresh-context review found no Important/Critical defects. The two stale architecture sentences noted in the execution ledger remain deferred. Live comparison is not run.

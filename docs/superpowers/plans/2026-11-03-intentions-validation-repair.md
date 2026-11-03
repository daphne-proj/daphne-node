# Intentions Validation-and-Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove mandatory semantic reviewers from intentions while reusing the existing runner for deterministic validation and repair.

**Architecture:** `runIntentions` continues to call `runEvaluatorOptimizer`; its producer runs the existing writer/tool conversation and its evaluator calls only `validateIntentions`. The artifact reader revalidates structural acceptance, while `apps/eval` remains an independent semantic judge. No runner mechanics move into intentions.

**Tech Stack:** Node 24.22.0, Bun 1.4.3, TypeScript, existing Zod validation and Vitest checks.

**Spec:** [Intentions validation-and-repair design](../specs/2026-11-03-intentions-validation-repair-design.md). Read it with `AGENTS.md`, `docs/architecture.md`, `docs/migration/README.md` and the Daphne TypeScript/readability skills before implementation.

## Global Constraints

- Use Node `24.22.0` and Bun `1.4.3`; Bun manages packages and Node runs production code.
- Keep the package name `@daphne/evaluator-optimizer`; create no `patterns` package or `@daphne/refinement` rename.
- Keep the runner API and implementation, semantic-split behavior and dependency graph unchanged.
- Keep initial writer instructions, output schema, tools, provider/model settings, evidence acquisition, gold labels and judging rubrics unchanged; correction instructions describe structural diagnostics only.
- Add no runtime toggle, compatibility fallback or artifact version marker; regenerate development outputs as needed.
- Do not add or modify tests unless explicitly requested; update existing tests only if the implementation breaks them.
- Run existing required checks and independently review the implementation before completion.

## Review Focus

1. An invalid draft at the candidate ceiling fails; a valid last allowed draft succeeds without a reviewer call.
2. Cancellation or provider/tool failure retains completed work and original errors, with null accepted output even after a terminal reply.
3. Repairs continue the same writer history; retained-but-undelivered evidence never becomes eligible for citations.
4. Saved output with forged validation, wrong citations, reviewer feedback, extra turns or mismatched acceptance references is rejected before judging.
5. An empty comparison completes with zero calls, empty cards and null response/accepted reference; a cancelled empty run fails.

Repository policy overrides the skill's generic test-authoring steps. Steps 7–8 below map these checks to existing coverage and explicit static review; direct intentions workflow/artifact regression tests remain a declared gap.

---

## File structure and scope

| Files                                                                                                                                                 | Change                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/intentions/src/workflow.ts`                                                                                                                 | Keep shared runner; simplify callbacks and acceptance to deterministic validation. |
| `packages/intentions/src/contracts.ts`                                                                                                                | Structural attempt evaluations and writer-only accepted reference.                 |
| `packages/intentions/src/prompts.ts`                                                                                                                  | Remove semantic-review language from correction instructions only.                 |
| `apps/eval/src/intentions/artifact-trace.ts`                                                                                                          | Recompute structural decisions and enforce the new trace contract.                 |
| `apps/eval/src/intentions/artifact.ts`                                                                                                                | Update acceptance diagnostics/comments; preserve source and output validation.     |
| `apps/cli/src/intentions-summary.ts`                                                                                                                  | Use a neutral investigation heading; preserve usage and cost calculations.         |
| `packages/evaluator-optimizer/README.md`, `packages/intentions/README.md`, `packages/intentions/src/review/README.md`, `packages/pr-review/README.md` | Explain shared mechanics, deterministic acceptance and inactive review modules.    |
| `apps/cli/docs/intentions.md`, `apps/eval/README.md`, `docs/architecture.md`, `docs/migration/README.md`, `docs/adr/0006-evaluator-optimizer.md`      | Align current ownership, acceptance, artifact and verification descriptions.       |

Inspect but do not rewrite `packages/intentions/src/{conversation,runtime,index}.ts`, `packages/intentions/src/review/input.ts`, `apps/eval/src/intentions/{artifact-delivery,artifact-reviews,artifact-tools,judge-input}.ts` and `apps/cli/src/intentions-report.ts`. Existing delivery reconstruction, proposal projection and serialization remain useful. Preserve public review helpers and the role-capable conversation machinery; do not delete their tests. Historical plans and experiment outputs remain unchanged.

### Task 1: Change intentions policy and its artifact contract together

One atomic task: the producer and reader must agree before this can be evaluated. Splitting them into independently shipped commits would leave a broken artifact contract.

**Files:** Modify the files in the table above. No new production files, packages, fixtures, dependencies or test files.

**Interfaces:**

- Consume unchanged `runEvaluatorOptimizer<Candidate, Feedback, Accepted>(options: EvaluatorOptimizerOptions<Candidate, Feedback, Accepted>): Promise<EvaluatorOptimizerResult<Candidate, Feedback, Accepted>>` and its host-owned `RunBudget`.
- Preserve `runIntentions(input: IntentionsInput, options: IntentionsOptions): Promise<IntentionsResult>` and `validateIntentions(textInput: string, context: IntentionsValidationContext): IntentionsValidation`.
- Keep `IntentionCandidate` as `{ writerTurnNumber: number; deliveredEvidenceIds: readonly string[] }`. Private `IntentionFeedback` becomes `{ kind: 'structural'; diagnostics: string[] }`; private `IntentionAcceptance` becomes `{ proposal: IntentionsProposal; writerTurnNumber: number }`.
- Public `IntentionEvaluation` becomes the spec's structural accept/revise union; `IntentionAttempt.evaluation` remains nullable. `AcceptedIntentionCandidate` contains only `candidateNumber: number` and `writerTurnNumber: number`.
- Preserve `parseIntentionTrace(value: unknown, context: IntentionArtifactContext): ParsedIntentionTrace`, `loadIntentionArtifact(path: string): Promise<PreparedIntentionArtifact & { generationSummary: IntentionRunSummary | null }>` with `complete`, `invalid_output` and `failed_run` outcomes and `toIntentionProposalInput`'s public export.

- [ ] **Step 1: Establish the baseline.** Confirm `codex/intentions-validation-repair` contains main's reviewer workflow, not the earlier direct loop. Check pinned runtime versions, then run `bun install --frozen-lockfile` and `bun run check`. Record any pre-existing failure before editing; do not treat prior conversation checks as current evidence.

- [ ] **Step 2: Update the acceptance types in `contracts.ts`.** Apply the Interfaces shapes, remove the unused `IntentionReview` import if it has no remaining use, and document that acceptance proves structural consistency only. Keep tool/turn delivery types and reviewer helper contracts intact.

- [ ] **Step 3: Simplify `runIntentions` in `workflow.ts`.** Retain its existing runner invocation, result-status handling and attempt projection. The producer uses the same writer/runtime and appends structural diagnostics on revision. Delete the semantic feedback/context-transfer branch and the `reviewIntentionCandidate` call. The evaluator still records `turn.validation`; invalid results record structural revision and diagnostics, while valid results record structural acceptance and return the validated proposal plus writer turn number. Keep the existing evaluation map, cancellation checks and empty-input path; do not add a local iteration loop or copy runner lifecycle logic.

- [ ] **Step 4: Update the reader in `artifact-trace.ts` and `artifact.ts`.** Continue using `parseDeliveredTurns`, raw provider decoding and `validateIntentions`. Require consecutive terminal writer attempts with exact delivery snapshots, invalid earlier drafts and one valid final draft. Compare the entire saved evaluation to the recomputed structural decision, and require the exact two-field accepted reference. Reject reviewer turns/feedback and semantic evaluations; preserve budget/call accounting, empty-run rules, no-extra-turn checks and top-level/nested proposal/response equality. Remove imports and trace state used only to aggregate reviews. Keep artifact failure status handling and eligibility filtering.

- [ ] **Step 5: Align repair and display wording.** In `correctionInstructions`, replace “structural diagnostics or semantic review report and evidence” with “structural diagnostics”; leave all other writer instructions intact. In `formatIntentionRunSummary`, replace “Producer and parallel reviewers” with “Investigation” and use “API time includes token-count and generation calls.” Preserve metrics, agent rows, native usage and pricing calculations.

- [ ] **Step 6: Update the listed current documentation.** Describe a validation-and-repair loop implemented through the shared runner, with no evaluator model. Show the new accepted reference and structural attempt decisions, explain independent gold assessment, and mark reviewer modules inactive without deleting the judge projection. Update ADR 0006's current intentions adoption paragraph; keep the shared-runner decision and historical experiment records. Do not claim structural acceptance establishes semantic quality.

- [ ] **Step 7: Run existing verification.** Format exactly the changed files with repository Prettier, then run `bun run check`. Expected: formatting, typechecks, lint and all existing tests pass. Existing `packages/semantic-split/tests/workflow.test.ts` exercises ceilings, last-slot acceptance, cancellation, failure retention and empty input through the unchanged runner; `packages/llm/tests/conversation.test.ts` and `packages/intentions/tests/conversation.test.ts` exercise replay, tools and delivery isolation. These checks support Review Focus 1–3 and 5 but do not directly prove the changed intentions integration or reader. Do not add tests to hide that gap.

- [ ] **Step 8: Review the five uncovered integration conditions explicitly.** Trace each Review Focus condition through the changed callbacks, runner result handling and reader. Require null accepted output on cancellation/failure, exact final acceptance on a valid last slot, unchanged writer history across repairs, delivered-only source eligibility and zero-call empty handling. For the reader, verify that changing saved validation or the accepted reference cannot bypass raw-draft validation and that reviewer turns cannot be consumed as writer attempts. Record these as static checks, not passing automated tests. If local prior artifacts exist, load `outputs/intentions-agent-loop-20261103/generation-live/run.json` through the built `loadIntentionArtifact` and expect `complete`; load the old full-workflow artifact at `outputs/intentions-eval-2026-11-03T20-14-43.370Z-44166/generation/run.json` and expect `invalid_output`. These are reader checks only; do not convert old artifacts or invoke a judge.

- [ ] **Step 9: Obtain independent implementation review.** Give the reviewer the spec, diff, check results and Review Focus. Resolve actionable findings, rerunning affected checks after any change. Confirm no runner, provider, semantic-split, gold, schema or dependency changes slipped into the diff.

- [ ] **Step 10: Commit the coherent update.** Stage only the files in this task, inspect the staged diff and run `git diff --cached --check`. Commit as `refactor(intentions): use shared runner for validation and repair`. Report the commit, checks and coverage gaps; do not push or merge. No fresh model run or score claim is required to complete this code-ownership update.

## Self-review

- The supplied ownership decision is implemented by Steps 2–4 without changing package names or shared mechanics.
- Producer, reader, prompt wording, CLI presentation and current documentation change together.
- Public/private shapes agree; the offline judge's projection helper remains exported.
- Each Review Focus condition is assigned to Steps 7–8, with missing automated coverage stated explicitly under repository policy.
- One cohesive implementation task is sufficient. Native execution followed by one independent reviewer is recommended; a fresh agent per substep would add handoffs across one contract change.

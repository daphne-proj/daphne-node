# Intentions Review Generalization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans inline. The user now authorizes plan adjustments and implementation, then a stop: tests and experiments will run later. Keep all changes uncommitted. The execution scope below overrides the original verification and evaluation schedule.

**Goal:** Improve the intentions evaluator's detection of material explanation defects without teaching it the answers to the three PRs used in the first experiment.

**Architecture:** Keep the existing deterministic-validation → fresh semantic review → accept/revise/stop flow. The first implementation changes only the reviewer's general decision procedure and repair guidance; retain the current schema, decision policy, writer instructions, tools, evidence delivery and global budget. Evaluate the complete workflow against a contemporaneous baseline, using frozen unseen cases and separate source-grounded assessment.

**Tech Stack:** Existing TypeScript/Node/Bun workspaces and model/evaluation clients. Node 24.22.0, Bun 1.4.3; no new dependencies, packages or model-training infrastructure.

**Spec:** The user's request to address the findings without tailoring prompts or adjustments to this sample; the preserved contracts in [the evaluator–optimizer plan](2026-10-29-evaluator-optimizer.md); and the requirements below. The first live experiment is diagnostic evidence, not the target answer set or a release benchmark.

## Baseline and interpretation

The first experiment, at `fa773b77ddd8a78b21b015f48c417a8fe6f3a3fb`, had nine runs on `daphne-proj/pr-review-test` PRs #1–#3: seven runtime acceptances, three accepted outputs with no independent findings, and two candidate-ceiling failures. All three judge-clean outputs came from PR #2. Independent ratings and manual source inspection disagreed on some findings, including a material scope overclaim missed by both accepting models.

Evidence: [report](../../../outputs/evaluator-optimizer-2026-10-31T110742-905Z/report.md), [summary](../../../outputs/evaluator-optimizer-2026-10-31T110742-905Z/summary.json), and their captured requests, schemas and pinned inputs. These ignored artifacts must remain unchanged; preserve their hashes in a future experiment manifest. If unavailable, report that limitation rather than reconstructing their results from memory.

HEAD remains `4066d8d62a799c61cb73cb0b6496da29a15c55d7`, but the baseline for this work also includes the completed, uncommitted [token-efficiency implementation](2026-10-31-intentions-token-efficiency.md): compact reviewer citations, current-page tool navigation and stable reviewer evidence messages, alongside batched tool requests. Capture the working-tree patch and new helper, not just HEAD. Both future comparison arms must contain those changes and differ only in reviewer instructions. The [offline efficiency report](../../../outputs/intentions-token-efficiency-2026-10-31T125340Z/report.md) establishes payload reduction on saved trajectories; live token/cost effects and quality remain unmeasured. Do not attribute a comparison against the older nine runs solely to reviewer changes.

The reviewer already mentions most failed criteria. The working hypothesis is that an explicit, proportional decision procedure will improve compliance; the experiment has not established that missing prompt text caused the failures. The demonstrated repair-contract mismatch is narrower: reviewer instructions can recommend citations that the writer's deterministic validator disallows.

## Execution scope for this pass

Implement Task 2, document and statically review its contracts under Task 3, and write the reusable evaluation guidance from Task 5. Task 1 records the optimized baseline, hypotheses and a draft protocol; its unseen case selection, adjudicator assignment, exact execution order and paid allocation remain pending. Do not select or inspect a holdout now, run tests/build/type/lint checks, replay experiments or invoke workflow/judge models. Formatting and one independent source review are part of implementation. Tasks 4–5's measurements and adoption decision are future work, not conditions to silently execute after editing.

Keep the reviewer procedure proportional: use supplied evidence first, request more only for a material gap, allow compact sufficient citations, and return concise findings without a new reasoning transcript or per-claim ledger. Record prompt byte size as an implementation detail, not a token or cost result. Later comparisons must report total workflow effort and unnecessary revisions as well as detection quality. Earlier passing checks do not validate this new prompt change.

## Global constraints

- This pass changes this plan, reviewer instructions and their documentation, plus ignored protocol records. Preserve existing token-efficiency edits. No tests, live model calls, fixture changes, commits, dataset uploads or external messages.
- Do not fine-tune model weights or add examples, exceptions, keywords, file names, expected card counts, source snippets or expected answers derived from PRs #1–#3 to runtime instructions.
- Use these PRs as known development/regression evidence only. Renaming their identifiers or rephrasing their code does not produce an unseen case.
- Keep all five criteria: accuracy, citations, rationale, coverage and coherence. Material defects block acceptance; advisory preferences do not. Unknown motivation remains valid.
- Preserve mandatory deterministic validation, full replacement proposals, a fresh reviewer per structurally valid candidate, complete re-evaluation, scoped evidence delivery, accepting-writer linkage, and failure retention.
- Keep one shared run budget and the existing request capacities. Add no reviewer quota, transport retry, extra critic, score threshold, candidate ranking or best-effort acceptance.
- Keep the writer prompt and independent judge rubric unchanged for the first comparison. Do not improve benchmark scores by changing the assessor or relaxing its standard after seeing results.
- Do not add or edit tests, or run the existing checks in this pass. The user deferred testing until later. Prompt-string snapshots are not evidence of semantic improvement.
- Reuse existing CLI commands, artifact readers and the independent judge. Do not build a new evaluation framework or add historical-artifact compatibility for this task.
- Paid evaluation requires a concrete case manifest and authorized run allocation. Prior permission for the original nine runs does not authorize this new experiment.

## Design decision

Start with one bounded reviewer-instruction change. Additional report fields, a stronger/different model, increased reasoning effort, another reviewer, or larger candidate ceilings would change other factors and increase complexity or cost. Consider them only in a separately designed experiment if the first change is insufficient.

The existing `intentionReviewInstructions: string`, `reviewIntentionCandidate(candidate, runtime)`, `parseIntentionReview(value, context)` and `deriveIntentionReviewDecision(report)` contracts remain unchanged. Only the first value is modified. The reviewer still returns concise findings and the existing dimension explanations, not a new claim ledger or a transcript of its reasoning.

| General responsibility   | Required review behavior                                                                                                                                         | Avoid the opposite failure                                                                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claim scope and accuracy | Establish each material claim's scope, relevant conditions and mechanism from source; check plausible exceptions to guarantees actually asserted.                | Do not turn explanation review into an unbounded audit of unrelated code or require speculation about every possible bug.                                         |
| Citation support         | Separately check factual truth and support from the ranges attached to that field. Read missing surrounding source when support depends on it.                   | A short sufficient range is valid. Do not demand entire functions, files or callee implementations unless the claim depends on them.                              |
| Absence claims           | Match the claimed absence to the revision and scope actually established by evidence; read more or request narrower wording.                                     | An added file does not prove prior application-wide absence; metadata citations can still establish file-level absence.                                           |
| Rationale                | A stated quotation must express a problem, purpose or intended benefit; otherwise use a supported, qualified inference or unknown motivation.                    | Do not force every feature to have an author-stated reason or treat unknown motivation as a defect.                                                               |
| Meaningful coverage      | Inspect consequential conditions, failures, early returns and relationships across the changed behavior; report omissions that alter the reader's understanding. | Do not equate coverage with narrating every inventory item, export or configuration file. Those changes matter when they affect the contract or behavior.         |
| Actionable repair        | Identify the affected field, actual misunderstanding and feasible correction, preserving meaningful coverage and respecting citation-side rules.                 | Do not prescribe a repair that violates structural validation, invent unavailable evidence, or remove a material explanation merely to make it easier to approve. |

## File and ownership map

| Path                                                                                                                   | Planned action                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/intentions/src/review/prompts.ts`                                                                            | Replace the broad review paragraphs with the general procedure below; keep the existing export.                                                |
| `packages/intentions/src/review/README.md`                                                                             | Explain the review procedure, materiality and its limits in the related folder.                                                                |
| `apps/eval/docs/commands.md`                                                                                           | Add the future baseline/holdout procedure now; preserve the token-efficiency comparison guide.                                                 |
| `packages/intentions/src/proposal.ts`, `src/prompts.ts`, `src/review/{schema,validation,review}.ts`, `src/workflow.ts` | Inspect the current writer/citation and acceptance contracts; preserve behavior and interfaces. Paths are relative to `packages/intentions/`.  |
| `packages/llm`, `packages/evaluator-optimizer`, semantic split, test files, manifests and lockfile                     | No planned edits.                                                                                                                              |
| `outputs/intentions-review-generalization-<UTC>/`                                                                      | Record baseline/candidate hashes and a draft protocol now; future artifacts, blinded judgments and adoption report require separate execution. |

## Review focus

1. A fact supported elsewhere still has a citation defect if its attached evidence omits a material condition; a compact sufficient citation must also be allowed. Tasks 2–3 check both directions.
2. A plausible inference must not become an author-stated reason, and genuinely unknown motivation must not cause needless repairs. Tasks 2–3 check both directions.
3. Qualification must preserve material behavior instead of hiding it; complete explanations should not be rejected for omitted cosmetic details. Tasks 2–3 check both directions.
4. Repairs must obey BASE/HEAD and delivery rules without weakening deterministic validation. Tasks 2–4 verify this through the existing contracts and retained trajectories.
5. An apparent quality gain must not come from rejecting more cases, excluding failures, changing the assessor or repeatedly inspecting the holdout. Tasks 1, 4 and 5 control these risks.

## Task 1: Capture the optimized baseline and prepare the future protocol

**Files:** Read the current source, original experiment artifacts and evaluation commands. At execution time, create `outputs/intentions-review-generalization-<UTC>/protocol.json` and `case-manifest.json`; no product interfaces change.

For this pass, capture the baseline and hypotheses before editing. Mark the manifest incomplete with an empty unseen set; all selection, inspection-budget, ordering and paid-allocation steps below are deferred until evaluation is requested. The existing optimized baseline snapshot and pre-edit prompt must remain recoverable without committing.

- [x] Record the actual baseline revision, any uncommitted patch hash, runtime versions, writer/reviewer/judge models, reasoning settings, request capacities, tool configuration, global budget, prompts and schemas. Preserve the old experiment as historical context.
- [x] Predeclare the hypotheses: fewer accepted material scope/citation/rationale/coverage defects; fewer structurally impossible repair instructions; no compensating rise in unnecessary revisions or failure to produce an adequate result. Treat these as hypotheses, not promised outcomes.
- [ ] Separate known development/regression cases from the unseen evaluation set. Keep related repositories, fixture templates, forked examples and near-duplicate change families together; a different PR number is not sufficient separation.
- [ ] Have a case selector who is not authoring the prompt choose six previously unexamined PRs spanning at least two unrelated repositories and distinct change families. Include ordinary small changes as well as complex behavior, explicit and unstated motivation, and varying evidence needs. Select by these properties, not baseline failures or expected gains. "Unseen" concerns this development process, not an unverifiable claim about model pretraining.
- [ ] Pin exact target/base/head commits and captured metadata before runs. Keep holdout source, proposals, judgments and case-specific expected results away from the prompt author until the candidate instructions are frozen. The selector may inspect for eligibility; that does not make the cases available for tuning.
- [ ] Freeze the independent rubric, source-packet rules, materiality standard, scoring denominators and paired execution order before either holdout arm is inspected. An adequate candidate has sufficient support and coverage with no confirmed material defect; advisory findings alone do not make it inadequate. The primary clean-result measure uses source-adjudicated adequacy, while judge-clean results remain a separate diagnostic measure. Record randomized or counterbalanced arm order and its seed; execute variants with equal settings and comparable concurrency.
- [ ] Prepare the concrete paid-run request using the allocation below, exact PR URLs and fresh output paths. Name the adjudicator and budget the source-inspection work, including intermediate candidates; any additional paid adjudication calls must be listed separately. Obtain authorization once the allocation is concrete. Do not start paid calls during selection or prompt editing.

**Proposed bounded allocation, subject to authorization:**

| Stage                  |          Cases | Runs per arm per case |                 Arms | Workflow runs |
| ---------------------- | -------------: | --------------------: | -------------------: | ------------: |
| Known regression pilot | Original 3 PRs |                     1 | Baseline + candidate |             6 |
| Unseen comparison      |      6 new PRs |                     2 | Baseline + candidate |            24 |
| Total                  |          9 PRs |                       |                      |            30 |

Use `gpt-6-sol` for both runtime roles, the current low reasoning setting, input capacity 256,000, existing output capacity 16,384, and three candidates/600,000 ms per workflow in both arms. Use `gpt-6.1-sol` and the existing ten-minute judge timeout. This is a proposed small comparison, not a statistically powered release benchmark or a universal optimal budget.

At most 60 independent CLI judge calls cover the first valid draft and distinct accepted output of each workflow. Reuse a judgment when its candidate packet is identical; a failed workflow can have a diagnostic first-draft assessment but never an accepted-output assessment. Separate source adjudication covers all structurally valid evaluated candidates, at most 90 across the 30 workflows, without silently adding CLI judge calls. If that inspection effort is unaffordable, reduce the protocol before unblinding rather than choosing which suspicious repairs to inspect afterward. Tool continuations make generation/call counts variable within the shared deadline; these limits are not a dollar cap. Do not silently expand the allocation to replace failures or inconclusive cases.

**Completion now:** Optimized baseline, prompt/schema hashes, hypotheses and pending protocol fields are explicit. **Before future live calls:** complete the manifest, controls, metrics and authorization. Unavailable or already-exposed cases are replaced before unblinding, with reasons recorded; changes afterward require reporting a new protocol rather than silently repairing this one.

## Task 2: Implement a general reviewer decision procedure

**Modify:** `packages/intentions/src/review/prompts.ts`.

**Interface:** Keep `intentionReviewInstructions: string` and the existing structured report. The workflow, tools and acceptance parser consume it without caller changes. No new schema fields or exports.

- [x] Replace repetitive broad admonitions with an ordered procedure: inspect each card's material title/before/after/why claims; establish support and scope; then review consequential coverage and coherence across the whole proposal.
- [x] Make factual truth and attached-citation sufficiency distinct checks. Inspect relevant surrounding source or callees only where the asserted behavior depends on them. Use available evidence, justified qualification or an explicit limitation rather than inventing facts.
- [x] Resolve compact code citations against the delivered evidence packets. Use supplied source first; do not fetch a whole function or callee when the current range already establishes the claim. Keep reports concise without weakening full-proposal coverage or removing material findings.
- [x] Require scrutiny of asserted guarantees and absence claims at their actual scope. Request a correction only when a plausible exception or missing condition is grounded in the available comparison; avoid an unrelated code audit.
- [x] Make the stated/inferred/unknown rationale decision explicit. Require the existing rationale dimension explanation to identify the supported purpose or classification problem concisely. Do not demand author motivation that is absent from evidence.
- [x] Define materiality by the specific behavior, condition, capability or relationship a reader would misunderstand. Include consequential changed failures and early returns; preserve relevant unchanged conditions needed to explain the difference. Treat preferences for wording, verbosity, grouping and incidental file narration as advisory unless they create such a misunderstanding.
- [x] Make remedies respect the actual validator: before code citations are BASE-only, after code citations are HEAD-only, inferred reasons may cite either, and stated reasons use exact captured PR quotations. Request source retrieval when needed; never assume retained-but-undelivered source is already writer-citable.
- [x] Retain every-candidate/all-criteria review, valid unknown motivation, whole-proposal replacement, material/advisory severity, repairable versus unresolved findings, and untrusted-data instructions. Use the existing explanation/remedy fields; require no new acceptance evidence schema.
- [x] Audit every added instruction against the general responsibilities table. Remove any instruction whose only justification is a particular fixture answer. Include no sample-derived few-shot examples, special noun/identifier rules, forced card counts, arbitrary citation-length thresholds or guaranteed claims of improvement.

**Completion:** The only production diff is reviewer instructions. An independent review can justify each instruction from the explanation contract without needing to know PRs #1–#3. Writer instructions, models, reasoning, tools, report schema and acceptance policy remain identical between comparison arms.

## Task 3: Check contracts and counterexamples offline

**Modify:** `packages/intentions/src/review/README.md`. **Read:** `proposal.ts`, reviewer schema/validation, workflow and existing tests. Record review notes under the future experiment output directory; do not add test files or modify reference fixtures.

- [x] Review the proposed procedure against balanced cases described independently of the fixture domains: true and overbroad claims; compact sufficient and broad insufficient citations; supported stated purpose and mere feature description; valid unknown motivation; relevant and irrelevant callee details; material and cosmetic omissions; correct and impossible revision-side remedies. These are review checks, not an expected-answer list embedded in runtime prompts.
- [x] Confirm structural validity is not presented as semantic proof, missing evidence is not automatically a permanent stop, and every proposed repair is expressible under the existing writer schema and citation validator.
- [x] Independently inspect the prompt diff for excessive investigation, forced verbosity, blanket rejection of weak-looking quotations, and requirements that would manufacture defects in adequate proposals. Resolve contract contradictions; do not optimize toward preferred wording for the known PRs.
- [x] Document the procedure and its limitations in the reviewer folder README. Explain that one continuing writer and fresh reviewer histories remain unchanged and that positive model reports are fallible.
- [x] Format only changed files with repository Prettier and inspect the diff for unintended schema, writer, provider or protected-path changes. Record that install/build/type/lint/test checks are deferred by the user; do not reuse the token-efficiency task's passing results for this change. When testing is requested later, use the pinned runtimes and run the existing required checks.
- [x] Record the candidate source/patch, prompt and schema hashes for the pilot. Task 4 freezes the final candidate before exposing any holdout result; this offline task does not depend on paid execution.

**Completion now:** Implementation and independent source review have no unresolved material finding; automated checks remain explicitly unrun. Future passing checks establish mechanical compatibility, not model quality. No tests that merely assert prompt wording are added.

## Task 4: Run the authorized comparison using existing tooling

**Deferred:** No part of this task runs in the current implementation pass.

**Files:** Future experiment artifacts only. Reuse `apps/cli/dist/main.js`, `apps/eval/dist/src/main.js`, the current reader and the captured diagnostic-draft assessment method from the first experiment.

- [ ] Build baseline and candidate from isolated source/build states with identical dependencies. Record revision plus patch hashes when uncommitted; do not require a commit or mix compiled packages across variants. Preserve unrelated user work.
- [ ] After authorization, run the six known-case pilot workflows with the frozen settings. Inspect failure causes and adequate-candidate rejection as well as repairs. Stop the experiment for mechanical breakage; do not add fixture exceptions to rescue a known result.
- [ ] If a pilot finding reveals a general contract contradiction, correct it, redo affected offline checks and record the change. Freeze the final candidate source/patch, prompt and schema hashes before holdout; this does not reopen case selection based on pilot performance. Additional paid pilot runs require an amended allocation. Repeated hand-tuning against the known PR scores is outside this plan.
- [ ] Run the 24 scheduled holdout workflows after the candidate is frozen. Do not inspect outcomes to revise prompts partway through. Verify exact pins and metadata for every artifact; retain ceiling, cancellation, provider and evidence-capacity failures in their scheduled slots.
- [ ] Judge current accepted artifacts with the existing `intentions judge` command. Assess first valid drafts with the existing experiment-only approach: revalidate raw text against that turn's delivered evidence, use the same rubric/runner/parser, and label diagnostic provenance outside the model prompt. Copy or adapt the prior `assess-draft.mjs` into the experiment's output directory and verify that its imports resolve to that arm's isolated compiled packages; do not accidentally assess both arms through the original checkout. Do not manufacture accepted artifacts or feed runtime reviews, model identity, iteration count or variant labels to the judge.
- [ ] Preserve eligible source bytes without truncation. Record judging failures and insufficient evidence explicitly. If context limits prevent a judgment, retain the failure and use separately labeled source-grounded inspection rather than changing the input rules for one arm.
- [ ] Assign a separate adjudicator to classify every structurally valid evaluated candidate, including all revise/stop outcomes and accepted outputs, against source. Hide runtime decisions/findings and model-judge findings until the initial adequacy classification is recorded, then reconcile disagreements. Use randomized variant labels; record whether the adjudicator is a person or a fresh-context model reviewer. Inspect the same pinned source on both sides; log any additional inspection separately without changing original evidence delivery. Mark missing context as uncertainty. A model judge, including a different model, is not ground truth. If role separation or concealment is lost, disclose it and limit the corresponding claim.
- [ ] For each repair trajectory, distinguish an actual introduced defect from a pre-existing defect noticed later. Incomplete inspection leaves unnecessary-revision and introduced-defect classifications unknown, never implicitly clean. Keep first-draft quality separate from repair benefit; different stochastic initial drafts limit causal claims about reviewer quality alone. No fixed-candidate replay harness is added in this bounded first experiment.

**Command templates:** Run inside each verified build state with `PR_URL`, `RUN_DIR` and `JUDGE_DIR` resolved from the approved manifest to fresh paths; the experiment directory must already exist.

```sh
node apps/cli/dist/main.js intentions \
  --pr "$PR_URL" \
  --output "$RUN_DIR" \
  --model gpt-6-sol \
  --max-input-tokens 256000 \
  --max-candidates 3 \
  --run-timeout-ms 600000

node apps/eval/dist/src/main.js intentions judge \
  --artifact "$RUN_DIR/run.json" \
  --output "$JUDGE_DIR" \
  --model gpt-6.1-sol
```

**Completion:** Every scheduled run has a retained outcome; every scored item has exact source/prompt provenance. No outcome-dependent reruns, excluded failures, expanded ceilings, new schema qualification campaign or changes to either assessor occur during this comparison.

## Task 5: Report results and decide whether evidence supports adoption

**Modify now:** `apps/eval/docs/commands.md` with the reusable comparison method. **After future authorized evaluation:** create experiment `report.md`, machine-readable results and adjudication notes. No outcome or adoption decision is recorded now; do not rewrite the original nine-run report.

- [ ] Report known cases and unseen cases separately. Report each PR/change family, repeated-run variation and aggregate counts; two repetitions of a PR are not two independent examples of generalization.
- [ ] Preserve separate measures: runtime accepted / all scheduled workflows; accepted with no independent findings / all scheduled workflows; accepted with source-confirmed material defects / accepted workflows; and accepted with no confirmed material defects and sufficient assessment / all scheduled workflows. Do not count unassessable outputs as clean or equate a limited ordinal finding with a confirmed material defect.
- [ ] Report unnecessary revisions / adjudicated adequate reviewed candidates, true repairs, introduced defects, unresolved outcomes, ceiling/provider/judge failures, candidates, calls, native tokens/cache usage and latency by role. Every zero-denominator rate is undefined, not zero; report assessment coverage and unknown classifications alongside every applicable measure. Include the cost of failures and reviews on first-draft acceptances. Use verified billing data for dollars or leave monetary cost unknown.
- [ ] Keep the five 0/1/2/null dimension ratings separate; do not manufacture a percentage-quality score by averaging ordinal ratings. Explain every source-grounded disagreement with the independent judge.
- [ ] Apply the predeclared decision rule: evidence supporting adoption requires improved unseen source-adjudicated clean-result yield without an observed increase in material false acceptance or unnecessary revision. Mechanical regressions, reduced coverage to evade criticism, gains confined to known cases, or a worse false-acceptance rate do not support adoption. Ties, sparse denominators, conflicting outcomes, unknown classifications that could reverse the comparison, or disproportionate cost are inconclusive and require a stated product tradeoff rather than a claim of success. This is a conservative comparison rule, not a statistically established release threshold.
- [ ] If more work is needed, identify the general failure category. Do not add an exception for the failing holdout case. Once results influence another change, reclassify that set as development evidence and select a fresh unseen set for the next claim.
- [ ] Only after this report consider separately testing model/reasoning changes, richer review structure or additional review calls. Change one factor at a time; do not assume a larger budget repairs false acceptance.

**Completion:** A reader can see whether the general procedure helped outside the diagnosed sample, what it cost and what remains uncertain. Implementation completion and semantic-quality qualification are reported separately. No automatic commit, merge or further experiment follows.

## Planning completion record

This plan was informed by the current source, the saved live artifacts and an independent critique of generalization risks. The selected approach keeps the first change small and makes unseen evaluation, balanced materiality, fixed assessment and complete denominators explicit. Permanent test coverage and paid execution are not authorized by writing this document.

The 2026-10-31 execution update adopts the completed token-efficiency working tree as the comparison baseline and follows the user's implementation-only stop. It authorizes reviewer prompt/documentation edits while deferring all checks and experiments described above.

## Implementation handoff — 2026-10-31

The reviewer procedure and related documentation are implemented on the captured token-efficient working tree. Only reviewer instructions changed at runtime. One independent source review found no Critical, Important or Minor issues. The candidate prompt is 4,045 UTF-8 bytes, up from 3,563; this is not a token count or evidence of lower total cost.

Tests, installation, build, typecheck, lint, artifact replay and live evaluation were not run in this pass, as requested. The known-case manifest and baseline/candidate hashes are recorded in [protocol.json](../../../outputs/intentions-review-generalization-2026-10-31T132101Z/protocol.json); unseen selection and concrete authorization remain pending. Implementation completion does not establish model compliance, semantic improvement or adoption readiness. All changes remain uncommitted.

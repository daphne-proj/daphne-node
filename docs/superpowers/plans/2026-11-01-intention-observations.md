# Intention Outcomes and Observations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend intention cards to explain intended outcomes, actual transitions and supported problems with the implementation or engineering decision, including problems introduced, worsened or made relevant by the PR.

**Architecture:** Retain the existing sequential writer/reviewer loop, repository tools, evidence store and shared run budget. Extend the card contract and both roles' investigation responsibilities; keep product observations separate from feedback that repairs Daphne's account. Update artifact replay and independent evaluation together so the richer output remains inspectable and consistently assessed.

**Tech Stack:** TypeScript 6.0.3, Node 24.22.0, Bun 1.4.3 as package manager, Zod 4.6.7, existing `@daphne/intentions`, `@daphne/pr-review`, CLI and eval packages, existing Vitest checks.

**Spec:** [Intentions: Understanding Changes and Their Consequences](https://app.notion.com/p/40b2e607b83e8092a360d3c662662c08), plus the later discussion captured under “Scope and proposed decisions” below. Read both before execution. This is a draft for user validation, not authorization to implement.

## Global Constraints

- “A good intention explanation can describe a bad engineering change.” Accept the explanation's fidelity, not the PR's correctness.
- “Keep directly verifiable source facts distinct from interpretations of behavior, purpose and risk.” Citations establish provenance, not semantic truth.
- “Let's focus on issues introduced, worsened or made relevant by the PR. Existing weaknesses matter if they affect the intention.”
- Retain writer/reviewer roles; add no investigation subagents, preliminary full-review stage, packages, dependencies, tools or new CLI commands.
- Preserve pinned BASE/HEAD evidence, UTF-8 byte ranges, source delivery receipts, cancellation, resource limits, cleanup and failed-run semantics. Keep the current 16,384 output-token, 8 MiB context/request and 32 MiB retained-evidence capacities.
- Keep relative ESM imports suffixed `.js`, internal package imports through public exports, strict validation and existing package ownership. No Rust business-logic migration, production Bun APIs, RCI/PCG work or graphical viewer.
- “Do not write or modify tests unless the user explicitly asks.” Only repair existing tests if these changes actually break them; do not add new scenarios under that exception. This overrides the skill's default TDD steps.
- Do not modify frozen gold cases, source bytes, evidence IDs, hashes, review status or historical run artifacts. Existing behavior gold is not an issue-detection benchmark.
- Use `.node-version` and `.bun-version`. Verify `node --version` returns `v24.22.0` and `bun --version` returns `1.4.3` before running `bun install --frozen-lockfile`; format task-owned files and finish with `bun run check`. The planning session's default shell used older versions, so select the pinned toolchain explicitly rather than changing the pins.
- Apply Daphne's TypeScript/readability policies and concise explanatory comments to materially changed contracts and functions. Independently review nontrivial changes before completion.

## Review Focus

New tests are not authorized. These are required source-review and manual acceptance scenarios, assigned to the owning tasks below; existing checks do not automatically exercise them.

1. **A real defect with an accurate explanation:** preserve the supported issue and accept the account; never demand that Daphne repair the PR itself. Tasks 1 and 3.
2. **A fabricated requirement or incorrect inferred purpose:** correct or qualify the account; a well-formed citation or author quotation cannot make the unsupported interpretation valid. Tasks 1 and 3.
3. **A problem involving unchanged code or both revisions:** retain and validate exact delivered evidence from either side, and explain its relationship to this PR. Tasks 1 and 2.
4. **An issue removed or reordered during revision:** reviewer indexes and coverage quotations must resolve against the current candidate, with no stale references or dropped fields. Tasks 1–3.
5. **Empty issues, unknown purpose, failed runs and old artifacts:** do not invent findings, treat emptiness as certification, publish failed work as accepted, or reinterpret v2 under new semantics. Tasks 1–3.

---

## Scope and proposed decisions

The user has chosen the existing writer/reviewer architecture. Both roles may inspect relevant changed and unchanged source, callers, callees, tests, configuration and repository documentation through the existing tools. A concern can challenge the implementation or the goal itself, but it must explain a concrete consequence and its connection to the proposed transition. This is not a general audit of unrelated repository debt.

The following representation choices are proposals for approval with this plan; the separate intended-outcome field was previously undecided.

### Card contract

Keep `title`, `changeIds`, `before`, `after` and `why`. Add two required fields:

- `intendedOutcome: IntentionReason`: reuse the existing `stated` / `inferred` / `unknown` representation and its validation. Here the text describes the desired result; `why` continues to describe the motivation. A stated outcome requires an exact captured PR title/body quotation; an inferred outcome needs code/change citations. Unknown remains valid.
- `issues: IntentionIssue[]`: an empty array is valid and means no supported concerns were identified. Missing the field is invalid; do not silently default old output to an empty array.

Add and export `IntentionIssue` from the existing contracts module with exactly these properties:

| Property      | Type                                            | Meaning                                                                                                                                      |
| ------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `text`        | `string`                                        | A concise, complete explanation of the condition, consequence, threatened outcome or constraint, and why this PR makes the concern relevant. |
| `relevance`   | `'introduced' \| 'worsened' \| 'made_relevant'` | The relationship to the transition. The explanation must substantiate the chosen value.                                                      |
| `uncertainty` | `string \| null`                                | A specific missing premise or remaining uncertainty; `null` means none identified, not proven certainty.                                     |
| `citations`   | `IntentionCitation[]`                           | Nonempty references supporting the concern; source may be BASE, HEAD or unchanged supporting text.                                           |

Use one narrative field rather than separate condition/consequence/impact fields. The reviewer checks that the narrative contains the necessary reasoning. Do not add severity, confidence percentages, recommendation fields, issue categories or stable issue IDs in this slice. Attach a cross-intention concern once to the most relevant card, citing the connected evidence rather than duplicating the observation.

Issue citations establish the source behavior, constraints and consequences. Author-purpose claims are checked against the enclosing card's supported `intendedOutcome` and `why`; code citations do not establish what the author said. Do not expand generic citations with a new PR-quotation variant. Repository documents can be read and cited as source, with their authority and applicability assessed semantically.

### Review contract and acceptance

Keep the existing five review dimensions and per-card findings. Add `intendedOutcome` to ordinary finding fields. Add an issue-target variant with `field: 'issue'` and required zero-based `issueIndex`; ordinary field variants must reject `issueIndex`. Common finding properties remain criterion, severity, explanation, evidence/change references and remedy. A finding describes a defect in Daphne's account, not the mere existence of a code defect.

Coverage matches become a union: `{ cardIndex, field: 'before' | 'after', quote }` or `{ cardIndex, field: 'issue', issueIndex, quote }`. An issue can explain consequential actual behavior without forcing duplicate prose in `after`. Neither `intendedOutcome` nor `why` counts as actual-behavior coverage. Keep the original hunk-anchor and inventory rules, and the exact one-to-one link from every omission to an omitted coverage entry with the same change IDs. Missing material observations use this existing omissions mechanism; they cannot target a nonexistent issue index.

Remove the blanket exemption for `why` / `rationale`. Factual accuracy or citation defects in asserted title/before/after/intendedOutcome/why/issue content block acceptance regardless of an advisory label; other material findings and omissions also block. Advisory presentation or rationale preferences remain nonblocking. Unsupported attribution must be classified as an accuracy/citation problem, not hidden as optional wording feedback. Unknown motivation or outcome is not itself a defect.

An accurate observation of a bad implementation, architecture or goal can pass. An invented, irrelevant, unsupported or materially incomplete observation requires repair. Unresolved evidence should lead to retrieval, supported qualification or an honest limitation; stop only when a materially misleading account cannot be repaired within the existing policy and budget.

## File and ownership map

Paths below are relative to the repository root. Within each row, abbreviated filenames are siblings of its first fully qualified path. No new production file or package is needed for this slice; keep focused helpers private in their current owning modules.

| Responsibility                                                            | Files to modify                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public card types, raw writer schema, citation validation and exports     | `packages/intentions/src/contracts.ts`, `schema.ts`, `proposal.ts`, `index.ts`                                                                      |
| Writer investigation and revision instructions                            | `packages/intentions/src/prompts.ts`                                                                                                                |
| Reviewer projection, report schema, coverage, acceptance and instructions | `packages/intentions/src/review/input.ts`, `schema.ts`, `coverage.ts`, `validation.ts`, `prompts.ts`                                                |
| Runtime package documentation                                             | `packages/intentions/README.md`, `packages/intentions/src/review/README.md`                                                                         |
| Host artifact and strict reader versions                                  | `apps/cli/src/intentions.ts`, `apps/eval/src/intentions/artifact.ts`                                                                                |
| Independent judgment and quality consistency                              | `apps/eval/src/intentions/judgment.ts`, `quality.ts`, `gold-judgment.ts`, `command.ts`                                                              |
| Independent evaluation instructions                                       | `apps/eval/prompts/intentions.md`, `apps/eval/prompts/intentions-gold.md`                                                                           |
| User-facing and architecture documentation                                | `README.md`, `apps/cli/docs/intentions.md`, `apps/eval/README.md`, `apps/eval/docs/commands.md`, `docs/architecture.md`, `docs/migration/README.md` |

Inspect but do not redesign these existing integration points:

- Under `packages/intentions/src/`: `workflow.ts`, `conversation.ts`, `tools.ts`, `review/review.ts` and `review/contracts.ts`.
- `packages/pr-review/src/intentions.ts` and `apps/cli/src/intentions-report.ts`.
- Under `apps/eval/src/intentions/`: `artifact-trace.ts`, `artifact-delivery.ts` and `gold-case.ts`; also `apps/eval/scripts/intentions-eval.mjs`.

They already carry typed proposals, infer review types, transfer evidence or delegate to public validators. Amend only a concrete integration mismatch found during execution.

Existing tests are `packages/intentions/tests/conversation.test.ts` and nearby helpers, plus existing CLI and workspace checks. The conversation fixture has an empty intentions array, so the new per-card fields do not justify rewriting it. There are currently no dedicated nonempty card/reviewer/artifact tests to extend under the breakage exception.

## Task 1: Produce and review the richer intention account

**Files:** The runtime contract, prompt, reviewer and package-documentation rows above. Inspect the existing workflow/conversation files for integration; no new orchestration.

**Interfaces:**

- Consumes existing `IntentionsInput`, `IntentionsValidationContext`, `IntentionCitation`, `IntentionReason`, `IntentionReviewContext` and delivered source records.
- Produces `IntentionIssue` and the extended `Intention`, `IntentionsProposal` and inferred `RawIntentionsProposal` / `RawIntentionReview` shapes specified above. Add internal `RawIntentionIssue = RawIntentionsProposal['intentions'][number]['issues'][number]` for the projection helper if needed.
- Retains `validateIntentions(textInput: string, context: IntentionsValidationContext): IntentionsValidation`, `toReviewProposal(proposal: IntentionsProposal): RawIntentionsProposal`, `parseIntentionReview(value: unknown, context: IntentionReviewContext): IntentionReview`, `validateIntentionCoverage(report: RawIntentionReview, context: IntentionReviewContext): void`, and `deriveIntentionReviewDecision(report: IntentionReview): IntentionReviewDecision`.

- [ ] **Step 1: Extend the card contract and generated writer schema.** Add the exact fields above, using existing strict nonblank/UTF-8 text and citation schemas. Keep `uncertainty` required but nullable; reject blank non-null text. Reuse the existing reason schema for `intendedOutcome`. Export `IntentionIssue`; keep raw schema types internal.
- [ ] **Step 2: Resolve the new fields in `validateIntentions`.** Reuse `reason(...)` for intended outcomes and the private `citation(value, context)` without a side restriction for issues. Preserve BASE-only `before`, HEAD-only `after`, session/commit ownership, delivery eligibility, range and UTF-8 checks. Do not trust model-supplied source text or turn a malformed field into an empty/default value.
- [ ] **Step 3: Preserve the fields in `toReviewProposal`.** Project intended outcomes through the existing reason projection; project each issue's citations without duplicating embedded source bytes. Retain its text, relevance and uncertainty exactly. The separately assembled evidence packet remains the source of reviewer-visible bytes.
- [ ] **Step 4: Extend reviewer targets and coverage.** Use strict union variants for ordinary and issue findings/matches. Check each issue index against that current card's array and each coverage quote against the exact `issues[issueIndex].text`. Preserve existing index/reference uniqueness, original-hunk coverage and omission linkage checks. A missing concern is an omission, not an out-of-range issue finding.
- [ ] **Step 5: Apply the acceptance policy above in the shared validator.** Update `isBlockingFinding` and keep `deriveIntentionReviewDecision` as the single policy reused by workflow and artifact replay. Validate optional/unresolved remedy consistency under the new policy. Do not let a product issue's existence or relevance enum determine acceptance.
- [ ] **Step 6: Rewrite writer and correction instructions around investigation.** Require provisional intended outcomes; actual BASE/HEAD tracing; proactive examination of relevant callers, dependencies, contracts and failure paths; and concerns about either implementation or engineering choice. Require introduced/worsened/made-relevant justification, a search for counterevidence, and explicit uncertainty. Prohibit unrelated debt lists, invented requirements and issue quotas. Use retrieval to answer concrete questions without requiring tool calls or a full-repository traversal when supplied evidence suffices. Corrections must revisit the entire account, preserve supported findings, and treat reviewer feedback as evidence to check rather than authority.
- [ ] **Step 7: Rewrite reviewer instructions around independent challenge.** Extend the source-first pass to discover consequential unreported problems and cross-intention interactions; then validate the reported observations and purpose. Check evidence for the threatened constraint and the triggering condition's reachability, qualifying specific unverified premises instead of asserting them as facts. A relevant conditional concern need not pretend to certainty; uncertainty alone does not make it invalid. Issue targets assess the entire observation, including relevance and uncertainty, while coverage quotations address its narrative text. Distinguish factual explanation defects from accurate descriptions of bad engineering choices. Describe the new target/coverage variants and omission bookkeeping explicitly; retain fresh reviewer conversations and existing evidence feedback.
- [ ] **Step 8: Update the two package READMEs.** Explain the new public fields, supported-purpose rules, issue provenance, mixed-revision citations, acceptance policy and investigation scope. Keep user-facing terminology “Potential issues” or “Observations.” Do not claim automatic issue detection is reliable.
- [ ] **Step 9: Verify this deliverable.** Run `bun run typecheck`, then `bun run test packages/intentions/tests/conversation.test.ts`. Expect exit 0 and all existing conversation cases passing. Independently trace Review Focus 1–5 through the schema, projection, citation resolver, coverage and blocking policy; explicitly record that these new scenarios lack automated regression coverage.
- [ ] **Step 10: Commit the task-owned diff after review.** Stage only this task's files, inspect the staged diff and use `git commit -m "feat(intentions): explain intended outcomes and supported issues"`. Do not publish a live v2 run between this task and Task 2.

## Task 2: Preserve the richer account in versioned artifacts

**Files:** `apps/cli/src/intentions.ts`, `apps/eval/src/intentions/artifact.ts`, `apps/cli/docs/intentions.md`. Inspect `apps/cli/src/intentions-report.ts`, `apps/eval/src/intentions/artifact-trace.ts` and `apps/eval/src/intentions/artifact-delivery.ts` without adding an alternate parser.

**Interfaces:** Consumes Task 1's public validation functions and extended proposal/review types. Produces the run artifact; `loadIntentionArtifact(path: string): Promise<PreparedIntentionArtifact>` retains its signature and existing complete/failed/invalid result behavior.

- [ ] **Step 1: Change the host and reader together.** Update the artifact producer and reader together. Preserve the existing wrapper, raw turns, enriched citations, tool records, accepted writer/reviewer references and exact source bytes. Do not infer empty issue arrays when they are missing.
- [ ] **Step 2: Audit replay of the new contract.** Confirm every saved writer draft and linked reviewer report is reparsed through Task 1's public validators; accepted output must match the recorded accepted candidate. Check that reordered issue indexes are evaluated against their own candidate, reviewer-discovered source reaches the writer through the existing feedback path, and raw drafts retain issues even when a later failure clears top-level accepted output.
- [ ] **Step 3: Document the compatibility boundary.** Update the CLI guide's fields and v3 marker. State that old saved runs remain unchanged but require the corresponding old reader or a fresh run; relabeling a v2 artifact is not migration. Keep the current CLI commands and JSON presentation.
- [ ] **Step 4: Verify integration.** Run `bun run typecheck` and `bun run test apps/cli/tests/bootstrap.test.ts packages/intentions/tests/conversation.test.ts`. Expect exit 0. Inspect Review Focus 3–5 against serialization and strict replay. Existing tests are only a regression gate; they do not prove a nonempty v3 artifact round-trip or rejection of every forged issue reference.
- [ ] **Step 5: Commit the reviewed task-owned diff.** Use `git commit -m "feat(cli): version intention observation artifacts"` after staging and inspecting only this task's changes.

## Task 3: Align independent evaluation and document verification limits

**Files:** The independent judgment, evaluation-instruction and remaining documentation rows in the file map. The frozen gold case/evidence and historical calibration reports remain untouched.

**Interfaces:**

- Consumes Task 1's enriched `IntentionJudgePacket.proposal` and Task 2's v3 artifact reader.
- Retains `parseJudgment(value: unknown, packet: IntentionJudgePacket): IntentionJudgment`, `parseGoldJudgment(value: unknown, gold: IntentionGoldCase, packet: IntentionJudgePacket)`, `summarizeIntentionQuality(judgment: IntentionJudgment | null): IntentionQualitySummary`, and the existing command interface.
- Produces the versioned report formats in Step 5, with the existing five dimensions, 1–5/null scale and quality-summary keys. Issue-target findings allow observation quality to be inspected separately from behavioral explanation defects; do not introduce a new aggregate score or claim gold issue recall.

- [ ] **Step 1: Extend independent judge targets and consistency checks.** In `judgment.ts`, add `intendedOutcome` and the same strict `field: 'issue'` / `issueIndex` variant. Check issue indexes against the selected card. Remove the why exemption from factual-contradiction consistency. Citation consistency must cover before, after, stated/inferred intendedOutcome, stated/inferred why and issue claims; unknown purpose values do not require invented citations. Ordinary targets must reject issue indexes.
- [ ] **Step 2: Update rubric v4 and the quality summary.** Assess accuracy, support, relevance and material omissions across the richer account. A correctly reported PR defect is not a judge finding against Daphne. Rationale continues to assess purpose/motivation, but false attribution or unsupported factual purpose claims must also receive accuracy/citation findings. Remove `quality.ts`'s why-only exclusion so unsupported assertions cannot coexist with a clean primary summary. Keep ordinal dimensions separate and do not equate an empty issue list with a safe PR.
- [ ] **Step 3: Extend gold quotation matching without changing gold.** In `gold-judgment.ts`, matches become `{ cardIndex, field: 'before' | 'after', quote }` or `{ cardIndex, field: 'issue', issueIndex, quote }`. Ordinary matches must select the same side as the enclosing before/after assessment. Issue matches must resolve an exact nonblank quote; rubric v3 must require that it actually explains behavior on the assessed revision. Preserve known behavior IDs, every-behavior accounting, match/status consistency and reference-byte checks. Intended outcomes and motivations never count as implemented behavior coverage.
- [ ] **Step 4: Preserve evaluation independence and boundaries.** Keep runtime reports, prior verdicts and repair history out of judge input. Gold-only sources remain factual-check evidence and cannot become candidate citations. Update both rubrics to assess material issue omissions from available source, while stating that the unchanged gold dataset labels behaviors, not expected issues. Additional supported findings are not errors merely because gold omits them. No new dataset/schema for issue recall belongs in this slice.
- [ ] **Step 5: Version the changed evaluation contracts in `command.ts`.** Set `rubricVersion: 4` and `goldRubricVersion: 3`; emit `daphne-intentions-judge-input-v3`, `daphne-intentions-judge-v3`, `daphne-intentions-gold-input-v2`, and `daphne-intentions-gold-report-v2`. Leave `daphne-intentions-gold-v1` and `daphne-intentions-gold-evidence-v1` unchanged. Keep captured prompts/schema hashes and fresh-output protections; never rewrite historical judgments.
- [ ] **Step 6: Update current documentation.** Revise the root/eval READMEs, eval command guide, architecture intentions section and migration status paragraph for fields, scope, acceptance and versions. State the lack of new automated coverage and live calibration accurately. Preserve historical design/plan/calibration records; they describe earlier behavior. No new ADR or Notion rewrite is required by this task.
- [ ] **Step 7: Perform final verification and independent review.** Format only changed files with the repository Prettier configuration, run `bun run check`, and run `git diff --check`. Expect successful format, type, lint and existing Vitest checks with no whitespace errors. Have an independent reviewer trace all five Review Focus scenarios end to end, particularly issue quotes in gold coverage and unsupported purposes feeding observations. Fix actual task regressions; report unrelated baseline failures without expanding the task.
- [ ] **Step 8: Commit the reviewed task-owned diff.** Use `git commit -m "feat(eval): assess intention outcomes and observations"` after staging and inspecting only this task's files.

## Verification boundaries and follow-up

This plan schedules no new tests, test harnesses, synthetic fixtures or assertion scripts. The existing checks cover build/tooling and some conversation behavior; they do not exercise most new issue-validation or semantic-review cases. Repair existing tests only if a concrete failure is caused by the new contract. Record that gap when handing off the implementation.

Live generation and judging are a separate, explicitly bounded follow-up. The smallest useful manual calibration would include the audited tenant-collision PR, a valid change with no meaningful issue, and a legitimate limited guarantee that must not become an invented durability requirement. Check each observation against source, including evidence that could refute it; count missed material concerns and false concerns separately from behavior coverage. A case's draft status remains draft until human review.

For any future run against PR #1 gold, first verify that the fetched BASE/HEAD, metadata and inventory still match the frozen case. If they differ, report the mismatch rather than changing the reference bytes. Use the existing CLI/eval commands and explicit run budgets once that live exercise is requested; do not add a benchmark framework or silently spend additional model calls as part of this planning task.

Before claiming completion, distinguish implementation checks from semantic quality evidence. A passing build or reviewer verdict does not establish reliable issue detection, architectural judgment or reduced reviewer effort.

## Execution handoff

The plan remains pending user validation. Recommend **native execution** because all three tasks share one tightly coupled output/review contract, followed by the required independent review. Subagent-driven implementation is an alternative if the user prefers per-task implementer/reviewer isolation; this execution choice does not add agents to Daphne's runtime.

# Intention baseline coverage implementation plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan.

**Goal:** Make baseline discovery and completeness verification explicit within the existing review loop.

**Architecture:** Covered behaviors carry independently supported BASE and HEAD facts and candidate matches. The existing completeness reviewer discovers missing baselines with its tools and returns omissions through the existing revision path. Other reviewers report omission coverage without artificial two-sided issue assessments.

**Tech stack:** Existing TypeScript, Zod schemas, Node runtime and Bun checks.

**Spec:** The user's request and the preceding investigation of the November 2 intentions report.

## Constraints

- Keep the independent evaluator, gold labels and scoring unchanged.
- No case-specific identifiers, mandatory searches, additional agents, dependencies or compatibility handling.
- Preserve the user's pending LLM adapter edits. Do not commit.
- Leave test files unchanged unless this implementation breaks an existing test. Use temporary local assertions for the new contract and run existing checks.
- Do not make external model calls; the user selected local validation.

## Implementation and verification

- [x] Replace flat covered matches with BASE/HEAD facts, source or inventory references, and side-specific matches in `packages/intentions/src/review/schema.ts`.
- [x] Validate source delivery and revision, legitimate inventory support, and quotation fields in `coverage.ts`; provide retained sources through `contracts.ts` and `review.ts`. Keep aggregation and artifact replay on the same validator.
- [x] Update writer/reviewer guidance and the review README: assess each material capability separately, discover its nearest BASE equivalent, and report unresolved baselines rather than accepting broad related prose.
- [x] Run local assertions for valid transitions, added/deleted paths, metadata-only facts, wrong-side/undelivered/empty sources, wrong-side quotations, omission repair/stop decisions, and scoped issue reports. Check that merged reports preserve these constraints.
- [x] Format changed files, run pinned `bun install --frozen-lockfile` and `bun run check`, then obtain independent review of the final diff.

Verification passed: 23 temporary local assertions and all 49 existing tests, with
formatting, typechecking and lint clean. Independent review found no actionable
defects. No repository tests or evaluation criteria changed, and no live model
calls were made; quality improvement remains unmeasured.

## Review focus

Inventory-backed path absence must not be presented as proof of capability absence. Metadata-only changes must remain reviewable without source bytes. A peer reviewer's retained evidence must not become citeable before delivery. Unresolved baselines must retain the existing revise/stop distinction. Reference validation cannot prove semantic relevance; live quality improvement remains unmeasured.

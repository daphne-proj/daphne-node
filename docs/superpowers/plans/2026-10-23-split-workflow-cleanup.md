# Complete Split Workflow and Branch Cleanup

> **For agentic workers:** Use superpowers:executing-plans. The user authorized autonomous execution, no test additions, no commits or pushes.

**Goal:** Make PR-to-split reusable and review the complete branch for concrete defects and unnecessary complexity.

**Architecture:** Add `@daphne/pr-review/split` as the application workflow while keeping the existing metadata-only root export independent. Review-agent retains model orchestration; semantic-split retains pure policy. The CLI parses arguments, loads environment configuration and publishes existing artifacts.

**Tech stack:** TypeScript, Node 24.22.0, Bun 1.4.3; no new external dependencies.

**Spec:** The user's comprehensive-refactoring request and ADR 0003. Preserve the original evidence, IDs/order, provider prompts/schema, limits and v3 artifact contract. Existing package extraction and branch policy edits are intentional work.

## Branch baseline and constraints

- Actual base: `babcb36e130286607a1507a052784bf324071850`, confirmed by both merge bases and the branch creation reflog. Review tracked changes through the working tree and all untracked sources. The index was empty at task start.
- Preserve `context inspect` and its output/error contracts; extract only its shared CLI error definitions. Do not move this separate diagnostic workflow merely for symmetry.
- Keep Git cleanup before model work, preserve multiple acquisition/cleanup failures and retain completed evidence and model attempts.
- Do not add or modify tests. Use existing required checks, offline assertions and independent review. No live paid provider calls.
- Keep new work uncommitted; preserve unrelated user changes and historical planning records.

## Task 1: Review and extract PR orchestration

- [x] Read the complete branch diff, affected modules/callers/exports and relevant acquisition/evidence/context dependencies. Record confirmed defects before fixing them.
- [x] Add `splitPullRequest(ref, options)` at `packages/pr-review/src/split.ts`, exposed through `@daphne/pr-review/split`. It accepts a parsed PR reference and explicit model/cancellation/GitHub-token options; returns evidence, pages, attempts, counters and a complete/failed outcome with retained errors. It owns acquisition, hunk traversal and cleanup.
- [x] Reduce `apps/cli/src/split-pr.ts` to argument/configuration handling, one workflow call and v3 artifact/terminal serialization. Move shared error classes, stage/failure types and presentation mapping from `context.ts` into `apps/cli/src/errors.ts`; update both callers and main.
- [x] Register actual workspace dependencies/build references. Keep acquisition files and the root export isolated from workflow dependencies via scoped import restrictions. Record the ownership extension in ADR 0003.

## Task 2: Fix confirmed issues and finish verification

- [x] Fix the reproduced cold-check failure by building/typechecking before typed lint. Preserve all required checks.
- [x] Reproduce and correct cancellation that currently accepts an already-cancelled empty split. Check before work and before successful completion, preserving prior results on cancellation. Capture operation options once across asynchronous work.
- [x] Inspect every branch addition for dead paths, redundant state and material duplication. Retain algorithms that already meet their contracts; change only with a concrete reason.
- [x] Fix the independently confirmed repeated inventory work: reuse one completed frozen inventory per pinned snapshot when blob/output byte limits match. Keep validation, cancellation and closed-snapshot checks on every call; do not cache failures. Verify both limit changes and real Git subprocess reduction.
- [x] Update current documentation, format changed files, run frozen installation and `bun run clean && bun run check`, and exercise offline success/failure/cancellation/cleanup/coverage/paging/replay scenarios and artifact publication.
- [x] Obtain an independent read-only review of the entire final diff against `babcb36`, including untracked files; resolve actionable findings and report exact checks, intentional changes and remaining limits.

## Review focus

- Inventory/pager omissions must stop before generation; fragments retain exact bytes/order and termination must be finite for indivisible inputs.
- Every correction uses the original inventory, complete replay items and exact counted request; fourth success is allowed and no fifth generation occurs.
- Interrupted acquisition, retrieval, cleanup, counting and generation retain completed work without accepting an incomplete result.
- CLI-only concerns never leak into library entry points; existing acquisition imports must not load model workflow code.
- Clean installation/build/check, artifacts, CLI behavior and unaffected branch work remain intact.

## Verification record

- Pinned Node `v24.22.0` and Bun `1.4.3`; `bun install --frozen-lockfile` passed without dependency-version changes.
- Reproduced the original clean-check failure after `bun run clean` (typed lint ran before declarations existed). After reordering, `bun run clean && bun run check` passed, including formatting, all workspace/tool typechecks, lint and the existing Vitest test (1/1). Repeated the full gate after the inventory fix; it passed again.
- Inline `node --input-type=module -e` assertions compared 25 pre-refactor/current CLI scenarios: exact provider requests, v3 artifacts, stdout/stderr and exit codes matched. Covered valid and invalid proposals, every correction slot, fragmented evidence, budget/provider failures and acquisition/retrieval/cleanup failures.
- Exercised 19 standalone semantic-split scenarios, callback failure, and 25 public PR-workflow scenarios without CLI/environment configuration. Additional assertions covered cancellation before work, after paging and after a completed valid draft; captured options; missing/unknown/duplicate page units; exact counted requests and raw replay; targeted repair evidence and the four-generation cap.
- Twelve pager checks covered exact UTF-8 bytes, BOM/CRLF, empty anchors, 70 KB source splitting, indivisible-input termination, metadata kinds, empty input and capture before asynchronous counting.
- Ran the real metadata parser, snapshot lifecycle, Git commands, inventory, evidence, paging and split workflow against existing local commits `61b5fc8..8840d18`, substituting only HTTP replies and Git fetch transport. Four files and 26 hunks retained identical evidence/coverage; inventory scans fell from 27 to 1 and Git commands from 738 to 192. Every temporary snapshot was removed before model work.
- Verified cached inventory is frozen and respects lower output limits, blob limits in both directions, invalid limits, failure retries, cancellation, timeout and closed handles. Acquisition cancellation also removed its temporary snapshot.
- Exercised actual CLI failure-artifact publication: all four completed drafts and evidence retained, accepted proposal/response null, restrictive permissions, no overwrite, cancelled publication and no abandoned temporary links.
- Independent full-branch review against `babcb36`, including untracked sources/configuration/docs, identified the repeated inventory work. The follow-up review confirmed the fix and reported no remaining actionable findings. `git diff --check babcb36e130286607a1507a052784bf324071850` passed; index and HEAD remained unchanged.
- No tests were added or modified. No live GitHub/OpenAI requests, semantic-quality evaluation or Rust parity claim. No commit or push.

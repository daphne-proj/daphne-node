# Split Package Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing semantic-split workflow callable without the CLI.

**Architecture:** Semantic-split owns pure grouping policy and validation. Review-agent owns the provider and bounded workflow; the CLI composes acquisition and presentation. Return partial work on failure through one public operation.

**Tech Stack:** TypeScript, Node 24.22.0, Bun 1.4.3, existing native-fetch OpenAI adapter.

**Spec:** `docs/superpowers/specs/2026-10-23-split-package-extraction-design.md` (records the refactoring already approved in conversation).

## Global Constraints

- Preserve existing prompts, IDs, provider payloads, budgets, three corrections/four grouping generations and the `daphne-split-pr-v3` artifact.
- Keep PR/Git acquisition, cleanup, environment access, terminal output and artifact writing in the CLI; libraries never import apps.
- Use public workspace exports and `workspace:*`; add no external dependency or framework.
- Add or modify no tests under the repository's explicit policy. Use existing checks and temporary offline assertion-based verification.
- Commit the prior Task 3 first; leave this extraction uncommitted.

## Review Focus

- Failure during paging preserves earlier pages; failure during counting/generation preserves analyses and attempts.
- Single-page grouping reuses only its identical pager count; fragment pages and targeted repair evidence retain their order.
- Empty inventory, fourth-generation success and four-invalid exhaustion preserve their outcomes and call counts.
- CLI artifact shape, progress messages, failure classification and Git cleanup remain unchanged.
- Public exports resolve on Node without loading CLI code or reading environment variables; no API key appears in results.

### Task 1: Extract the workflow and wire the CLI

**Files:** create source/exports/package and TypeScript configs under `packages/semantic-split` and `packages/review-agent`; modify `apps/cli/src/split-pr.ts`, `apps/cli/src/context.ts`, CLI/root project references, CLI dependencies, `bun.lock`, import restrictions and current architecture/README/migration documentation. Remove the superseded CLI proposal and OpenAI source files.

**Interfaces:**

- Preserve `Proposal`, `ProposalValidation`, `getExpectedUnitIds` and `validateProposal` in semantic-split; export page/grouping/correction instructions and the proposal schema without provider imports.
- Review-agent exports `runSemanticSplit(input: SemanticSplitInput, options: SemanticSplitOptions): Promise<SemanticSplitResult>`, record types, `maxCorrections` and `ModelError` for CLI error classification. Keep the concrete provider private.
- Input contains `identity`, `changes` and `hunks`; options contain `apiKey`, `model`, `maxInputTokens`, `signal` and optional `onPage(page, pageNumber)`.
- The result includes `maxCorrections`, `pages`, `attempts` and `calls`. `status: 'complete'` includes the accepted proposal and nullable response; `status: 'failed'` includes null proposal/response and `error: unknown`.

- [x] Move pure validation and prompt/schema data into semantic-split, preserving bytes and ordering.
- [x] Move the provider and existing loop into review-agent. Wrap paging and grouping in the public operation so handled failures return all completed work.
- [x] Replace CLI model orchestration with one call after Git closes. Map failures through the existing `describeFailure` and preserve artifact fields and terminal behavior.
- [x] Add the two populated workspaces, exports, build references and ownership restrictions. Update the Bun lock through `bun install`, then verify `bun install --frozen-lockfile` succeeds.
- [x] Update current documentation to explain the reusable interface and ownership; retain historical plans unchanged.
- [x] Run offline assertions comparing old/new request payloads, call ordering, artifacts and outcomes across the Review Focus cases. No network or paid model calls.
- [x] Format changed files, run `bun run check` and `git diff --check`, then obtain an independent read-only review. Expected: all existing checks pass and no unresolved actionable findings.

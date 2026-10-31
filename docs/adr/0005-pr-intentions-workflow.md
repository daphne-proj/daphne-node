# ADR 0005: PR intentions investigation

Status: Accepted

Date: 2026-10-27

## Context

An intention card explains a PR's before/after behavior and distinguishes stated, inferred and unknown reasons. Exact hunks alone may not explain callers or unchanged surrounding code. This extends the acquisition/evidence/context ownership in [ADR 0002](0002-context-engine-boundary.md) and reusable workflow composition in [ADR 0003](0003-reusable-pr-split-workflow.md).

## Decision

`@daphne/pr-review/intentions` owns metadata resolution, pinned Git acquisition, initial evidence collection and cleanup. It keeps Git alive while `runIntentions` from `@daphne/intentions` borrows a validated evidence executor. Intentions owns investigation policy, prompts, conversation identity, evidence delivery and card validation. Its conversation wrapper delegates exact counting, capacity checks, replay and sequential tool continuation to LLM's `runModelConversation`, using the same history and shared signal. Required callbacks retain domain turns/tools and confirm delivery only after successful generation. LLM handles native provider calls and observations without importing workflow policy; [ADR 0004's conversation amendment](0004-shared-llm-package.md#conversation-protocol-amendment--2026-10-31) records this boundary. Review-evidence owns repository reads and line-to-byte translation. Context-engine only retains and assembles supplied evidence; larger explicit budgets propagate through assembly and snapshot reconstruction.

The CLI owns configuration, the host deadline, terminal formatting and `daphne-intentions-v1` artifacts in fresh directories. Each failed operation retains completed work with safe error descriptions; only a complete workflow and successful artifact publication yield accepted top-level output. A diagnostic draft is not accepted after cleanup or cancellation fails. No credentials, raw exception causes or configuration objects are serialized.

## Consequences

Git snapshots live longer than in the splitter and are closed in `finally`. The reusable supplied-evidence workflow does not own or close its executor. Budgets stop oversized investigations explicitly without trimming history; existing splitter algorithms remain unchanged. Cards can overlap, and validated citations do not establish semantic truth or author intent. Model quality requires manual evaluation against pinned revisions and captured PR text. This is an experimental TypeScript workflow, not a migration parity claim. Focused offline conversation tests cover delivery isolation and failure retention; live explanation quality remains a separate evaluation.

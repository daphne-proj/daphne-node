# ADR 0003: Reusable PR split orchestration

- Status: accepted for the user-authorized split refactoring
- Date: 2026-10-23

Package naming and provider-usage ownership were refined by [ADR 0004](0004-shared-llm-package.md): the model adapter now lives in `@daphne/llm`. The decision below retains its original package names.

## Problem

Moving the model loop out of the CLI made supplied evidence reusable, but a backend would still have to copy PR acquisition, hunk collection, Git cleanup and failure retention from the command.

## Decision

Expose `splitPullRequest` from `@daphne/pr-review/split`. This module composes the existing acquisition, Git, evidence and semantic-split packages, takes configuration explicitly and returns the collected work on success or failure. Git closes before pagination/model requests. CLI argument parsing, environment loading, terminal output, artifact serialization and exit codes remain in `apps/cli`.

Keep `@daphne/pr-review`'s existing root export metadata-only. Its acquisition modules retain ADR 0002's import restrictions; the separate split entry point may depend on downstream packages. Git-source, review-evidence, context-engine, semantic-split and review-agent must not import this workflow. This extends ADR 0002's host composition to a reusable application module without moving Git into context-engine or review-agent.

Export `runSemanticSplit` from `@daphne/semantic-split` for callers that already have evidence. That package owns pagination coordination, page analysis, grouping history, coverage validation, correction evidence and correction limits. Keep proposal validation, prompts and schema pure in their internal modules. Export the concrete `createOpenAI` model adapter and its request/reply types from `@daphne/review-agent`; that package owns provider calls, token counting, deadlines, counters and validated replay output, without workspace dependencies. Do not add a generic provider or workflow framework. Keep `context inspect` as a separate diagnostic command, sharing only CLI error presentation.

## Alternatives and consequences

Keeping orchestration in the executable forces callers to duplicate resource/error policy. Exporting workflow code from the metadata root would unnecessarily load model and evidence code for acquisition-only consumers. A new generic orchestration package would duplicate the owner already reserved for PR workflows.

The runtime dependency direction is `pr-review → semantic-split → review-agent`, with semantic-split also using context-engine. The PR package keeps actual workspace/build dependencies, while the root's runtime import graph stays small. Split-specific exports move from review-agent to semantic-split; there is no reverse compatibility re-export that would recreate a cycle. This refinement keeps split decisions with their domain while preserving request bodies, result shapes and failure behavior. The v3 artifact is unchanged. Revisit the entry-point split if another implemented PR workflow needs common orchestration; do not generalize in advance. This does not establish Rust parity.

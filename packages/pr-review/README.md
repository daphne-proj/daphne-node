# PR review

`@daphne/pr-review` orchestrates pull-request workflows. It connects PR metadata, repository evidence and domain operations, and owns the Git lifetime for those workflows.

## What belongs here

- PR URL parsing, GitHub metadata retrieval, authentication and metadata limits/errors, under `src/acquisition/`.
- Workflow sequencing: acquire a snapshot, collect evidence, close Git, then invoke semantic splitting.
- Retaining collected work and operation/cleanup failures in the result returned to the caller.

The root export provides `parsePullRequestUrl` and `resolvePullRequest`. The separate `@daphne/pr-review/split` entry point provides `splitPullRequest`; metadata-only callers do not load the split workflow.

## Boundaries

| Responsibility                                                 | Owner             |
| -------------------------------------------------------------- | ----------------- |
| Git subprocesses, snapshots, inventory and blob reads          | `git-source`      |
| Validated source excerpts and repository tools                 | `review-evidence` |
| Grouping, prompts, coverage validation and correction loop     | `semantic-split`  |
| Evidence packing and fragmentation                             | `context-engine`  |
| Model transport and provider response handling                 | `review-agent`    |
| Environment loading, terminal output, artifacts and exit codes | The calling app   |

PR workflows invoke these modules through public exports. Lower-level packages must not depend on `pr-review`. See [architecture](../../docs/architecture.md) and [ADR 0003](../../docs/adr/0003-reusable-pr-split-workflow.md).

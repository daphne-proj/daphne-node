# PR review

`@daphne/pr-review` connects a GitHub pull request to Daphne's review workflows. It owns PR metadata acquisition and workflow sequencing, including the Git lifetime. Callers supply credentials and cancellation; the calling app owns environment loading, output files and terminal behavior.

## Main APIs

| Entry point                    | API                                          | Purpose                                                                                      |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `@daphne/pr-review`            | `parsePullRequestUrl(url)`                   | Validate a GitHub PR URL and produce a normalized reference.                                 |
| `@daphne/pr-review`            | `resolvePullRequest(ref, options)`           | Fetch and validate public PR metadata, returning exact target/head repositories and commits. |
| `@daphne/pr-review/split`      | `splitPullRequest(ref, options)`             | Collect evidence, keep Git open while running semantic splitting.                            |
| `@daphne/pr-review/intentions` | `analyzePullRequestIntentions(ref, options)` | Collect evidence and investigate cited intention cards while Git remains available.          |

The root export loads only metadata acquisition. The separate `/split` and `/intentions` exports bring in evidence collection and model orchestration. `defaultPullRequestLimits` and `resolvePullRequestLimits` control metadata request time and response size.

## Main types

- `PullRequestRef` / `ResolvedPullRequest`: the PR's URL identity, validated title and nullable body, and resolved repository/commit comparison.
- `ResolvePullRequestOptions` / `PullRequestLimits`: explicit cancellation, HTTP limits and optional GitHub token.
- `SplitPullRequestOptions`: model credentials, input-token budget, a shared run budget, a model-call observer and optional GitHub token.
- `SplitPullRequestResult`: complete or failed output retaining captured metadata/evidence and a nullable investigation containing turns, tools, attempts and call counts; failures also retain operation and cleanup errors.

- `IntentionsPullRequestOptions` / `IntentionsPullRequestResult`: investigation options and complete/failed results retaining acquisition evidence, investigation progress and cleanup errors.

## How it works

1. Resolve the PR through GitHub's REST API using native `fetch` and validate the response before using its repositories or commits.
2. Use `git-source` to acquire a snapshot and list changes, then `review-evidence` to read each original hunk. Changes without text hunks receive metadata-only entries.
3. Keep Git open through either investigation for on-demand searches and reads, then close it in `finally`. Cleanup or late cancellation clears top-level and nested acceptance while retaining completed work.

The workflow depends on `git-source` for repository I/O, `review-evidence` for exact excerpts, `semantic-split` for grouping and validation, and `intentions` for investigation, citation validation and repair. It imports context-engine's `DiffContextHunk` type to describe supplied evidence; packing itself remains in context-engine. These lower layers do not depend on PR orchestration.

Metadata errors distinguish invalid input (`PullRequestInputError`) from HTTP, response and repository failures (`PullRequestError`). A successful split establishes validated unit coverage; the proposed groups still need human review.

See the [intentions workflow guide](docs/intentions.md) for options, evidence lifetime and failure behavior, the [metadata API](src/acquisition/pull-request.ts), [split workflow](src/split.ts) and [workflow boundary decision](../../docs/adr/0003-reusable-pr-split-workflow.md).

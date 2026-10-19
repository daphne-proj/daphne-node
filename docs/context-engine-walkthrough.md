# Context-engine walkthrough

## Step 1: Resolve PR metadata in pr-review

This step turns an untrusted PR URL into validated GitHub repository locations and exact commit IDs. It does not create the context engine, fetch Git history or run a model.

### Read the code in this order

1. [Public exports](../packages/pr-review/src/index.ts): the functions, types and errors a caller can use. Package consumers cannot import arbitrary implementation subpaths.
2. [HTTP limits](../packages/pr-review/src/limits.ts): a 30,000 ms request deadline and 2,097,152-byte response cap. Overrides must be positive safe integers and cannot raise these defaults. The returned limits are frozen.
3. [URL parsing](../packages/pr-review/src/acquisition/pull-request.ts): `parsePullRequestUrl` is synchronous and performs no I/O. It accepts canonical HTTPS GitHub PR URLs, normalizes the optional trailing slash, and rejects credentials, queries, fragments and unsafe PR numbers.
4. In the same file, `resolvePullRequest` checks the reference against its URL, builds the trusted API endpoint and combines caller cancellation with the HTTP timeout. It passes the token only as an HTTP header. A manual redirect response becomes an error; it is never followed.
5. `readJson` reads the response incrementally and counts actual received bytes rather than trusting Content-Length. Decoding and JSON parsing produce `unknown`. `readMetadata`/`readRevision` narrow only the fields we consume: PR number, matching target repository, public visibility, repository names and full commit IDs.
6. The resolver returns frozen metadata. Its `finally` aborts the owned request, releasing unread error or oversized bodies. HTTP failures expose a numeric status as their redacted cause; raw native errors and caller abort reasons are omitted because they may contain secrets.

### Why these boundaries exist

`PullRequestRef` identifies a GitHub PR; it is not a context-engine input. The future CLI will explicitly copy repository locations and commit IDs into the engine's `RepositoryComparisonInput`. Local workflows can instead supply a repository path and revisions. Neither library needs to import the other.

`targetCommit` is the target branch tip reported by GitHub. It is not necessarily the merge base. Task 2 will acquire the exact objects and calculate that merge base. The values observed in this step do not guarantee publication freshness or successful Git acquisition.

TypeScript types describe trusted values after validation; they do not make an HTTP response trustworthy. The library's runtime checks establish the facts its return type promises. Composition uses ordinary functions rather than a generic engine superclass or provider registry.

### Run the public API manually

From the repository root, run `bun run build`. Then enter `packages/pr-review` so Node can resolve the package's own public exports:

```sh
node --input-type=module <<'JS'
import {
  defaultPullRequestLimits,
  parsePullRequestUrl,
  resolvePullRequest,
} from '@daphne/pr-review';

const ref = parsePullRequestUrl(
  'https://github.com/daphne-proj/pr-review-test/pull/1',
);
console.log(ref);
console.log(await resolvePullRequest(ref, {
  signal: new AbortController().signal,
  limits: defaultPullRequestLimits,
}));
JS
```

The host can supply an optional read token; the library never reads `process.env`. When another workspace consumes this package, it must declare `@daphne/pr-review: workspace:*` and its build reference. The CLI has no such dependency until its integration step.

### Observed manual results

Using the pinned Node 24.22.0 runtime and Bun 1.4.3 scripts:

- The example parsed as owner `daphne-proj`, repository `pr-review-test`, number `1`.
- Target commit: `3f0d15e8834c098d26b428bad1b325e6f33d9755`.
- Head commit: `93076efe37909ef3f36480170048cc9387aa29be`.
- Both repository URLs were `https://github.com/daphne-proj/pr-review-test.git`.
- A separate GitHub API request returned HTTP 200 and identical commit IDs. These are observations from the demonstration, not fixed future expectations.
- An alternative host, embedded credentials, trailing newline and unsafe PR number were rejected as `PullRequestInputError` before resolution.
- Zero and raised HTTP byte limits were rejected.
- A pre-aborted signal returned `cancelled` without exposing the caller's reason.
- A one-byte response allowance returned `response_limit`; a one-millisecond request deadline returned `timeout`.
- A deliberately invalid, non-secret token returned `authentication` with cause `{ status: 401 }`; the token did not appear in the error.

No test files, fixtures, harness or test dependencies were added. The existing CLI smoke test does not exercise these resolver semantics. Redirect, private/deleted-repository, malformed-response and rate-limit branches require source review; they were not all exercised against live GitHub. This is a verified first implementation step, not production regression coverage.

### Verification and checkpoint

`bun install --frozen-lockfile` passed. `bun run check` passed formatting, lint, both workspace typechecks and the single existing CLI smoke test. `git diff --check` passed. Independent read-only review found no actionable issues in URL/response validation, request cleanup, redaction, exports or package boundaries.

The CLI source, existing test files and tool/runtime version pins were unchanged. Task 1 is complete; Task 2 will introduce repository/revision inputs and immutable Git snapshots. There is no context-engine package placeholder.

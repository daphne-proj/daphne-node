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

`PullRequestRef` identifies a GitHub PR; it is not a context-engine input. The future CLI will explicitly copy repository locations and commit IDs into git-source's `RepositoryComparisonInput`. Neither library needs to import the other.

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

## Step 2: Own immutable comparisons in git-source

This step implements `@daphne/git-source`. It does not implement a context builder, evidence session or retrieval tool. PR metadata resolution is unchanged; the host will copy its repository URLs and commits into Git input.

### Read the code in this order

1. [Public exports](../packages/git-source/src/index.ts): two operations, Git input/data types, four limits and typed errors. There are no arbitrary-command, private-directory, PR or context exports.
2. [Contracts](../packages/git-source/src/contracts.ts): `RepositoryComparisonInput` describes remote acquisition; `GitSnapshotIdentity` records target/base/head separately. `GitChange` describes file status, kind, modes and hunk coordinates.
3. [Limits](../packages/git-source/src/limits.ts): acquisition is capped at 300,000 ms; an inventory operation at 30,000 ms; each subprocess captures at most 16,777,216 combined stdout/stderr bytes; each classified blob is at most 2,097,152 bytes. Inventory also caps accumulated raw/patch output. Overrides may only lower defaults. These are Git limits, not tool-response or context budgets.
4. [Process control](../packages/git-source/src/process.ts): commands use argument arrays, no shell, a controlled environment and disabled executable Git helpers. Stderr is counted but not returned. Cancellation terminates the process group and waits for child closure; errors omit raw command output and caller reasons.
5. [Snapshot lifecycle](../packages/git-source/src/snapshot.ts): remote acquisition fetches exact target/head commits and history into a private bare repository. Validation requires complete SHA-1 history and exactly one merge base. Private refs retain the selected commits.
6. In that same file, `withSnapshot` leases private state while an operation runs. The public `close()` aborts active operations, waits for them and removes only the owned directory. It is idempotent; closed or foreign handles are rejected. The caller must close successfully acquired snapshots in `finally`.
7. [Change inventory](../packages/git-source/src/changes.ts): parse NUL-delimited raw paths, sort by UTF-8 path bytes, classify file modes/content and derive zero-context hunk coordinates from blob-to-blob diffs. Rename detection uses 50% similarity and the Myers algorithm. Filenames are never recovered from display patch headers.

### The important distinctions

A PR target tip can contain commits absent from the feature branch. The merge base is their shared ancestor; comparing base to head isolates the feature branch's changes. Moving a branch after acquisition cannot change the recorded object IDs or copied objects.

A snapshot is a live resource. Its identity and change records are immutable data. The host owns the live resource lifetime; future context-engine code will retain supplied evidence data without a snapshot handle or cleanup responsibility. Assembly after Git closes will be demonstrated in Step 5, when that package exists.

Git-source contains no downstream package imports and no PR imports. The old context-engine draft/build registration was removed, and the workspace now registers git-source. Review-evidence and context-engine remain unimplemented, without empty workspaces. Static lint restrictions enforce the current package direction and I/O-free contracts/limits.

### Try the compiled public API

Run `bun run build` from the root, then enter `packages/git-source`. Use remote URLs and exact commits resolved from a public PR:

```sh
node --input-type=module <<'JS'
import {
  defaultGitLimits,
  acquireSnapshot,
  listSnapshotChanges,
} from '@daphne/git-source';

const options = {
  signal: new AbortController().signal,
  limits: defaultGitLimits,
};

const snapshot = await acquireSnapshot({
  targetRepositoryUrl: 'https://github.com/daphne-proj/pr-review-test.git',
  headRepositoryUrl: 'https://github.com/daphne-proj/pr-review-test.git',
  targetCommit: '3f0d15e8834c098d26b428bad1b325e6f33d9755',
  headCommit: '93076efe37909ef3f36480170048cc9387aa29be',
}, options);

try {
  console.log(snapshot.identity);
  console.log(await listSnapshotChanges(snapshot, options));
} finally {
  await snapshot.close();
}
JS
```

The application workflow starts from a PR URL, resolved by pr-review. Git-source receives only the resulting canonical remote URLs and commits. Local checkout input is not supported; the private temporary bare repository is still required internally.

### Historical results after rehoming

These observations predate the removal of local acquisition and are not instructions for the current API. The manual demonstration used a disposable repository, the compiled `@daphne/git-source` exports, Node 24.22.0 and Git 2.54.0 on macOS.

- Target `dac5861982d479a2b528a1426d72376bcd6fa98a`, merge base `93ac9f8f3275d6ac01a9dfcdc5d21cb335ccc916`, and head `da33cc9847e62c0b35bec992581aa1331acf08c8` matched ordinary Git. Target-only content was absent from the inventory.
- Seven changes matched `git diff --name-status --find-renames=50%`: ordinary text, binary data, empty text, invalid-UTF-8 content marked unsupported, a symlink, a filename containing tab/newline, and a rename.
- Acquisition left the source refs/status unchanged. Moving its feature ref afterward left the snapshot's head and inventory unchanged.
- Closing twice succeeded; subsequent access returned `closed`. Closing during inventory cancelled the pending operation before disposal completed.
- Missing commit returned `git`; in-flight abort returned `cancelled`; 1 ms acquisition returned `timeout`; a one-byte output cap returned `output_limit`. Disallowed origins, unknown context-only limit names, zero limits and raised limits were rejected.
- Source-configured executable helpers and inherited Git config did not run: the disposable helper's marker stayed absent, and inventory still contained seven changes.
- Remote acquisition of `https://github.com/daphne-proj/pr-review-test.git` at the Step 1 commits returned base equal to target and 36 changes. The first README insertion had before-count 0 and after-count 7. No PR package or token was used.
- All these runs left no new owned `daphne-git-` temporary directories.

Earlier draft demonstrations also rejected shallow/alternate-object repositories, unrelated histories and multiple merge bases. These are recorded as draft evidence, not a repeat verification of every branch after relocation. A live distinct-fork origin and Linux execution were not exercised in this step; source review checks the two-origin argument construction and platform paths.

### Limits and next step

The adapter initially supports complete SHA-1 repositories on macOS/Linux and public canonical HTTPS GitHub origins. Non-UTF-8 paths are rejected; binary, symlink, submodule and oversized/invalid text content receive explicit inventory classifications. Disk/network transfer quotas are not implemented. No reviewed-repository code is executed.

No tests, fixtures, harnesses or runtime dependencies were added. The existing CLI smoke test cannot establish regression coverage for these Git behaviors. Step 3 will expose exact blob reads and introduce review-evidence source materialization; no context assembly is needed for that step.

### Step 2 verification

After relocation, `bun install --frozen-lockfile` and `bun run check` passed: formatting, lint, three workspace typechecks, build and the one existing CLI smoke test. `git diff --check` passed. An independent read-only reviewer found no actionable issues in contract ownership, subprocess controls, exact revisions, lifecycle leases, deterministic inventory or configuration.

PR source, CLI source, existing tests and runtime/tool version pins were unchanged. Task 2 is complete on main. The next checkpoint is Step 3; it has not been implemented.

### Remote-only scope follow-up

Local acquisition and its public contract were removed after the Step 2 review. Remote acquisition now has a direct implementation without the former population callback. The existing full check gate and frozen install passed. A manual check through compiled public exports fetched the same exact remote commits and 36 changes, confirmed the local export is absent, rejected a file URL, checked pre-aborted cancellation, and verified idempotent close plus rejection of reads after close. No new test files or dependencies were added. The current follow-up was self-reviewed; the independent review above applies to the earlier Step 2 implementation.

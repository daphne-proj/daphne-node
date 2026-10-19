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

## Step 3: Read exact blobs and materialize evidence

The plan now defers hunk-to-byte conversion and tool response/page limits to Step 4. This step accepts byte ranges directly. It preserves the remote-only acquisition API introduced after Step 2.

### Read the code in this order

1. [Git source reader](../packages/git-source/src/source.ts): `readSnapshotBlob` validates a literal repository-relative path and a BASE/HEAD side, then resolves exactly that entry in the pinned tree. NUL-delimited tree output keeps unusual filenames distinct. Only a regular-file blob can be read; symlinks/submodules are never followed or materialized.
2. In the same file, `readBlobBytes` checks the object size before reading and verifies the returned length. It is package-internal and shared with inventory classification, so blob limits have one implementation. Its bytes belong to the result; mutating them cannot alter snapshot state or a later read.
3. [Evidence contracts](../packages/review-evidence/src/contracts.ts): identity, side, half-open byte range, source reference and source text. This file has no imports and the `./contracts` package export resolves directly to its compiled module. Future context code can import these types without loading Git/retrieval code.
4. [Borrowing session](../packages/review-evidence/src/session.ts): `createEvidenceSession` copies immutable comparison metadata and captures validated Git limits. It exposes `identity` and `readSource`, with no acquisition or cleanup methods. Options contain only `signal` and `gitLimits`; tool limits do not exist yet.
5. [Evidence materialization](../packages/review-evidence/src/source.ts): validate and copy input before awaiting Git, validate full-blob UTF-8, reject binary text, check byte-range bounds and character boundaries, and decode the exact slice while preserving BOM/CRLF. Freeze the returned evidence, reference and range.
6. [Evidence errors](../packages/review-evidence/src/errors.ts): invalid input differs from unavailable source. Git cancellation/deadline/output/lifecycle failures propagate as operation failures rather than becoming empty text.

### Why two source readers?

Git-source establishes which bytes exist at a commit/path. Review-evidence establishes which exact text range those bytes support and attaches session provenance. Neither chooses evidence for a model. The host still closes Git in `finally`; returned evidence remains ordinary immutable data after cleanup.

`SourceRef` contains session ID, side, exact commit, path, blob ID and byte range. The caller supplies only side/path/range; the implementation derives the remaining facts. A future model cannot override the session or commit through this API.

For example, the observed `×` occupies bytes `[517, 519)` in `apps/admin/src/order-table.ts`. Reading those two bytes returns one character. Starting at byte 518 is rejected, including an empty range there. Valid empty excerpts on character boundaries remain valid; absent files are unavailable, not empty.

### Use the public APIs

From `packages/review-evidence` after `bun run build`:

```js
import { acquireSnapshot, defaultGitLimits } from '@daphne/git-source';
import {
  createEvidenceSession,
  defaultEvidenceLimits,
} from '@daphne/review-evidence';

const signal = new AbortController().signal;
const snapshot = await acquireSnapshot(
  {
    targetRepositoryUrl: 'https://github.com/daphne-proj/pr-review-test.git',
    headRepositoryUrl: 'https://github.com/daphne-proj/pr-review-test.git',
    targetCommit: '3f0d15e8834c098d26b428bad1b325e6f33d9755',
    headCommit: '93076efe37909ef3f36480170048cc9387aa29be',
  },
  {
    signal,
    limits: defaultGitLimits,
  },
);

try {
  const session = createEvidenceSession(snapshot, {
    signal,
    gitLimits: defaultGitLimits,
    limits: defaultEvidenceLimits,
  });

  const source = await session.readSource({
    side: 'head',
    path: 'README.md',
    range: { startByte: 0, endByte: 10 },
  });

  console.log(source);
} finally {
  await snapshot.close();
}
```

The recorded example text is `# Commerce`. Step 3 does not create a context engine, tools, cursor state or a CLI command.

### Failure meanings

| Outcome                                   | Meaning                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `EvidenceInputError`                      | Malformed side/path/range, unsafe offsets, out-of-bounds or split UTF-8 character |
| `SourceUnavailableError.reason = missing` | No file at the requested path on that side                                        |
| `symlink`, `submodule`, `not_regular`     | A tree entry exists but cannot be read as ordinary source                         |
| `too_large`                               | Blob exceeds the source byte cap and is not loaded                                |
| `binary`, `invalid_utf8`                  | Bytes cannot be represented as supported source text                              |
| `GitOperationError`                       | Git/output/deadline/cancellation/closed-snapshot failure; not source absence      |

### Observed manual results

Using the existing public demonstration commits, Node 24.22.0 and Git 2.54.0 on macOS:

- README bytes and blob ID matched an independent `git show` / `git rev-parse` in a separate disposable bare repository. The 1,120-byte HEAD file round-tripped exactly through evidence text.
- Mutating the returned Git Buffer left a subsequent read unchanged.
- Reading `×` at bytes `[517,519)` succeeded; splitting its UTF-8 encoding or placing an empty range inside it failed.
- Changing a pending request's side, path and range did not change its captured reference or excerpt.
- BASE and HEAD README reads recorded their respective pinned commits and distinct blob IDs. The added admin file was unavailable on BASE.
- Valid empty excerpts succeeded. Missing paths, directories, traversal, unsafe integers, oversized ranges, invalid sides and null requests produced the expected distinct errors.
- A one-byte blob cap produced `SourceUnavailableError(too_large)`; a one-byte Git output cap produced `GitOperationError(output_limit)`; a one-millisecond operation deadline produced `timeout`.
- Cancellation did not echo the caller's reason. Closing during a read cancelled it; subsequent reads returned `closed`. Already returned evidence remained readable.
- Inventory still returned 36 changes after sharing the bounded blob reader. All temporary snapshots and the independent oracle repository were removed.
- Emitted `contracts.js` contains only an empty export and a source-map comment, with no runtime import.

The selected changed files did not supply emoji, BOM, CRLF, empty-file, deletion, symlink/submodule, binary or invalid-UTF-8 examples. Those branches were inspected in source but not all exercised live. No local acquisition API, synthetic fixture repository or replacement test harness was added to cover them.

Independent read-only review found no actionable source findings. New behavior has manual evidence and source review, not automated regression coverage.

### Final Step 3 verification

- `bun install --frozen-lockfile`: passed without lockfile changes.
- `bun run check`: passed formatting, lint, workspace builds/typechecks and the one existing CLI smoke test.
- `git diff --check`: passed.
- Source review found no actionable issues; the manual results and uncovered cases are recorded above.
- No new tests, fixtures, harnesses or third-party runtime dependencies. PR/CLI source and runtime/tool pins are unchanged.

Step 3 is complete on main. The next learning checkpoint is Step 4: bounded repository operations in review-evidence.

## Step 4: Execute bounded repository tools

The plan now specifies three-line hunk margins, stable/retryable pagination, explicit completeness and resource ownership. This step is authorized on main without new tests or a commit. Context-engine is still absent.

### Read the implementation in this order

1. [Tool contracts](../packages/review-evidence/src/contracts.ts) define data-only requests, changes, search hits, notices and results. Every result includes identity and the normalized request. There are no Git or runtime imports.
2. [Request validation](../packages/review-evidence/src/tools/validate.ts) rejects unknown fields, invalid sides/paths/ranges, multiline queries and invalid limits. `execute` validates at runtime even for typed callers, and copies input before I/O.
3. [Git search](../packages/git-source/src/source.ts) runs a bounded fixed-string search against the selected pinned commit. It returns validated NUL-delimited matching-file records. Literal directory pruning and final path-prefix filtering do not enable wildcard or shell interpretation.
4. [Repository operations](../packages/review-evidence/src/tools/operations.ts) project Git changes into evidence-owned data, materialize source, inspect hunks and derive navigation hits from validated candidate bytes. Search ordering is byte-sorted path then ascending nonoverlapping match offset. Previews are bounded to a 240-byte window; they never become source evidence.
5. [Hunk windows](../packages/review-evidence/src/tools/hunks.ts) convert BASE and HEAD line coordinates separately, using a fixed three-line margin and merged overlapping/adjacent windows. Line offsets are computed once per blob. Zero-count hunks anchor after the preceding line. Pure renames/mode changes can have no source windows.
6. [Pagination](../packages/review-evidence/src/tools/execute.ts) admits entries/notices against the complete serialized JSON size and their page caps. It splits source at character boundaries and records each delivered byte range. Indivisible items or an envelope that cannot fit fail explicitly.
7. [Cursors](../packages/review-evidence/src/tools/cursor.ts) authenticate normalized query/effective limits and position with one private key per evidence session. There is no cursor registry or response history. Replaying a cursor regenerates bounded observations; tokens are not consumed by attempts.

### Example host workflow

Create a session using `signal`, `gitLimits` and `limits: defaultEvidenceLimits`, then:

```ts
const changes = await session.execute({
  name: 'list_changes',
  pageSize: 10,
});

const detail = await session.execute({
  name: 'inspect_change',
  changeId: 'change-1',
});

const navigation = await session.execute({
  name: 'search_code',
  side: 'head',
  query: 'total',
  pathPrefix: 'apps/admin/',
  pageSize: 2,
});

if (changes.nextCursor !== null) {
  const next = await session.execute({
    ...changes.request,
    cursor: changes.nextCursor,
  });

  console.log(next.entries);
}

console.log(detail.entries, navigation.entries);
```

The host decides what to retain and when to ask for another page. It still closes the Git snapshot in `finally`. Future context-engine receives only supplied data; it will not accept this session, execute its requests or follow its cursors.

### Completion and failure behavior

- `complete` without a cursor means this requested query completed within its declared scope.
- `partial` with a cursor offers more observations. A successful continued page always makes progress.
- `partial` without a cursor preserves limitations. If earlier pages contained unavailable source, a later otherwise-successful page includes an `earlier_unavailable` notice.
- `unavailable` means the query supplied no requested evidence. A real empty source range and a successful no-match search are different outcomes.
- Invalid requests/cursors throw `EvidenceInputError`; unrepresentable responses throw `EvidenceLimitError`; Git output/deadline/cancellation failures remain operation errors.

The default response cap is 16,384 bytes, including JSON escaping, identity, request, provenance, notices and cursor. Both entries and notices arrays are individually capped at 100, lowered by list/search page size or session configuration. Bytes are not tokens.

### Work bounds and review decisions

Git search/inventory must complete within Git limits before their output can establish completeness. Candidate matching-file records are bounded; individual source blobs retain their 2 MiB cap. Final path-prefix filtering can discard candidates from the containing directory after the Git output cap applies. Binary files excluded by Git are outside the declared regular-text search scope; unsupported matching candidates produce notices.

Pagination retains the current page, bounded underlying query data and one lookahead observation. Continuations recompute prior observations rather than caching them. The host owns the total workflow deadline. The direct `readSource` API remains a host primitive with the blob cap; the serialized-response cap applies to `execute`.

Independent review found avoidable repeated long-line scans and delayed timer cancellation during replay. Search now advances one newline position and restricts preview scans to its display window. Blob text is validated once before hunk slices. Replay yields to Node every 128 skipped observations, then checks cancellation. The reviewer confirmed both fixes and found no new actionable issue.

### Observed manual demonstrations

Using the existing public demonstration comparison and compiled public exports:

- Inventory produced all 36 unique changes across four pages; retrying the same cursor returned an identical page.
- The 1,120-byte README reconstructed exactly across nine responses capped at 1,000 JSON bytes.
- Inspection returned separate BASE and HEAD README windows. Their byte references remain independent.
- Scoped `export` search produced 16 pages at one hit per page; reading each hit's exact range returned the query.
- Changed query, page size, byte budget, altered cursor and a different evidence-session instance were rejected.
- Literal partial filename prefixes worked; a prefix containing `[` did not become a glob. A no-match search returned a complete empty result.
- The 952-byte admin source containing `×` reconstructed exactly across five 1,100-byte responses, including JSON escaping.
- Missing BASE source was unavailable; a valid empty range was complete. Split UTF-8, traversal, unknown fields, bad change IDs and a one-byte response budget failed explicitly.
- With a 600-byte blob cap and one-item pages, search returned supported hits and three oversized-source notices; its terminal page stayed partial and retained an earlier-limitation notice.

- A one-byte Git output cap returned `output_limit`, cancellation returned `cancelled`, a one-millisecond Git deadline returned `timeout`, and post-close retrieval returned `closed`. Owned snapshots were cleaned.
- Paginated inspection reconstructed the same BASE/HEAD windows as unpaged inspection across four 1,100-byte pages, with change metadata emitted once.
- Mutating request side/path/range after invocation did not change captured input or returned evidence. Results and their data records are frozen.

### Final Step 4 verification

`bun install --frozen-lockfile` and `bun run check` passed: formatting, lint, builds/workspace typechecks and the one existing CLI test. `git diff --check` passed. The compiled contracts module still contains no runtime imports. Independent review confirmed its two findings were resolved.

No new tests, fixtures, harnesses, packages or runtime dependencies were added. CLI/PR implementation, tool/runtime pins and lockfile remain unchanged. The work remains uncommitted on main, as requested.

The selected example did not exercise every BOM/CRLF, emoji, empty-file, deletion, symlink/submodule or invalid-text case. Large/minified-file replay was inspected and corrected but not stress-benchmarked. New behavior has manual verification and source review, not automated regression coverage. RCI/PCG indexing, context assembly and CLI/model integration remain future work.

## Step 5: Retain supplied evidence and assemble context

Step 4 was subsequently committed by the user as `7c216e1`. Step 5 adds the context-engine workspace on main, with no new tests and no commit. No Git-source, PR or retrieval implementation changes are needed.

### Read the code in this order

1. [Public facade](../packages/context-engine/src/engine.ts) takes an identity and context limits. Its methods are retain, record, evidence and assemble. There is no execute or close method because the host owns retrieval and resources.
2. [Data contracts](../packages/context-engine/src/contracts.ts) distinguish retained source, recorded page/query progress, immutable snapshots, assembly selection and packets. Page history references evidence IDs rather than storing source text twice.
3. [Validation](../packages/context-engine/src/validation.ts) captures plain supplied data and checks session/side/commit identity, UTF-8 byte ranges, tool-result structure and local consistency. Types do not make deserialized input trustworthy. Repository correspondence remains the evidence producer's responsibility.
4. [Evidence ledger](../packages/context-engine/src/evidence.ts) stages each retain/record transaction, checks conflicts and the complete serialized budget, then replaces immutable state. Failed transactions do not consume IDs or advance page progress. Snapshot reconstruction reuses these invariants.
5. [Limits](../packages/context-engine/src/limits.ts) separate 4 MiB retained data from 64 KiB rendered packets. Both can be lowered. There is no eviction: the host receives an explicit limit error and chooses what to do next.
6. [Assembly](../packages/context-engine/src/assembly.ts) captures a snapshot and the selection before any asynchronous token count. It admits whole source entries by host priority, then navigation in recorded order, while preserving query completion summaries and omission metadata.

### Why retain more than one packet?

A review may retrieve several excerpts while investigating a change, then assemble different selections for different questions. Dropping an excerpt from one model-facing packet must not erase it from the evidence ledger.

Four MiB is a conservative initial policy with room for many bounded tool responses and multiple 64 KiB projections. The complete serialized size includes provenance, pagination and escaping, so it is not simply a source-text allowance. Source references in history avoid a second copy of the same excerpt. Exact heap usage, transient candidate allocations and throughput require measurement later.

### Follow one result through the system

The host executes `inspect_change` in review-evidence. It receives change navigation plus exact BASE/HEAD source windows and explicitly calls `context.record(page)`. The ledger validates the whole page, assigns/reuses source IDs, stores navigation and records its cursor/completeness. Only then does it publish new state.

The host can close Git now. It chooses evidence IDs for assembly. The assembler renders that source with provenance, recorded navigation, query summaries and limitations, measures the actual JSON string, and removes lower-priority whole entries if needed. It returns a packet without changing the ledger.

A search preview stays navigation until the host explicitly retrieves exact source and records or retains it. An open/partial/unavailable query remains visible even when its detailed notice cannot fit. A null cursor alone does not prove completeness.

See the [package example](../packages/context-engine/README.md#host-example) for the public calls. For standalone assembly, pass `JSON.parse(JSON.stringify(context.evidence()))` to `assembleContext` with the same selection; no live engine or repository is required.

### Observed manual demonstrations

Compiled public exports were exercised inline against the existing public comparison used in Steps 2–4. All acquired snapshots were closed in `finally`; no demonstration file or replacement test harness was added.

- Two list pages, one full README read and one inspection retained four distinct source excerpts across three queries. Identical page retries did not alter state.
- After Git cleanup, assembly produced a 5,213-byte packet with all four sources and a 4,042-byte packet omitting the last selected source. Counts matched UTF-8 rendering exactly; neither assembly changed retention.
- JSON-roundtripped snapshots reproduced the packet ID. Unknown evidence IDs and a one-byte packet allowance failed explicitly.
- Duplicate source references reused IDs; consistent overlapping source stayed separate. Conflicting text/blob identity, a foreign session, incorrect byte length and out-of-order/conflicting pages failed without changing state.
- A conflicting second source in a page rolled back the first source and all page progress. Exact serialized retention capacity accepted the source; one byte less rejected it without consuming the next ID. A page exceeding its cap also left both sources and queries unchanged.
- A named demonstration callback counted UTF-8 bytes to exercise the optional counter API; it was explicitly not a tokenizer. Its reported count matched the rendering, and a negative count failed.
- Mutating a caller snapshot and selected-ID array while a counter awaited did not change the captured packet.

### Review and final verification

Independent source review found no actionable issue in retention atomicity, query-chain handling, immutable capture, snapshot reconstruction, budget admission or runtime separation. Emitted JavaScript imports only local modules and Node crypto.

Additional demonstrations confirmed search previews remain navigation, cursor cycles fail, unavailable results never establish completion, mutable supplied source is copied, altered snapshot fingerprints fail, configured engine and token caps are enforced, and a concurrent retain does not change an assembly already waiting on its counter.

Frozen install and the full existing check gate passed: formatting, lint, builds, all five workspace typechecks and the one existing CLI smoke test. Inline ESLint checks allowed evidence-contract type imports and rejected runtime evidence imports, Git types and filesystem imports. Diff whitespace and local documentation links passed. No application, Git-source, PR or retrieval source was changed. HEAD remains 7c216e1 on main; nothing is staged or committed. No new automated regression coverage is authorized. Model delivery, actual provider tokenization and worst-case performance near the retention cap are outside this step. CLI composition remains Step 6.

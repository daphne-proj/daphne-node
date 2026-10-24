# Frozen split-pr cases

The suite lists case files in evaluation order, relative to this directory. Each case preserves the original identity, change inventory and source excerpts. The first case, `pr-review-test-2`, was imported from `outputs/split-pr-20261023-192117-87636/run.json`, for [PR 2](https://github.com/daphne-proj/pr-review-test/pull/2). Its four changes and six original units remain unchanged. The ignored source artifact is not needed to load the saved case.

All imported cases start in `development` with `review.status: "draft"` and no labels. A valid draft is not a reviewed benchmark. Generated proposals, raw responses and existing scores are not imported as reference answers.

The first case now has 15 pair labels proposed by an isolated LLM judge and explicitly approved by the user in chat on 2026-10-24: three together and twelve separate. It is marked reviewed and remains in development. The judge used only the frozen evidence; its missing-context notes remain in the case.

## Add and review a case

From the repository root:

```sh
bun run build
bun run eval -- split-pr import --artifact outputs/YOUR_RUN/run.json --case-id YOUR_CASE --output apps/eval/datasets/split-pr/cases/YOUR_CASE.json
bun run eval -- split-pr validate --suite apps/eval/datasets/split-pr/suite.json
```

Create the output parent first. Import refuses to overwrite an existing file and does not modify the suite. Add the new relative filename to `suite.json`, then validate again. Both commands run locally without model calls or Langfuse initialization.

Add pair labels using original unit IDs such as `change-3:0`. A text hunk uses `changeId:hunkIndex`; metadata-only changes use `changeId:metadata`. Each label has `leftUnitId`, `rightUnitId`, `relation` and a nonblank `reason`:

- `together`: correctness or a single review responsibility requires these units in the same group.
- `separate`: these units represent independent responsibilities that should be reviewed separately.
- `unknown`: supplied evidence is insufficient to adjudicate the relationship. Unlabeled pairs are also unscored.

Do not label a unit against itself or repeat a pair in either order. Together relationships are transitive: A together B and B together C cannot coexist with A separate C. Several groupings may satisfy the same labels. Use `notes` for absent context and `tags` for relevant categories.

After human review, replace the review object with `status: "reviewed"`, a nonblank `reviewer` and an ISO UTC `reviewedAt`. Assign the partition deliberately; related revisions belong to the same partition. Synthetic cases use provenance kind `synthetic`, `capturedAt` and a nonblank `constructionSource`. Do not fabricate reviewer approval.

## Validation and provenance

Validation checks schema versions, pinned Git IDs, inventory coverage, source membership/byte lengths, conflicting blobs or overlapping excerpts, label consistency and suite path containment. Empty diffs and empty source anchors are valid. A failed acquisition is not an empty diff; failed imports require a positive token-count or generation call counter, which the current workflow only increments after acquisition.

Artifact provenance records its original byte SHA-256, PR URL and the time its evidence was frozen by import (`capturedAt`). `caseHash` covers exact saved case bytes; `inputHash` covers a fixed-order projection of evidence only; `datasetHash` covers suite bytes and the ordered case IDs/hashes. Editing labels changes the case/dataset hashes without changing the input hash. Validation prints those hashes, partition/review counts, tags, unit counts and label support.

Validation establishes internal consistency. It does not authenticate excerpts against Git blobs, judge semantic quality, or upload anything to Langfuse. Use the evaluation app's [saved-run scoring command](../../README.md#score-a-saved-split-pr-run) to compare an output with reviewed labels without another model call.

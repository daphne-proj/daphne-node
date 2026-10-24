# Frozen split-pr cases

The suite lists case files in evaluation order, relative to this directory. Each case preserves the original identity, change inventory and source excerpts. Current captures are `pr_1_1.json` and `pr_2_1.json`; both are drafts. The suite still refers to the missing old `pr-review-test-2.json`. Individual validation and comparison commands load the case directly and do not require or alter suite registration. The ignored source artifact is not needed to validate a saved case, but comparison needs its saved predicted groups.

All imported cases start in `development` with `review.status: "draft"` and no labels. A valid draft is not a reviewed benchmark. Generated proposals, raw responses and existing scores are not imported as reference answers.

## Add and review a case

To capture a PR and create its draft case, run:

```sh
make split-pr-case PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

This runs the splitter with live GitHub/OpenAI access, then imports its evidence locally. It selects matching available names such as `outputs/pr_2_1/run.json` and `apps/eval/datasets/split-pr/cases/pr_2_1.json`; repeated runs increment the suffix. The case has `labels: []` and `review.status: "draft"`. No labels, review approval, suite registration or Langfuse upload happen automatically. Failed splits still attempt import when an artifact exists, while retaining a nonzero exit status; incomplete acquisition is rejected by the importer.

For model-assisted annotation, give a fresh isolated session only this draft case and the rubric below. Do not include the full run artifact, generated proposal or scores. Review the suggested relationships against evidence before looking at the splitter's output. Related captures of the same PR belong to the same partition, not independent holdout samples.

To import an existing artifact instead, use the offline commands below.

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

Check a draft after annotation, before human approval or suite registration:

```sh
make split-pr-validate CASE=apps/eval/datasets/split-pr/cases/pr_1_1.json
```

This offline check prints structural validation and explicit label coverage, including unknown/unlabeled pairs and units without any together/separate labels. It preserves the file and its review status. A valid result does not establish that the labels are semantically correct; see the [coverage definitions](../../README.md#import-and-validate-split-pr-cases).

To compare the splitter's saved groups with these labels:

```sh
make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1_1.json ARTIFACT=outputs/pr_1_1/run.json
```

This offline comparison validates matching evidence and exact unit coverage, prints a compact score summary, and saves together/separate agreement and violated pairs with reasons in a new report beside the artifact. Draft results remain marked `Labels draft`; case bytes and review status remain unchanged. Unknown/unlabeled pairs are unscored, and zero label support has no agreement rate. Poor scores still complete successfully; invalid inputs, failed saved runs and invalid predictions exit nonzero. See [report details](../../README.md#compare-a-saved-split-pr-run). Structural acceptance and annotation coverage do not measure quality.

After human review, replace the review object with `status: "reviewed"`, a nonblank `reviewer` and an ISO UTC `reviewedAt`. Assign the partition deliberately; related revisions belong to the same partition. Synthetic cases use provenance kind `synthetic`, `capturedAt` and a nonblank `constructionSource`. Do not fabricate reviewer approval.

## Validation and provenance

Validation checks schema versions, pinned Git IDs, inventory coverage, source membership/byte lengths, conflicting blobs or overlapping excerpts, label consistency and suite path containment. Empty diffs and empty source anchors are valid. A failed acquisition is not an empty diff; failed imports require a positive token-count or generation call counter, which the current workflow only increments after acquisition.

Artifact provenance records its original byte SHA-256, PR URL and the time its evidence was frozen by import (`capturedAt`). `caseHash` covers exact saved case bytes; `inputHash` covers a fixed-order projection of evidence only; `datasetHash` covers suite bytes and the ordered case IDs/hashes. Editing labels changes the case/dataset hashes without changing the input hash. Validation prints those hashes, partition/review counts, tags, unit counts and label support.

Validation establishes internal consistency. It does not authenticate excerpts against Git blobs, judge semantic quality, or upload anything to Langfuse. Use the evaluation app's [saved-run comparison command](../../README.md#compare-a-saved-split-pr-run) to compare an output with labels without another model call; draft comparisons remain provisional.

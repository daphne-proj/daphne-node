# Split-pr dataset

Gold files in `cases/` contain only `together` and `separate` hunk-ID pairs. See the [labeling policy](cases/README.md). Each capture folder contains one `run.json`, holding the frozen evidence and splitter output. Optional `caseMetadata` in that file holds partition, tags, provenance, notes and review status; missing metadata means a development draft.

`outputs/` is ignored by Git. Preserve its runs alongside the gold files when sharing the dataset.

## Manual ownership

The gold files in `cases/` are created and edited manually. Repository commands only read this directory. CLI/eval output writers reject it and symlink aliases as destinations, and repository formatting skips it.

Capture model output separately:

```sh
make split-pr PR=https://github.com/daphne-proj/pr-review-test/pull/2
```

This writes `outputs/split_pr_2/run.json`, atomically replacing the previous report on a rerun. It never creates gold files, labels or suite entries. Save captures elsewhere before rerunning if you need their evidence, predictions or review metadata later.

Annotate using only the run's `identity`, `changes` and `hunks`. Keep generated proposals, responses and scores out of the annotation session. Record actual approval in `run.json` under `caseMetadata.review`, with `status: "reviewed"`, the actual `reviewer` and ISO UTC `reviewedAt`. Never claim human approval for AI annotation. Related captures belong to the same partition.

## Validate and compare

```sh
make split-pr-validate CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json
make split-pr-eval-all
make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json
bun run eval -- split-pr validate --suite apps/eval/datasets/split-pr/suite.json
```

Validation defaults to `outputs/split_<gold filename>/run.json`; pass `ARTIFACT=PATH` to validate another capture. Suite cases use the filename convention.

The batch Make target uses that capture path to find each PR URL, then runs the model again for every gold JSON, including cases absent from the suite. It saves fresh runs under a unique `outputs/split-pr-eval-all.*` directory and compares them with the gold labels. If the PR commits differ from the reference capture, it refuses to score that result. It continues through missing or invalid captures and failed runs, exiting nonzero if any run or evaluation cannot complete. The batch makes paid model calls and never changes the gold files or reference captures.

Direct comparison reads the supplied artifact and gold file only. It checks evidence consistency, label IDs and exact predicted unit coverage, then scores explicit pairs equally. Choose the capture the labels describe: minimal gold files contain no independent commit fingerprint. Suite scoring compares against its configured reference capture and requires review. Draft direct comparisons stay provisional.

Evaluation prints its result without creating files. To explicitly export a report, use `OUTPUT=NEW_FILE` outside both the capture folder and gold directory. Unlabeled pairs are unscored; zero support has no agreement rate. Neither validation nor comparison grants approval.

`caseHash` covers the parsed reference and exact gold bytes, excluding predictions; `inputHash` covers the evidence projection. `datasetHash` covers suite bytes and ordered case IDs/hashes. Removing redundant labels can change partial scores, so do not compare old and new percentages as model improvements.

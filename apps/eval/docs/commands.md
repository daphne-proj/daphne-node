# Evaluation command guide

See the [package overview](../README.md) for the main commands, types and dependencies. Run the commands below from the repository root.

The Node evaluation application reads and validates manually maintained split-pr datasets, scores saved outputs offline, and runs reviewed cases through live Langfuse experiments. It also provides a manual Langfuse integration check. The smoke command's two test files live together in [`tests/smoke`](../tests/smoke/README.md).

## Validate manually maintained split-pr cases

The golden dataset in `datasets/split-pr/cases` is maintained manually. Evaluation commands only read its files. CLI/eval output writers reject destinations inside this directory, including symlink aliases, before creating output files or directories. Repository formatting excludes the gold directory.

Capture model output separately with `make split-pr PR=URL`; it saves one `run.json` and does not create or edit gold cases. Evidence is read from that run, with optional review metadata under `caseMetadata`. Missing metadata means a development draft. Validation defaults to repository-root `outputs/split_<gold filename>/run.json`; use `--artifact PATH` when the capture and gold names differ. Suite cases use the filename convention and must be registered manually. Validation is offline and checks consistency, not approval.

Use `bun run eval -- split-pr validate --case PATH [--artifact PATH]` for one case, or `bun run eval -- split-pr validate --suite PATH` for the registered suite. Validation prints JSON and changes no case, review status or suite entry. Invalid input exits nonzero.

Each case summary reports label counts and coverage: all possible unordered pairs, unlabeled pairs, labeled-pair rate, known-pair count/rate and units with or without known relationships. A known relationship is `together` or `separate`; `unknown` contributes only to labeled coverage. Rates are fractions from 0 to 1, or `null` when there are fewer than two units. Only explicit labels count; transitive relationships are checked for contradictions but do not inflate coverage. These counts describe annotations, including draft proposals, not semantic correctness or human approval. Partial annotation is allowed; there is no minimum coverage gate.

## Compare a saved split-pr run

```sh
make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json
```

This builds and compares the saved groups directly against one case, without reading a suite or rerunning the splitter. It loads evidence directly from the supplied artifact, validates label IDs and exact unit coverage, and applies the deterministic pair scorer. No model calls, Git/network verification, credential loading or Langfuse initialization occur. Case and artifact bytes remain unchanged.

Run `make split-pr-eval-all` to rerun the model for every JSON case in the gold folder and compare each fresh output with its labels. The target reads each PR URL from its existing `outputs/split_<case filename without .json>/run.json`, builds once, and saves the new runs under a unique `outputs/split-pr-eval-all.*` directory. Each case directory contains both `run.json` and a deterministic `eval.json` score report. It refuses to score a PR whose commits or frozen evidence differ from the saved capture and continues after errors. Missing captures, failed model runs and invalid comparisons make the batch exit nonzero; label disagreements retain the individual evaluator's successful exit status. The target makes paid model calls and leaves the gold files and reference captures unchanged.

By default, direct comparison trusts the selected artifact as the input reference; choose the capture the labels describe, since minimal gold files contain no independent commit fingerprint. Suite scoring separately checks candidate evidence against the configured reference run, normalizing capture-specific session IDs.

Draft references are allowed as provisional comparisons: the report retains the original `review` object with `provisional: true`. Reviewed references retain their reviewer and timestamp with `provisional: false`. This command never approves labels; live benchmarks and the suite-based `score` command still require reviewed cases.

The terminal prints the overall `Score` line, counting each known together/separate label equally, followed by any violated pairs. Each violation shows the expected relationship and both unit IDs. An optional JSON export includes review status, annotation coverage, per-relation rates, validation details and violated pairs. Use `--reference PATH` with the direct evaluator when the labels belong to an original capture and the candidate is a later run; `split-pr-eval-all` supplies this automatically. Unknown and unlabeled pairs are never scored. Zero support prints `N/A` and stores a null rate; it cannot establish perfect agreement. Structural validity and annotation coverage are not quality scores.

`@daphne/cli/command-output` provides the shared `formatCommandOutput(title, rows)` helper for human-readable commands. It aligns labels and applies bold green for success, yellow for warnings and red for errors, respecting terminal color support and `NO_COLOR`. The split command uses it when stdout is a terminal and retains JSON summaries when redirected. The evaluation Make target suppresses command echo while preserving errors. Other commands retain their JSON output contracts.

By default evaluation prints a summary and creates no file. To explicitly export JSON, use `OUTPUT=NEW_FILE` in an existing directory outside the capture folder. Publication refuses to overwrite existing files. The equivalent compiled command without an export is:

```sh
bun run build
bun run eval -- split-pr eval \
  --case apps/eval/datasets/split-pr/cases/pr_1.json \
  --artifact outputs/split_pr_1/run.json
```

The `daphne-split-case-eval-v1` report contains source paths, case/input/artifact hashes, reference annotation coverage, unchanged review metadata, provisional status, all per-pair scores and fresh proposal validation diagnostics. Saved validation claims are ignored; the accepted proposal must also match the final grouping attempt.

The eval CLI exits `0` after a structurally accepted comparison, even when every known pair is violated or there are no known labels. Exit `1` means malformed/inconsistent inputs, a failed saved run, invalid predicted coverage/shape, cancellation or publication failure (Make propagates failure as a nonzero exit). Failed runs and invalid output can still export diagnostic reports with `status: "failed_run"` or `"invalid_output"` and null pair scores/rates. A completed comparison has `status: "complete"`; that status is not a quality verdict. Malformed inputs and mismatched evidence fail before publication.

## Upload saved batch scores to Langfuse

After `make split-pr-eval-all`, use the directory printed as `Fresh model runs`:

```sh
make split-pr-langfuse-upload RUN_DIR=outputs/split-pr-eval-all.XXXXXX
```

Set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` and `LANGFUSE_BASE_URL` in the environment or root `.env`. This explicit command reads the batch's `run.json` and `eval.json` files, recomputes every score against the registered gold case and original reference capture, and requires a report for every suite case before making a network call. It does not call the model. Old batches without `eval.json` can be scored offline with `split-pr eval --case ... --artifact ... --reference ... --output ...`; no model rerun is needed.

The `daphne-split-pr-saved` experiment receives case IDs and input hashes, expected pair labels, predicted group unit IDs, eight item scores and an `accepted_rate` run score. Per-item metadata includes the model, scorer inputs, review state and `provisional: true` for draft labels. Raw `run.json` content, model replies and source evidence stay local. Experiment task timing reflects the upload only; it is not original model latency or cost. Treat draft scores as exploratory until the labels are reviewed.

The uploader creates `langfuse-upload-attempt.json` before contacting Langfuse and writes `langfuse-upload.json` with the experiment link only after complete results and telemetry finalization. An attempt marker blocks another upload of the same directory, including after an uncertain network failure. If a failure leaves only the attempt marker, inspect the remote experiment by its saved `runName` before deciding whether to retry from a new copy of the batch. This guard prevents an accidental second upload; it cannot make remote writes transactional.

## Score a reviewed suite case

```sh
bun run build
bun run eval -- split-pr score \
  --suite apps/eval/datasets/split-pr/suite.json \
  --case-id YOUR_REVIEWED_CASE \
  --artifact outputs/YOUR_RUN/run.json \
  --output outputs/reviewed-case-scores.json
```

The selected case must be reviewed and registered in a valid suite. Every listed gold file and its configured reference run must be available locally. Direct-case comparison also supports drafts without granting approval. The command validates the v3 artifact's frozen evidence against the case's input hash, then uses the public split validator to recompute proposal shape and exact unit coverage. Saved validation claims are ignored. The source artifact remains unchanged, and the output must be a new file in an existing directory.

Each pair receives `1` when its expected relationship holds, `0` when violated, or `null` when unknown or unavailable. Together and separate rates have distinct denominators; unknown and unlabeled pairs contribute to neither. A class with no labels has a null rate. Failed runs and invalid proposals are unaccepted and have unavailable pair scores/rates; a retained valid reply cannot rescue a failed run. With scorer `split-pairs-v2`, `constraintsPassed` requires an accepted output, at least one known pair and satisfaction of every known pair. Earlier v1 reports treated zero known pairs as vacuously passing; v2 preserves pair rates but removes that misleading pass.

The versioned report includes all pair results, violated pairs, fresh validation diagnostics, first-reply/correction information and case/input/dataset/artifact hashes. It is also printed as JSON. Exit `0` means evaluation and report publication completed, even when the output scores poorly. Exit `1` means invalid evaluation inputs, an inconsistent artifact, cancellation or output failure. The command does not fetch Git, make model calls or initialize Langfuse. Scores measure agreement with the approved labels; they do not establish buildability or semantic correctness beyond those constraints.

## Run reviewed split-pr evaluations

```sh
bun run build
bun run eval -- split-pr run \
  --suite apps/eval/datasets/split-pr/suite.json \
  --partition development \
  --output outputs/split-pr-eval-first \
  --trials 1 \
  --concurrency 1
```

This explicitly calls OpenAI and writes experiments to Langfuse. Configure `OPENAI_API_KEY` and the three Langfuse variables below in your environment or root `.env`. Defaults are model `gpt-6.1-sol`, input budget `16384`, three independent trials and concurrency `2`; override them with `--model`, `--max-input-tokens`, `--trials` and `--concurrency`. The partition is required, every selected case must be reviewed, and the output directory must be new with an existing parent. Validation happens before credential loading or telemetry. The run uses frozen evidence without fetching GitHub or exposing labels to the splitter. Optional `--max-candidates N` and `--run-timeout-ms N` flags select one global policy for each case run; neither has a default. Each case resolves a fresh budget when its task starts, retaining the original deadline through preparation, model work and publication. The manifest records the selected policy and each result records its resolved budget. These settings are separate from per-request input/output capacities.

Each trial number creates one native experiment, with one item per selected case. Item scores are `completed`, `accepted`, `constraints_passed`, `together_rate`, `separate_rate`, `corrections`, `count_calls` and `generate_calls`. Unavailable rates use categorical `not_applicable`. The run's `accepted_rate` includes every scheduled case in its denominator, including missing or failed work. Acceptance means structurally valid output; `constraints_passed` additionally checks the reviewed relationships.

Langfuse stores the original compact evidence once as item input, reviewed labels as expected output, and only status plus proposal or sanitized error as output. Child `semantic-split`, `openai.count` and `openai.generate` observations record durations. Generations carry the actual response model and provider token usage, including usage from rejected replies. Cached input and reasoning output use separate, non-overlapping buckets. Count-endpoint estimates are not consumed tokens. Cost comes from matching Langfuse model prices; missing usage or prices means unavailable cost, never verified zero. Raw responses, replay items and repeated page text stay local.

The output directory contains an initial `scheduled.json`, full `trial-N-case-M.json` artifacts, and a final `manifest.json` with scores, hashes, Git commit/dirty state, prompt/schema hash, model configuration, SDK version and experiment links. Files are published without overwriting. Cancellation preserves completed work and every scheduled entry, including unstarted rounds. These artifacts support later regrading; they do not provide crash resume. A dirty-state flag identifies an uncommitted build but is not a source-code snapshot.

Exit `0` means all scheduled results, scores and telemetry finalization were accounted for, even when model quality is poor. Exit `1` means invalid configuration, cancellation, missing results/scores, artifact publication failure or a reported telemetry failure. The JSON summary separates quality failures from incomplete evaluation. Finalization failure retains local results and marks the manifest incomplete. Draft cases require review before live benchmarking; validation does not grant human approval. Agreement with a small reference set is not a general quality estimate. General regrading and reference/candidate comparisons remain future work.

## Run the smoke experiment

From the repository root, put these values in your ignored `.env` or export them. [.env.example](../../../.env.example) lists blank placeholders; preserve existing `.env` contents.

- `LANGFUSE_PUBLIC_KEY`
- `LANGFUSE_SECRET_KEY`
- `LANGFUSE_BASE_URL` — an explicit absolute HTTP(S) URL without embedded credentials, query or fragment.

```sh
bun install --frozen-lockfile
bun run build
bun run eval -- langfuse-smoke
```

Each invocation writes a new `daphne-langfuse-smoke` experiment to the configured instance. Its JSON summary includes `experimentUrl`, expected/returned case counts, both `exact_match` scores and `all_cases_pass`. Open the URL to inspect the two observations and confirm the scores arrived. No hosted dataset is created.

Exit `0` requires both case IDs exactly once, each required score exactly once, all three scores equal to `1`, an experiment URL, no cancellation and no reported SDK/export failure. Missing/duplicate cases and rejected evaluators cannot disappear from the success denominator. A score of zero is a recorded quality failure, not missing evaluation. Exit `1` means configuration, execution, scoring, cancellation or telemetry finalization failed. An already computed summary remains visible with failed status if finalization fails. Credentials and raw provider errors are not printed.

SIGINT/SIGTERM request cancellation. The command waits for the native runner and cleanup to settle before exiting unsuccessfully; the SDK has no experiment-level abort parameter. The five-second SDK timeout applies per supported manager/export request. Direct API calls and retries have their own defaults; this is not a whole-command deadline.

## Code ownership

- `src/main.ts` owns command dispatch, signals and final stdout/exit status; only explicitly live commands load `.env`.
- `src/split-pr` owns frozen dataset contracts, evidence and label validation, fingerprints, pure scoring, saved-run evaluation, uploads and live experiments. Its `langfuse-scores.ts` maps split scores for both live experiments and saved uploads.
- `src/parse.ts` provides JSON reading, primitive validation, hashing and the app's `EvaluationError`; case-specific validation stays with each evaluation.
- `src/artifacts.ts` publishes complete JSON files without overwriting existing files and preserves golden-dataset write protection.
- `src/model-calls.ts` records model-call observations, normalizes OpenAI usage and checks workflow call accounting. It also owns the recorded-call and token-usage types.
- `src/langfuse.ts` validates the explicit connection and owns one client/provider lifecycle across a command's experiments.
- `src/langfuse-diagnostics.ts` captures SDK/OTel errors that are logged without rejecting export promises. Logger changes are scoped to this command; do not embed this lifecycle alongside another telemetry provider.
- `src/experiment-completeness.ts` checks case identity and required-score accounting independently of score quality for live experiments, saved uploads and the smoke command.
- `tests/smoke/langfuse-smoke.ts` runs the manual integration check and returns a summary, printed only after finalization.

The build includes these smoke files because the command imports them. It preserves the folder structure under `dist/`; the command entry point is `dist/src/main.js`. Building and typechecking the files does not execute the smoke check.

## Judge saved intention cards

```sh
make intentions-eval ARTIFACT=outputs/intentions-CURRENT/run.json
```

This command makes a live Codex CLI call using the saved run's original generation instructions, pinned PR metadata, complete diff, delivered evidence and final cards. It reconstructs delivery per conversation, revalidates raw writer proposals and reviewer reports, and requires exact accepted-writer/review linkage before judging with the shared [rubric](../prompts/intentions.md). Failed host runs are never judged. The judge sees only accepted cards, writer-eligible evidence and writer instructions; runtime verdicts, iteration counts and model identity are excluded. Only host format `daphne-intentions-v2` is supported, with current policy and mandatory coverage accounting. Old formats and inconsistent traces are rejected; no compatibility parser, migration or fallback is provided. Saved historical artifacts remain untouched. It does not regenerate intentions, fetch repository context or upload to Langfuse.

Optional `OUTPUT=NEW_DIRECTORY` selects a fresh output directory with an existing parent; otherwise Make creates one under `outputs/`. `MODEL=NAME` overrides the default judge model. When the saved provider response lacks the original instructions, supply `GENERATION_PROMPT=PATH` pointing to their exact text. A supplied prompt must match embedded instructions when both exist; the evaluator never substitutes the current generation prompt.

Make prints only dimension scores and saves judge output in `OUTPUT/evaluation/`, with console output in `OUTPUT/evaluation.log`. `input.json` uses `daphne-intentions-judge-input-v2` and preserves the judge prompt, schema and provenance hashes. `report.json` uses `daphne-intentions-judge-v2` and records the structured judgment, diagnostics, execution details and `quality` summary. Both record `rubricVersion: 3` for the 1–5 scale. Gold reports also record `goldRubricVersion: 2`. Historical judge reports are neither rewritten nor reparsed under the new rubric; a regrade creates a fresh artifact. Failed runs and invalid outputs receive reports without a judge call. Low scores still yield a completed evaluation; malformed input, cancellation, missing or invalid judgments and publication failures exit unsuccessfully. Oversized judge input fails explicitly without truncating evidence. Unreadable or oversized artifact files fail before output creation; readable but invalid artifact data produces invalid_output with no judge call.

`quality` reports accuracy, citationSupport, coverage and combined priority as
`pass`, `issues_found` or `unassessed`. Scores 1–4 mean issues, 5 means pass and null
means unassessed. Any primary issue or non-why finding/omission makes priority
issues_found, even when another dimension is unknown. Otherwise any unknown
primary dimension makes priority unassessed. Why and coherence remain visible in
the full judgment without entering the primary summary; ordinal scores are not
averaged. Failed workflows, invalid output and failed judgments have null judgment
and unassessed quality. A concrete contradiction cannot coexist with clean or
unknown accuracy; a before/after contradiction or citation gap also requires a
non-clean citation score, and a reported omission requires non-clean coverage.

See [six-PR calibration](intentions-calibration.md) for source-grounded examples,
positive controls and disputed materiality. Short sufficient citations are valid;
unchanged code or callee internals are required only when the claim depends on
them. Coverage accounting proves references, not semantic completeness.

Each evaluation starts a fresh Codex process in a temporary workspace, with inherited configuration, project instructions, tools and memory restricted. These controls reduce context contamination; they cannot prove complete isolation from managed instructions or eliminate model bias. The judge can assess only saved evidence, so missing context must remain uncertainty. Scores are exploratory until calibrated against human review.

## Manually evaluate intention cards

Use the new CLI on PRs 1–8 in `daphne-proj/pr-review-test`. Run cases explicitly when ready for paid model calls, for example `make intentions PR=https://github.com/daphne-proj/pr-review-test/pull/1`, then repeat for the remaining PR numbers. Each invocation uses a fresh output directory; keep its `run.json` and write review notes beside it. No intentions scorer or Langfuse upload is involved.

For each artifact, record the pinned commits from `identity` and captured PR title/body from `metadata`. Inspect the cards against both revisions, noting missing or duplicate intentions, inaccurate before/after claims, unsupported reasons, citation quality and reported omissions. Include failed runs and their diagnostics. Record native `modelCalls[].usage` and per-call/overall timing; missing usage is unknown. Split pair labels cannot grade explanation quality, and saved diff-only fixtures cannot provide unchanged-code investigation.

Compare repeated runs only when pinned revisions and captured PR metadata match. Record qualitative findings rather than treating structural acceptance as semantic correctness. Live quality remains unverified until these runs and their human review are recorded.

## Compare intentions token efficiency

The protocols below are separate evaluation proposals, not authorization to run
them. The quality-contract pilot at the end is the current proposed next step;
earlier efficiency and prompt-only comparisons describe different experiments.

Keep payload efficiency separate from reviewer-quality changes. Hold writer and
reviewer instructions, schemas, models, acceptance policy, evidence requirements
and budgets fixed. Both baseline and optimized arms must use the current batched
tool setting; the older nine-run experiment predates batching and is diagnostic
evidence, not a comparable live baseline.

First measure saved trajectories offline in a fresh ignored
`outputs/intentions-token-efficiency-<UTC>/` directory. Compare the original
payload, compact reviewer citations, current-page tool navigation and stable
reviewer message layout as separate stages. Record serialized request bytes by
role, source/navigation bytes, query repetitions and artifact-reader results.
Preserve the original artifacts. Reconstruction holds model replies and tool
choices fixed: fewer bytes do not establish fewer tokens, lower cost or preserved
semantic quality. Include all writer-delivered sources, even those no card cites.

Before paid execution, prepare a manifest with exact PR URLs, target/base/head
commits, captured PR metadata, baseline/candidate source snapshots and hashes,
prompt/schema hashes, runtime versions, settings, fresh output paths and execution
order. Confirm the selected models remain available. Acquire the pinned revisions
and compare metadata before generation; the PR CLI resolves current remote state,
so a URL alone does not freeze the case. Stop on mismatches and verify the resulting
artifact again. A dirty-state flag alone is not a source snapshot.

The first proposed pilot is three known PRs × two arms × one run: **six workflows**
and **at most six independent judgments**, requiring authorization for that
manifest before calls begin. Use `gpt-6-sol` with low reasoning, 256,000 input
capacity, 16,384 output capacity, three candidates and a shared 600,000 ms deadline
per workflow. Use the unchanged intentions judge with `gpt-6.1-sol` and its existing
600,000 ms timeout. Run sequentially and alternate which arm goes first by PR;
record cache reuse conditions without claiming fresh caches. Build each isolated
source state before using the compiled CLI with `--max-candidates 3` and
`--run-timeout-ms 600000`. These limits do not impose a fixed number of model
continuations or a dollar ceiling.

Retain failed workflows and judge failures without automatic replacement samples.
Revalidate accepted artifacts with `loadIntentionArtifact`, then use the existing
judge command and rubric. Record human/source inspection effort separately; add
no unallocated model adjudication. Report clean independently assessed accepted
outputs per scheduled workflow, inadequate accepted outputs, unassessed outputs
and failures. One run per PR is a pilot, not a general quality estimate.

For every scheduled run, report writer, reviewer and writer-revision usage;
generation counts, tools per generation, terminal candidates, failures and
latency; and separate independent-judge consumption. Count-endpoint calls are
requests, not another copy of generation usage. Read cache writes from raw
provider responses because normalized `TokenUsage` does not retain that field.
Missing usage breakdowns remain unknown. Calculate dollars only with verified
rates and disjoint ordinary-input, cache-read and cache-write quantities; never
charge inclusive input again or treat cached input as free.

Batching can be measured separately with three additional baseline workflows,
changing only `parallel_tool_calls` to false, under a separate allocation. An
explicit-cache experiment also needs its own allocation and a model-specific,
isolated patch after verifying current count/generate support. Keep implicit
continuation caching, record the request shape and cache writes as well as reads,
and do not ship a global provider option or silently substitute models. Stable
prefix bytes alone do not prove a cache hit.

Record three distinct conclusions: mechanical payload reduction, observed live
efficiency and independently assessed quality. Reduced observed input or cost with
preserved provenance and no confirmed material quality regression supports further
use. Missing assessments, inconsistent results or a worse quality/cost tradeoff
remain inconclusive; byte reduction or cache-hit percentage alone cannot select
the winning workflow.

## Compare reviewer instructions on the optimized workflow

Use the token-efficient implementation in both arms, changing only reviewer
instructions. Preserve the writer prompt, judge rubric, schemas, models,
reasoning, batched tools, delivery rules and budgets. For uncommitted work, retain
source hashes and a patch including new files; HEAD alone cannot identify the
baseline. Build the two states separately when evaluation is authorized. The old
nine-run experiment is development evidence, not this comparison's baseline.

Before evaluation, have a selector who is not authoring the prompt choose and pin
six unexamined PRs across at least two unrelated repositories. Keep related change
families and near-duplicates together. Include small and complex changes with
different rationale and evidence needs; select by those properties, not observed
failures. Keep holdout source and outcomes away from the prompt author until the
candidate is frozen. A different PR number alone does not make a case unseen.

The proposed allocation is six known-case workflows (three original PRs × two
arms), followed by 24 holdout workflows (six PRs × two arms × two repetitions).
Use the same settings as the token-efficiency pilot: `gpt-6-sol`, low reasoning,
256,000 input and 16,384 output capacity, three candidates and 600,000 ms per
workflow. The unchanged independent judge uses `gpt-6.1-sol` and its existing
600,000 ms timeout. Freeze exact source/prompt hashes, case metadata, assessment
rules, counterbalanced or randomized execution order, concurrency, output paths
and an authorized allocation before calls. These 30 workflows are a separate
proposal, not an extension authorized by the six-run efficiency pilot.

Allow at most 60 independent judgments for first valid drafts and distinct
accepted outputs; reuse a judgment only when the full candidate packet is
identical. Accepted outputs use the existing artifact reader and judge command.
First drafts use a separately labeled diagnostic assessment with the same rubric,
runner and parser after revalidation against that turn's delivered evidence.
Resolve imports against the relevant isolated build; do not manufacture accepted
artifacts or expose runtime feedback, arm labels or model identity to the judge.
Failed workflows can have diagnostic first-draft assessments, never accepted
output assessments. Retain judge failures and evidence limitations explicitly.

Name and budget a separate source adjudicator for every structurally valid
evaluated candidate, at most 90 in this allocation. Hide runtime and judge
findings until initial adequacy classifications are recorded, then reconcile
disagreements. Log additional source inspection and whether the adjudicator is a
person or a fresh-context model; allocate any paid adjudication calls separately.
If this inspection is unaffordable, reduce the protocol before unblinding. Do not
inspect only suspicious repairs or treat unexamined candidates as adequate.

Report known and unseen results separately, including per-case variation. The
primary measure is source-adjudicated adequate accepted outputs per scheduled
workflow; judge-clean output yield remains a separate diagnostic. Also report
materially defective acceptances, unnecessary revisions among adjudicated adequate
candidates, true repairs, introduced defects, unresolved outcomes, failures and
assessment gaps. Distinguish pre-existing defects noticed later from defects
introduced by repair. Unknown classifications remain unknown, and rates with no
eligible denominator are undefined. Keep ordinal dimension scores separate.

Compare full workflow usage and latency by role, including failed runs and reviews
of already adequate drafts, using the cache and cost accounting described above.
Improved unseen adequate-result yield without an observed increase in material
false acceptance or unnecessary revision supports adoption; sparse or conflicting
results, incomplete assessment or disproportionate cost remain inconclusive.
Keep the frozen prompt throughout holdout execution and do not replace failed
sample slots. Once a holdout result informs prompt changes, that set becomes
development evidence and a future generalization claim needs new unseen cases.

Implementation and source review do not execute or qualify this protocol. When
the user defers testing, record checks and live evaluation as unrun; complete the
case manifest and obtain authorization before subsequent paid execution.

## Compare the quality contract (proposed, not executed)

Start with frozen candidates to isolate review policy and coverage from writer
variation. Use candidate 1 from the seven run artifacts in
[the calibration manifest](intentions-calibration.md): PR1 run2, PR2 run1, PR3
run1 and run2, and PR4/5/6 run1. PR4 remains explicitly a diagnostic draft from a
failed workflow. Compare the prior reviewer and current reviewer once per case:
**14 terminal review requests, zero writer requests and zero independent-judge
requests**. Human source adjudication uses the balanced calibration cases and
records disputed details separately. This is a proposed allocation only.

For this first source-frozen probe, provide both arms the same saved proposal,
inventory, original hunks and source bytes delivered during the recorded review.
Do not fetch new source or execute tools. Use the existing model, low reasoning,
256,000 input and 16,384 output capacities, 120,000 ms provider timeout and existing
byte limits. One request per arm/case means at most 14 generation requests and
14 corresponding count requests, with no retries or continuation calls. A tool
request, malformed response or capacity failure remains an incomplete slot.
This controlled probe does not estimate normal retrieval or end-to-end success.

Before authorization, freeze a manifest with exact candidate/turn numbers,
proposal and source hashes, both source snapshots and prompt/schema hashes,
runtime versions, alternating arm order and fresh output paths. The current
loader does not accept old artifacts. Any future diagnostic extraction must be
separate from production loading, verify the recorded source bytes and delivery,
and never relabel old artifacts as current accepted runs. Do not add a permanent
replay framework for this pilot.

Measure detected-error acceptance, confirmed consequential omissions and
unnecessary repair requests on adequate controls. Record missing or inconsistent
coverage, failed slots, reviewer input/output/cache usage and latency. Retain
why-only findings, judge disagreements and disputed materiality separately;
no failed slot is replaced based on its outcome. More coverage output may cost
tokens; fewer unnecessary repairs and better detection must justify that cost.

Only after this probe should a separately allocated end-to-end comparison be
considered. That comparison must include writer revisions and independent
evaluation, corrected versus introduced defects, completion/failure rates and
usage by role. A newly discovered pre-existing defect is not a repair regression.
No quality or token-efficiency improvement is established by source review or
typechecking, and success on these known PRs does not establish generalization.

## Evaluate saved intentions against gold

Use `make intentions-eval CASE=apps/eval/datasets/intentions/cases/pr_1.json`
to build, validate the case, generate fresh intentions for its PR and evaluate them.
The Make target uses `MODEL` (default `gpt-6.1-sol`) for generation and judging,
and `MAX_INPUT_TOKENS=256000` for generation. It creates a dedicated
`outputs/intentions-eval-<timestamp>-<pid>/` folder, or uses the optional `OUTPUT`.
Generated artifacts go in `generation/`, judge input and reports in `evaluation/`,
and console logs in `generation.log` and `evaluation.log`. The terminal prints only
dimension scores (1–5 or null) and `requiredBehaviorCoverage` (0–1 or null).
Failures exit unsuccessfully and identify the error or saved log.
Generation requires `OPENAI_API_KEY`; judging uses Codex CLI authentication.
PR revisions and evidence must still match the frozen case before judging.

Optional `ARTIFACT=PATH` skips generation and regrades a saved run. `OUTPUT` and
`GENERATION_PROMPT` work as for ordinary judging. With `ARTIFACT` but no `CASE`,
the Make target continues to run `intentions judge`.

The underlying `intentions eval` command grades a saved artifact directly:

```sh
bun run build
bun run eval -- intentions eval \
  --case apps/eval/datasets/intentions/cases/pr_1.json \
  --artifact outputs/intentions-CURRENT/run.json \
  --output outputs/intentions-gold-CURRENT \
  --model YOUR_JUDGE_MODEL
```

It checks the frozen case and accepted v2 artifact before invoking the existing
Codex runner. Case/evidence hashes, source consistency, revisions, PR text,
inventory and original hunks must match. Gold sources are additional evidence
for truth assessment only, never replacements for the candidate's attached
citations. The existing `intentions judge` command and its report contract remain
unchanged. `--case` is required for `eval` and rejected by `judge`.

A fresh output directory receives `daphne-intentions-gold-input-v1` input and a
`daphne-intentions-gold-report-v1` report. Reports separate primary quality and required
behavior coverage, preserve missing assessments and failures, and mark draft
labels provisional. The first PR 1 case awaits human review. Evaluation makes a
live model call only for a valid accepted artifact; no generation or Langfuse
upload occurs. Exit 0 means completed grading, even when quality is poor.

See the [dataset guide](../datasets/intentions/README.md) for annotation, evidence
storage, output fields and limitations. The suite file is a catalog, not another
CLI mode. Paid calibration and unseen evaluation are not implied by setup checks.

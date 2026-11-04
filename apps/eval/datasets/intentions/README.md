# Intentions gold dataset

Reference expectations for evaluating saved intention cards. Gold describes required meaning, allowing different wording and card grouping. It is available only to the independent evaluator.

The [generation instructions](../../../../packages/intentions/src/prompts.ts) define Daphne's task. Evaluation combines the [intentions rubric](../../prompts/intentions.md) with the [gold evaluation instructions](../../prompts/intentions-gold.md) to assess correctness, citation support, behavior coverage and the quality of reported issues.

- `cases/<id>.json`: pinned PR URL, repository/commit identity, metadata and ordered change IDs, plus before/after expectations, expected issues, false-alarm controls, incidental changes and review status.
- `suite.json`: case catalog and development/holdout partitions. Evaluation runs one case at a time.

Source evidence comes from the saved pipeline `run.json`: the diff and source
excerpts delivered during generation. Gold cases contain labels, not a second
source snapshot. The evaluator checks the run's revisions, PR metadata and ordered
change IDs against the case before judging. The artifact reader still validates
source bytes, ranges, delivery and citations. Gold labels do not add candidate
citations; missing source for additional factual checks remains unassessed.

## Add a case

Use [the existing case](cases/pr_1.json) as a format example. The
[case loader](../../src/intentions/gold-case.ts) defines the accepted fields.

1. Read the generation and evaluation prompts above. Derive expectations from the pinned BASE/HEAD source and complete diff, independently of generated cards or evaluator feedback.
2. Record the PR URL, repository URL, target/base/head commits, exact title/body and ordered change IDs in the case. Do not store acquisition session IDs or source excerpts.
3. Give each behavior a unique `id`, a `required` flag, and `before`/`after` objects with `meaning` and nonempty known `changeIds`. Describe observable behavior and consequential conditions; allow equivalent wording and card grouping. Split expectations when omissions should be scored independently. Review source on both revisions when writing labels; a new path alone does not establish application-wide absence.
4. Account for remaining changes in `incidentalChanges` with a reason. Add the case to `suite.json`; keep related cases in one partition and prompt-tuning cases in `development`.
5. Add required `expectedIssues` and `falseAlarmControls` arrays; empty arrays are allowed. Each label has a distinct `id`, explanatory `meaning` and nonempty known `changeIds`. Expected issues specify the trigger, consequence, PR relevance and necessary qualifications. Controls identify a precise tempting false concern and why it is wrong, without dismissing other mechanisms.
6. Start with review status `draft` and null reviewer/date. Independently check each behavior, issue and control against source, including counterevidence. Only human approval permits `reviewed`, with the real reviewer and UTC review date. Reset approval when labels change.

Validate the case locally without a model call:

```sh
bun run build
node --input-type=module - path/to/case.json <<'JS'
import { loadIntentionGoldCase } from './apps/eval/dist/src/intentions/gold-case.js';

const gold = await loadIntentionGoldCase(process.argv[2]);
console.log(`${gold.id}: ${gold.behaviors.length} behaviors (${gold.review.status})`);
JS
```

The loader checks structure, commit IDs, label references and change accounting. Source review must establish that the expected meanings are correct.

## Evaluate

```sh
make intentions-eval CASE=path/to/case.json
```

Make builds, generates fresh intentions for the case's PR, then evaluates them. Select `PROVIDER=openai|anthropic` for generation; OpenAI is the default. Generation uses the selected provider's default model, while the independent Codex judge uses the OpenAI default. Both model strings are maintained in `packages/llm/src/providers.ts`. The generation input budget defaults to `MAX_INPUT_TOKENS=256000`. Each run gets a dedicated `outputs/intentions-eval-<timestamp>-<pid>/` folder containing `generation/`, `evaluation/`, and their logs. Optional `OUTPUT=NEW_DIRECTORY` overrides the folder. Generation requires the selected provider's `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; judging uses Codex CLI authentication.

Pass `ARTIFACT=path/to/run.json` to regrade a saved run instead. With `ARTIFACT`, omitting `CASE` runs ordinary judging without gold expectations. The generated PR revisions, metadata and ordered change IDs must match the case; changed PRs are rejected before judging.

The terminal prints a grouped 0–100 scorecard: explanation properties, required
behavior coverage, each issue-quality property, known-issue coverage, and false-alarm
avoidance. Counts, unassessed results and provisional status stay visible. A final
overall summary index gives equal weight to applicable areas; it is not a probability.
See the [scorecard calculation](../../docs/commands.md#intention-scorecard-scale-and-overall-score).
The full original judgments and metrics remain in evaluation/report.json.

## Read the issue metrics

Gold evaluation requires one assessment for every reported observation, including
ones absent from the expected list. `issueEvaluation` saves those assessments and
exact issue-text matches for every expected issue and control. Its `metrics` contain:

- `reported.accuracy`, `relevance` and `consequence`: passed, rejected, assessed and
  unassessed counts, plus a rate over assessed reported items. Consequence asks
  whether the concern could meaningfully affect a review decision.
- `reported.onPoint`: an item passes when supported, relevant and material. Any
  decisive negative rejects it; otherwise an unknown axis leaves it unassessed.
  An empty or wholly unassessed denominator has a null rate, not a perfect score.
- `expected`: distinct known issues identified, missing and unassessed. Coverage
  is identified/total; it is null when no expected issues exist or any expectation
  remains unassessed. Duplicate matches cannot increase the numerator.
- `controls`: distinct false-alarm controls violated, avoided and unassessed.
  `falseAlarmRate` is violated/(violated + avoided), or null when none are assessed.

A useful conditional concern can pass when its mechanism and relevance hold under
the explicit premise. Missing candidate citations still affect citation quality,
even if other source in the run establishes the concern's truth. Unexpected valid issues
can pass; gold is not an exhaustive issue inventory. The rates count reported items,
not unique underlying problems; review duplication separately under coherence.
These are judge estimates against draft labels, not total issue recall or measured
reviewer-effort savings. Ordinary `intentions judge` has targeted findings but does
not emit these explicit gold issue metrics.

See the [command guide](../../docs/commands.md#evaluate-saved-intentions-against-gold) for details.

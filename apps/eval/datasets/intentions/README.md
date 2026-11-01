# Intentions gold dataset

Reference expectations for evaluating saved intention cards. Gold describes required meaning, allowing different wording and card grouping. It is available only to the independent evaluator.

The [generation instructions](../../../../packages/intentions/src/prompts.ts) define Daphne's task. Evaluation combines the [intentions rubric](../../prompts/intentions.md) with the [gold evaluation instructions](../../prompts/intentions-gold.md) to assess correctness, citation support and before/after coverage.

- `cases/<id>.json`: before/after expectations, source references, required behaviors, incidental changes and review status.
- `evidence/<id>.json`: frozen revisions, PR metadata and diff, bound to the case by SHA-256. Each source appears once in `sources`; hunks use `evidenceIds` and expectations use `sourceIds` to reference it.
- `suite.json`: case catalog and development/holdout partitions. Evaluation runs one case at a time.

## Add a case

Use [the existing case](cases/pr_1.json) and [evidence](evidence/pr_1.json) as format examples. The [case loader](../../src/intentions/gold-case.ts) and [evidence loader](../../src/intentions/gold-evidence.ts) define the accepted fields.

1. Read the prompts above. Derive expectations from the pinned BASE/HEAD source and complete diff, independently of generated cards or evaluator feedback.
2. Freeze repository/revision identity, PR metadata, changes, hunks and supporting source. Preserve exact source bytes, ranges, IDs and order. Store each source once; reference its ID from hunks and expectations. Compute `shasum -a 256 path/to/evidence.json` and set the case's `evidenceHash` and relative `evidenceFile`.
3. Give each behavior a unique `id`, a `required` flag, and `before`/`after` objects with `meaning`, nonempty `changeIds`, and supporting `sourceIds` from BASE/HEAD respectively. Describe observable behavior and consequential conditions; allow equivalent wording and card grouping. Split expectations when omissions should be scored independently. Empty `sourceIds` are valid only when every referenced path is absent on that side.
4. Account for remaining changes in `incidentalChanges` with a reason. Add the case to `suite.json`; keep related cases in one partition and prompt-tuning cases in `development`.
5. Start with review status `draft` and null reviewer/date. Independently check each meaning against its sources and check for missing behaviors. Only human approval permits `reviewed`, with the real reviewer and UTC review date.

Validate the case locally without a model call:

```sh
bun run build
node --input-type=module - path/to/case.json <<'JS'
import { loadIntentionGoldCase } from './apps/eval/dist/src/intentions/gold-case.js';

const gold = await loadIntentionGoldCase(process.argv[2]);
console.log(`${gold.id}: ${gold.behaviors.length} behaviors (${gold.review.status})`);
JS
```

The loader checks structure, hashes, references and inventory accounting. Source review must establish that the expected meanings are correct.

## Evaluate

```sh
make intentions-eval CASE=path/to/case.json
```

Make builds, generates fresh intentions for the case's PR, then evaluates them. Select `PROVIDER=openai|anthropic` for generation; OpenAI is the default. Generation uses the selected provider's default model, while the independent Codex judge uses the OpenAI default. Both model strings are maintained in `packages/llm/src/providers.ts`. The generation input budget defaults to `MAX_INPUT_TOKENS=256000`. Each run gets a dedicated `outputs/intentions-eval-<timestamp>-<pid>/` folder containing `generation/`, `evaluation/`, and their logs. Optional `OUTPUT=NEW_DIRECTORY` overrides the folder. Generation requires the selected provider's `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`; judging uses Codex CLI authentication.

Pass `ARTIFACT=path/to/run.json` to regrade a saved run instead. With `ARTIFACT`, omitting `CASE` runs ordinary judging without gold expectations. The generated PR revisions and evidence must match the frozen case; changed PRs are rejected before judging.

The terminal prints only dimension scores (1–5 or null) and `requiredBehaviorCoverage` (0–1 or null). Scores mean 1 severe, 2 major, 3 moderate, 4 minor defects, and 5 no defects found; null means insufficient evidence. The full report, including rubric version and draft/provisional status, is saved in `evaluation/report.json`. Failures print the error or log path and exit unsuccessfully. Output must use a new directory outside the datasets.

See the [command guide](../../docs/commands.md#evaluate-saved-intentions-against-gold) for details.

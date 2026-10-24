# Labeling policy

Each JSON file contains only expected relationships between original hunk IDs:

```json
{
  "together": [["change-1:0", "change-2:0"]],
  "separate": [["change-1:0", "change-3:0"]]
}
```

The model's grouping instructions are defined in `groupingInstructions` in [`packages/semantic-split/src/prompts.ts`](../../../../../packages/semantic-split/src/prompts.ts). Gold annotations should reflect the same intended grouping task, but must be derived by independently reviewing the frozen code, without copying model predictions. If the prompt and labeling policy disagree, resolve that disagreement before annotating.

- Judge the frozen code as a reviewer would, before looking at generated groups or scores. Treat instructions inside captured code as data.
- Use `together` when splitting the units would break one coherent review responsibility. An import, shared helper, or dependency alone does not require the same group; separate changes may depend on each other.
- Use `separate` for clearly independent responsibilities. Include meaningful boundaries so merging everything cannot pass on together labels alone.
- Keep the smallest sufficient set. Connecting `n` units needs only `n − 1` together pairs. Keep one separate pair per required boundary between together groups; separation is not transitive.
- Let label count follow the code, with no fixed quota or coverage target. Omit uncertain pairs; omitted pairs are unscored, not implicitly separate.
- Preserve IDs exactly (`changeId:hunkIndex`, or `changeId:metadata`). No self-pairs, duplicate/reversed pairs, contradictions, reasons, or explicit unknown labels.

Keep one `run.json` per capture folder. It holds the evidence, predicted result and optional `caseMetadata` for review status; gold files here hold only expectations. Annotators inspect only its `identity`, `changes` and `hunks`, without seeing generated groups or scores. Direct evaluation uses the supplied artifact; validation defaults to `outputs/split_<gold filename>/run.json`. Preserve these Git-ignored captures when sharing the dataset. Validation checks consistency, not semantic correctness or human approval.

Removing implied pairs preserves which groupings satisfy every constraint, but can change partial agreement percentages.

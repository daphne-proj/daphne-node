# Semantic review inside the evaluator

This folder implements the LLM-backed part of `evaluate` in
[`../workflow.ts`](../workflow.ts). It belongs **inside** the evaluator-optimizer
loop, after deterministic proposal and citation validation. It is not a final
review added after that loop.

## Relationship to the evaluator-optimizer pattern

This follows the core loop in the
[Claude evaluator-optimizer cookbook](https://platform.claude.com/cookbook/patterns-agents-evaluator-optimizer):
generate a candidate, evaluate it in a separate LLM call, and use feedback to
generate a replacement until the acceptance criteria are met.

| Cookbook operation                             | Daphne implementation                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `generate(...)` creates or improves a solution | `produce(...)` in [`../workflow.ts`](../workflow.ts) runs the writer, supplying correction feedback on revisions.                     |
| `evaluate(...)` assesses the current solution  | `evaluate(...)` first performs deterministic validation, then calls [`reviewIntentionCandidate(...)`](review.ts).                     |
| `loop(...)` accepts or repeats with feedback   | [`runEvaluatorOptimizer(...)`](../../../evaluator-optimizer/src/runner.ts) coordinates the callbacks and returns the accepted result. |

The **optimizer is the writer revising from feedback**. There is no third agent
or separate optimization call: `produce` handles both the initial draft and
replacement drafts. The shared runner knows nothing about LLMs, schemas or
intention cards; the workflow supplies those decisions.

## One iteration

1. `produce` continues the writer conversation until it returns a candidate.
2. `evaluate` checks JSON shape, known changes, citation provenance and ranges,
   and exact PR quotations. Invalid candidates return structural feedback without
   calling the reviewer.
3. `reviewIntentionCandidate` opens a fresh reviewer conversation with the current
   proposal, pinned PR facts, inventory, limitations, and actual source content
   delivered to that writer. The reviewer can use the same read-only tools to
   inspect more evidence. It does not receive writer reasoning or prior verdicts.
4. `parseIntentionReview` validates the report and its references.
   `deriveIntentionReviewDecision` accepts when there are no material defects,
   requests revision for repairable defects, or stops for unresolved material
   limitations. Advisory findings never force another draft; unknown author
   motivation is valid.
5. On revision, the continuing writer receives the complete report and any newly
   discovered source bytes. The replacement repeats **all** checks and criteria.

The five criteria are accuracy, citations, rationale, coverage, and coherence.
`prompts.ts` defines their meaning; `schema.ts` owns the strict Zod report shape
and generated provider JSON Schema; `contracts.ts` infers report types;
`validation.ts` checks contextual integrity and derives the decision;
`review.ts` coordinates one review through the intentions conversation wrapper.

`input.ts` projects the validated proposal into the reviewer's input. Code
citations retain their evidence IDs and absolute UTF-8 byte ranges, while the
source packet supplies the actual bytes once per evidence ID. Repeated citations
therefore do not repeat source text inside every card. All writer-delivered
evidence remains available, including uncited source needed to detect omissions.
Public results, saved validated proposals and independent judge packets retain
their enriched citations with source text.

## Conversation boundaries

Writer and reviewer share one model client, evidence store, and run budget, but
keep separate histories and evidence-delivery records. Sharing a client does
not mean sharing a conversation, and the pattern does not require different
models for the two roles.

The writer continues its conversation through repairs, retaining drafts, tool
results and feedback. Each reviewer starts fresh with the current candidate and
its evidence. This matches the cookbook's separation: its evaluator receives
the evaluation prompt, original task and current result, while previous attempts
and feedback go to its generator. Daphne retains the full writer history instead
of rebuilding a prompt containing previous result texts. Fresh review context
avoids carrying forward the writer's reasoning or earlier verdicts; it does not
guarantee an unbiased or correct assessment.

The reviewer's first user message contains only the pinned identity, PR metadata,
inventory, hunks and original diff sources. Its bytes stay identical across
candidates in the same run. The next message supplies current limitations, the
compact proposal, additional writer-delivered sources and the full navigation
snapshot. Each source ID appears in exactly one initial packet, and delivery
receipts preserve the writer's original ID order. Missing diff sources fail
instead of introducing retained evidence the writer never received.

Both evidence packets share the existing 8 MiB context capacity; splitting the
messages does not grant a second allowance. Complete-request byte and token
limits still apply. This layout makes the prefix stable but does not establish
provider cache reuse or a cost reduction. Model-specific cache experiments belong
in the separate evaluation procedure, not a global provider option.

Tool continuations may
require several LLM calls; only terminal writer proposals consume candidate
slots. Failed or malformed reviews are retained and fail the run without retry.
Cancellation and exhaustion never publish an unapproved draft. Successful output
links to the exact writer turn and its accepting review, not the last model reply.

## Daphne-specific choices

These extend the example without changing its generate/evaluate/revise loop:

- Deterministic shape and citation checks run before paid semantic review.
- The reviewer returns structured findings; local policy derives acceptance.
  Material defects block acceptance, while advisory suggestions do not. The
  cookbook's example instead requests a pass only when no improvement suggestions
  remain.
- Optional run limits, cancellation and explicit unresolved stops prevent a
  failed run from publishing an unapproved candidate. The cookbook's sample loop
  continues on every non-pass result.
- Evidence receipts and accepted writer/reviewer references let artifact readers
  check which source content each conversation received and which draft passed.
  This bookkeeping is a Daphne requirement, not part of the pattern itself.

Semantic split also uses the shared runner, but its evaluator checks exact unit
coverage deterministically. It is a variation of the loop, not this LLM-reviewed
intentions flow.

## Runtime acceptance and independent evaluation

This reviewer decides runtime acceptance. The independent judge in `apps/eval`
assesses saved accepted output separately. Neither schema validation nor an LLM
verdict proves semantic correctness; live quality evaluation remains necessary.
The implementation follows the pattern mechanically, but repeated live cases
must still establish whether its feedback improves explanations without causing
regressions. Offline checks do not establish live schema acceptance or reviewer
reliability.

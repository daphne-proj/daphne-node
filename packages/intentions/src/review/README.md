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
4. `parseIntentionReview` validates references and coverage accounting, then
   derives dimension statuses locally. `deriveIntentionReviewDecision` uses the
   same blocking policy: factual accuracy/citation defects in title, before, after,
   intendedOutcome, why or an issue
   block regardless of severity, as do other material findings and omissions.
   Advisory presentation and rationale preferences remain diagnostic. Repairable blocking findings request
   revision; unresolved blocking findings stop; otherwise the candidate accepts.
5. On revision, the continuing writer receives the complete report and any newly
   discovered source bytes. The replacement repeats **all** checks and criteria.

The five criteria are accuracy, citations, rationale, coverage, and coherence.
`prompts.ts` defines their meaning; `schema.ts` owns the strict Zod report shape
and generated provider JSON Schema; `contracts.ts` infers report types;
`validation.ts` checks contextual integrity and derives statuses and the decision;
`coverage.ts` validates source-to-text accounting;
`review.ts` coordinates one review through the intentions conversation wrapper.

`input.ts` projects the validated proposal into the reviewer's input. Code
citations retain their evidence IDs and absolute UTF-8 byte ranges, while the
source packet supplies the actual bytes once per evidence ID. Repeated citations
therefore do not repeat source text inside every card. All writer-delivered
evidence remains available, including uncited source needed to detect omissions.
Public results, saved validated proposals and independent judge packets retain
their enriched citations with source text.

## Review procedure and proportional effort

The reviewer first identifies consequential changes and potential problems from source
and matches them to actual explanation text. Relevant unchanged callers, contracts,
dependencies and failure paths can reveal missing concerns, including problems in the
engineering choice even when it is implemented faithfully. Existing weaknesses matter
only when introduced, worsened or made relevant by the transition. It then checks each card's claims and scope, and whether
the citations attached to each field actually support those claims. Truth and
citation sufficiency are separate: a true statement can still need a better
citation. Conversely, a short range can be sufficient. A visible call can support
an ordering claim without a separate read of the callee's implementation; a
claim about the callee's internal behavior may require that read.

The reviewer distinguishes desired outcome from motivation, and author-stated purpose
from supported inference or unknown purpose. It checks each observation's mechanism,
reachability, consequence, threatened constraint, relevance and uncertainty against
evidence and counterevidence. Specific conditional concerns are allowed; generic
speculation and invented requirements are not. It examines consequential coverage and
coherence across the proposal. Material findings explain what behavior, condition,
capability or relationship the reader would misunderstand, or what support for a
material claim is missing. Incidental file narration and wording preferences do
not justify blocking acceptance. Qualifications must preserve meaningful coverage.

Repairs follow the same contract as the writer validator: `before` code citations
use BASE, `after` code citations use HEAD, inferred purpose and issues can cite either, and
stated reasons quote captured PR text exactly. For example, a comparison that needs
old code should cite it in `before` or an inferred reason, rather than adding a
BASE citation to `after`. Source merely present in the shared ledger is not
writer-citable; feedback transfers newly delivered reviewer evidence, including
source supporting proposal-wide omissions.

The procedure starts with delivered source and requests additional context only
for material gaps. It requires concise findings and coverage entries in the same
review, without an extra critic or reasoning transcript. It still checks every
candidate and all five dimensions. Missing evidence can be repaired through
retrieval or supported qualification; unresolved stops are reserved for material
correctness that cannot be restored. These instructions aim to reduce both missed
defects and unnecessary repair work, but live quality and token savings require
the separate controlled comparison described in the evaluation guide.

## Host policy and coverage contract

Raw model dimensions contain only `explanation`. Parsed dimensions gain a host
`status`: `insufficient_evidence` for a blocking unresolved finding, otherwise
`issues_found` for any blocking finding, otherwise `pass`. Findings and their
original severities remain unchanged. For example, an advisory accuracy finding
that a card reverses validation/copy ordering still requests correction. A
false asserted motivation also blocks, even when advisory. Unknown purpose is valid.
Nonblocking
findings must use an optional `revise` remedy; `unresolved` is invalid for them.

Each required `coverage` entry names a behavior, distinct known `changeIds` and
distinct delivered `evidenceIds`, plus one disposition:

- `covered`: nonempty `matches` with zero-based `cardIndex`, `field` (`before` or
  `after`) and an exact nonblank `quote` from that field, or `field: 'issue'` with
  zero-based `issueIndex` and an exact quote from that observation's `text`.
- `omitted`: `omissionIndex` linking the existing omissions array. Every omission
  is linked exactly once and has the same change-ID set as its coverage entry.
  A material missing concern uses this mechanism, never a nonexistent issue index.
- `incidental`: an `explanation` of why separate coverage is unnecessary.

Every inventory change occurs in at least one entry. Several behaviors can share
a change, and one entry can span changes. Each represented text change with hunks
requires at least one original hunk source anchor belonging to that change.
Supplementary delivered sources are allowed; evidence can be empty only for
metadata-only changes (non-text or text without hunks). An empty inventory has
empty coverage. Missing or malformed accounting fails rather than being filled in.

Findings on existing observations use `field: 'issue'` and `issueIndex`, assessing
the whole observation, including relevance and uncertainty. Ordinary fields, including
`intendedOutcome`, reject issue indexes. Coverage cannot quote intendedOutcome or why:
desired behavior does not establish actual behavior. An issue quote must explain the
represented behavior, not merely mention related code.

These checks establish IDs, quotes and inventory accounting, not semantic truth.
A quote about adjustment receipts does not explain general ledger-copying behavior
merely because both use the same hunk. The reviewer must make that judgment. This
adds no source excerpts, mandatory extra cards or per-line requirements; original
hunk selection, source packets, delivery receipts and request limits remain intact.

The full parsed report, including coverage, travels through existing turn saving
and repair feedback. Raw reply text remains separate and unchanged. New host
artifacts use `daphne-intentions-v3`; eval accepts only this current contract.
Old artifacts are not supported, migrated or rewritten. Relabeling an old report
v3 still fails strict parsing; failed workflows remain failed.

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
- The reviewer returns structured findings and coverage; local policy derives
  statuses and acceptance. Factual defects cannot be waived as advisory, while
  advisory presentation and rationale preferences remain diagnostic. The
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
verdict proves semantic correctness; intact hunks and structurally valid coverage
also cannot prove it. The independent rubric v5 reports accuracy, citation support
and coverage as primary quality, while keeping rationale and coherence separate.
Live quality evaluation remains necessary.
Acceptance means the account is adequate, not that the PR is safe or its intention
desirable. A supported potential issue can remain in an accepted card. An empty
issues array does not certify correctness; issue discovery and reviewer effort still
need empirical evaluation.
The implementation follows the pattern mechanically, but repeated live cases
must still establish whether its feedback improves explanations without causing
regressions. Offline checks do not establish live schema acceptance or reviewer
reliability.

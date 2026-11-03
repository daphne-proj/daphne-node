# Intention reviewers

This folder implements semantic evaluation in [workflow.ts](../workflow.ts):

**Producer → deterministic validation → three parallel reviews → code combines feedback → accept, revise, or stop.**

| Reviewer                   | Responsibility                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Accuracy and evidence      | Factual descriptions, attached citation support, and stated/inferred/unknown purpose and motivation.                                                         |
| Issues                     | Validate reported issues and discover missing issues: mechanisms, reachability, counterevidence, relevance, consequences, uncertainty, supporting citations. |
| Completeness and coherence | Consequential BASE-to-HEAD behavior and relationships; missing behavioral explanations, intention boundaries, duplication, reading order and clarity.        |

Issues owns missing issues; completeness owns missing behavioral explanations.
Any reviewer can report an important finding outside its focus.

## How it runs

1. The producer returns a draft. Code checks structure, citation references,
   pinned revisions, byte ranges and exact PR quotations. Invalid drafts return
   diagnostics without invoking reviewers.
2. Three separate conversations review the same fixed draft and initial evidence
   concurrently, using read-only investigation tools. They assess whether evidence
   supports the claims; valid citation references alone cannot establish that.
3. Code validates and combines the reports without another LLM call. Repairable
   defects return feedback and newly discovered evidence to the original producer.
   Every replacement repeats validation and all three reviews.

Completeness assesses each material capability separately, even when several share
a card. A covered entry states independently supported BASE and HEAD facts and
quotes the corresponding candidate account for each. Existing equivalents may live
in unchanged code; the reviewer uses its tools to establish missing baselines and
returns an omission when the account needs repair. Added-path absence comes from
the inventory and does not establish absence of the capability elsewhere.

Code checks source delivery and revision, inventory support for metadata or absent
sides, and exact side-specific quotations. These checks make the assessment
reviewable; they cannot establish whether a related source or quotation actually
explains the capability. Accuracy and issues reviewers supply only omitted or
incidental coverage entries, so a HEAD-only concern needs no invented BASE account.

Conversations have separate histories, clients and evidence-delivery records,
with shared run limits and queued tools. Citations require source bytes delivered
to that conversation; feedback delivers reviewer-discovered bytes to the producer.

Acceptance requires all three valid reviews with no blocking findings. Factual
accuracy and citation defects block even when marked advisory; other material
findings and all omissions also block. Advisory presentation and rationale
preferences do not block. Unknown purpose is valid, and accepting an explanation
does not approve the PR.

Unresolved blocking findings stop the loop. Failures,
cancellation and exhausted limits never publish an unaccepted draft; batch failure
cancels sibling work and waits for in-flight work to settle. Empty comparisons use
no model calls. Saved output links the accepted producer turn to all three reviews.

## Coverage and quotations

Coverage asks whether the producer explains the meaningful behavior before and
after the PR. [validateIntentionCoverage](coverage.ts) checks that the completeness
report accounts for every change and links omissions correctly.
[validateIntentionCoverageSide](coverage-side.ts) checks the evidence and quoted
producer passages for each side of a behavior marked covered.

The completeness reviewer writes `matches`; code does not generate them. Each
covered entry in `report.coverage` has `before` and `after` assessments. For
example, suppose the producer's first card has this `before.text`:

> Customers received a 10% discount on all orders.

The reviewer can return this `before` assessment, assuming `evidence-1` contains
the relevant BASE code and was shown to that reviewer:

```json
{
  "text": "The previous discount was 10%.",
  "evidenceIds": ["evidence-1"],
  "changeIds": [],
  "matches": [
    {
      "cardIndex": 0,
      "field": "before",
      "quote": "Customers received a 10% discount"
    }
  ]
}
```

`matches[0]` is the first passage selected by the reviewer. `cardIndex: 0` points
to the producer's first intention; `field: "before"` selects its `before.text`.
The validator checks whether that text contains `quote` exactly, including case
and spacing. The quotation above passes; changing `10%` to `15%` fails. Several
matches can point to different passages or cards. An issue passage can also be
selected with `field: "issue"` and its `issueIndex`.

`evidenceIds` point to repository source; `matches` point to the producer's
explanation. The reviewer's own assessment `text` is not compared with the
quotation. This check prevents a reviewer from claiming the producer wrote a
passage that does not exist. It does not prove that the passage explains the code
correctly; the reviewer still judges that meaning.

See [prompts.ts](prompts.ts) for instructions, [review.ts](review.ts) for execution
and [combine.ts](combine.ts) for feedback combination.

[Anthropic's evaluator–optimizer example](https://platform.claude.com/cookbook/patterns-agents-evaluator-optimizer)
demonstrates generation, evaluation and revision with one evaluator.
[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents#workflow-parallelization)
describes parallel evaluation and composing patterns. Daphne combines these ideas;
workload balance, latency, cost and quality benefits remain unmeasured. The
independent judge in `apps/eval` stays outside this runtime loop.

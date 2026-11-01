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

See [prompts.ts](prompts.ts) for instructions, [review.ts](review.ts) for execution
and [combine.ts](combine.ts) for feedback combination.

[Anthropic's evaluator–optimizer example](https://platform.claude.com/cookbook/patterns-agents-evaluator-optimizer)
demonstrates generation, evaluation and revision with one evaluator.
[Building Effective Agents](https://www.anthropic.com/research/building-effective-agents#workflow-parallelization)
describes parallel evaluation and composing patterns. Daphne combines these ideas;
workload balance, latency, cost and quality benefits remain unmeasured. The
independent judge in `apps/eval` stays outside this runtime loop.

---
name: agent-workflow-design
description: Use when designing, implementing, or reviewing LLM agents, choosing orchestration patterns, or combining agent workflows. Applies to product agent architecture rather than routine coding-task delegation.
---

# Agent workflow design

Based on Anthropic's [Building effective agents](https://www.anthropic.com/research/building-effective-agents), especially [parallelization](https://www.anthropic.com/research/building-effective-agents#workflow-parallelization). This is locally authored guidance, not a copy of the article.

## Choose and combine patterns

Start with one model call, adding retrieval or tools as needed. Increase complexity when evaluation justifies its quality, latency, and cost. Distinguish workflows with code-defined control flow from agents that choose their next actions.

| Pattern              | Use when                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| Prompt chaining      | Fixed stages depend on earlier outputs; validate between stages.              |
| Routing              | Classifiable inputs need different specialized paths.                         |
| Parallel sectioning  | Independent subtasks can run together, then be aggregated.                    |
| Parallel voting      | Multiple independent attempts inform a defined decision rule.                 |
| Orchestrator-workers | The input determines which subtasks are needed.                               |
| Evaluator-optimizer  | Explicit criteria support useful critique and revision.                       |
| Autonomous agent     | The next steps cannot be specified in advance; tool feedback guides progress. |

Compose patterns at their dependency boundaries. For example, chain evidence collection into parallel reviews, aggregate their findings, then refine against explicit criteria. Define failure and stopping behavior at each boundary; use the source article for deeper rationale.

## Apply in Daphne

Before changing agent control flow, inspect its callers, prompts, tools, validation, and evaluation artifacts. Follow [architecture](../../../docs/architecture.md) for ownership and public package boundaries; migration work also follows [daphne-migration-parity](../daphne-migration-parity/SKILL.md).

Make the proposed or implemented flow reviewable:

- State each stage's input, output, evidence provenance, and owner. Identify which transitions code controls and which decisions the model makes.
- For concurrent work, establish a stable input snapshot, a bounded worker count, and an aggregation contract. Specify how missing, failed, conflicting, or duplicate results affect the final artifact. Keep dependent stages sequential.
- For refinement loops, define acceptance criteria, iteration and resource limits, and cancellation behavior. Exhausting a budget must remain distinguishable from satisfying the criteria.
- Document tools with unambiguous arguments, examples, errors, and side effects. Reuse existing package APIs and preserve observable contracts when changing orchestration.
- Assess the change against the simpler baseline using existing evaluation cases and run artifacts. Report quality, latency, cost, and remaining uncertainty where available; follow repository policy on test changes.

Keep these product architecture decisions separate from permission to delegate the current coding task. This reference does not require a framework, new package, or multi-agent implementation.

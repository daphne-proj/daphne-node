# Proposal audit checklist

## Problem and leverage

- Does the artifact solve the stated problem or merely expose a mechanism?
- Is there a smaller design with the same leverage?
- Are goals, non-goals, and success criteria observable?

## Authority and assumptions

- Are facts, accepted decisions, assumptions, heuristics, model interpretations, and human judgments distinguishable?
- Does any heuristic or model claim correctness, safety, coverage, identity, or absence without adequate validation?
- Are confidence, alternatives, and falsifiers visible?

## Scope and failure

- Are inputs, boundaries, budgets, stopping rules, exclusions, and unsupported cases explicit?
- Does partial or missing information degrade visibly rather than produce unsupported absence claims?
- Are retries, updates, ambiguity, corruption, and resource exhaustion defined?

## Model and architecture

- Does each concept have one owner and one meaning?
- Are identity, content, storage keys, and library-specific indices distinct?
- Are ordering and tie-breakers reproducible?
- Do implementation or language details leak across intended boundaries?
- Are public interfaces cohesive while phase details remain internal?

## Operations and evaluation

- Are inputs, versions, policies, prompts/models, and environment sufficient for reproduction?
- Are persistence, compatibility, invalidation, concurrency, and partial failure explicit where relevant?
- Can tests and metrics reject a superficially successful implementation?

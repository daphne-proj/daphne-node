# Intentions validation-and-repair design

## Decision and scope

Implement the user's November 3 proposal: keep `@daphne/evaluator-optimizer` and use deterministic validation as the intentions evaluation callback. Call this behavior a **validation-and-repair loop**. [Anthropic's evaluator-optimizer description](https://www.anthropic.com/research/building-effective-agents#workflow-evaluator-optimizer) describes an LLM evaluator; Daphne's existing generic runner does not require one.

Work starts from `main` at `3dff7a4433f344dc897e064d7d4da60aa6886c38` on `codex/intentions-validation-repair`. The earlier direct-loop experiment, commit `38265be`, is comparison evidence, not the implementation base. Do not cherry-pick its replacement of the shared runner. Its retained report is `outputs/intentions-agent-loop-20261103/README.md` when available locally.

## Ownership

| Owner                         | Responsibility                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `@daphne/llm`                 | Provider calls, conversation replay and tool-call continuation.                       |
| `@daphne/evaluator-optimizer` | Produce/check/revise lifecycle, candidate limits, cancellation and retained attempts. |
| `@daphne/intentions`          | Investigation instructions, schema, citations, repair feedback and completion policy. |
| `apps/eval`                   | Independent golden-dataset assessment after generation.                               |

The producer continues the same investigating writer until it emits a terminal draft. The evaluator calls `validateIntentions` against the draft's delivered evidence. Invalid drafts return precise diagnostics to that writer; valid drafts complete without semantic reviewer calls. The runner remains responsible for iteration and lifecycle outcomes. Tool continuations do not consume candidate slots.

## Contracts and guarantees

Completed attempt evaluations become `{ kind: 'structural', status: 'accept' }` or `{ kind: 'structural', status: 'revise', diagnostics: string[] }`. An interrupted evaluation remains `null`. A nonempty success selects `{ candidateNumber, writerTurnNumber }` in `acceptedCandidate`, with the selected writer's exact proposal and provider response. Empty comparisons remain zero-call successes with no accepted candidate.

Update the producer and saved-artifact reader together. Reconstruct delivery, revalidate raw drafts, require invalid earlier drafts and one valid final draft, and reject reviewer feedback, semantic acceptance and inconsistent references. Do not invent approving reviews or relax citation checks to accept the new result.

Retain the host's original budget and signal. Validate the last permitted candidate before exhaustion; cancellation or failure never publishes an earlier draft. Preserve completed attempts, turns, tool outcomes, evidence and original errors. Structural acceptance establishes shape and provenance, not factual correctness, completeness or exhaustive issue discovery.

## Constraints

- Use Node `24.22.0` and Bun `1.4.3`; Bun manages packages and Node runs production code.
- Keep the package name `@daphne/evaluator-optimizer`; create no `patterns` package or `@daphne/refinement` rename.
- Keep the runner API and implementation, semantic-split behavior and dependency graph unchanged.
- Keep initial writer instructions, output schema, tools, provider/model settings, evidence acquisition, gold labels and judging rubrics unchanged; correction instructions describe structural diagnostics only.
- Add no runtime toggle, compatibility fallback or artifact version marker; regenerate development outputs as needed.
- Do not add or modify tests unless explicitly requested; update existing tests only if the implementation breaks them.
- Run existing required checks and independently review the implementation before completion.

The selected approach changes workflow policy while reusing established mechanics. A new direct loop would duplicate those mechanics; a patterns package or rename would expand this task without changing the required behavior.

## Execution update: remove unused code

The user's execution request adds: “be sure to trim all un-used code.” This supersedes the original decision to retain inactive reviewer helpers and general conversation role support. Delete unused reviewer orchestration, contracts, parsers, prompts, exports, artifact-review parsing and CLI reviewer grouping. Keep `toIntentionProposalInput` for the independent judge, moving it out of the deleted review directory. Simplify the runtime to one writer client and the delivery reader to its continuing history. Update existing conversation tests only where this removal breaks their setup or reviewer-specific scenario, preserving their delivery and cancellation assertions.

## Explicitly deferred

No benchmark campaign, reasoning-effort tuning, gold calibration or quality claim is part of this ownership update. A fresh paid generation or judge run requires a separate execution request. Existing tests do not directly cover the intentions workflow or artifact acceptance; report that limitation rather than claiming full regression coverage.

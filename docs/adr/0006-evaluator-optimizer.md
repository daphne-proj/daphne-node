# ADR 0006: Shared evaluator–optimizer and run budget

Status: accepted for the common execution package, 2026-10-29. Workflow adoption is separate work.

## Problem

Semantic split and intentions each need to produce a candidate, evaluate it and request a replacement when acceptance criteria are not met. Duplicating that control flow makes cancellation, final-candidate evaluation and diagnostic retention harder to keep consistent. Fixed workflow correction counts and separate generation/tool allowances also prevent the host from expressing one policy for the whole run.

## Decision

`@daphne/evaluator-optimizer` owns a generic loop and a shared run-budget contract. Hosts create one budget before preparation and pass the same instance through acquisition, generation, review, repair, tools and publication. The optional policy fields are `timeoutMs` and `maxCandidates`; absent fields impose no corresponding ceiling. There are no fixed numeric defaults, role allocations or operation-specific quotas. Positive safe integers are required, and the timeout must fit Node's timer range.

The budget copies the selected policy into a frozen value, records its original deadline and combines caller cancellation with one native timeout signal. Each independent run creates a fresh budget. Candidate counting belongs to that run's runner invocation; hosts do not restart the runner to reset a run's allowance. Callback operations and tools do not consume candidate slots.

The runner receives workflow-owned producer and evaluator callbacks. Evaluation either accepts a distinct validated value, requests revision with typed feedback, or explicitly stops with a reason. Revision receives the exact preceding candidate and feedback. Workflow-specific schemas, deterministic validation and semantic acceptance criteria remain local to the workflow. Future Zod response schemas therefore do not introduce a Zod dependency in the common runner.

Completed candidates and evaluations are retained before cancellation checks. Every candidate permitted by a configured ceiling, including the final one, must complete evaluation before acceptance. Exhaustion means the final evaluation requested further revision. Callback failure preserves the original thrown value and stage; cancellation preserves the signal reason and any callback cause. Neither accepts a diagnostic draft. The runner returns readonly history without copying arbitrary caller-owned values.

The package may use standard cancellation and timing facilities, including an event-loop yield between revisions. It has no runtime dependencies, provider/domain imports, environment lookup, telemetry, persistence or filesystem/network I/O. The host retains resource cleanup and publication ownership. Downstream callbacks must honor the shared signal, and hosts must check it again before publishing accepted output.

## Alternatives

- Keeping separate loops preserves duplication and makes guarantees drift as intentions adds semantic review.
- Fixed default candidate counts or separate writer/reviewer/tool quotas constrain workflows without evidence that those allocations improve results.
- A generic criteria registry, provider framework, token/dollar ledger or checkpoint store adds responsibilities this execution seam does not need.

## Consequences

The common package can enforce ordering and retain completed work without knowing what a valid split or grounded intention means. Acceptance quality still depends on the workflow evaluator. Repairs must run all workflow criteria again; the runner does not rank drafts or assume later candidates are better.

Unset ceilings can permit indefinite revision and growing retained history. Cancellation is cooperative: callbacks must settle, and blocking synchronous work cannot be interrupted. Native timeout signals follow Node's event loop and do not keep an idle process alive. A throwing callback's hidden partial work remains the workflow's responsibility. Resource cleanup or publication failures may still invalidate a workflow outcome after the runner returns.

This first implementation does not yet change either workflow, CLI flags or artifacts. Their adoption and current-consumer migration follow the [implementation plan](../superpowers/plans/2026-10-29-evaluator-optimizer.md). No Rust parity or semantic quality claim follows from this package or its build checks. Focused automated tests are deferred at the user's request.

Revisit this decision if measured workloads need aggregate resource accounting, durable resumption, or another execution model. Keep any such policy explicit at the run boundary instead of adding hidden per-stage limits.

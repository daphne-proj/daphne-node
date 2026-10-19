---
name: decisions-to-spec
description: Convert already-resolved design decisions into a concrete technical specification without reopening them. Use explicitly after the design is settled.
---

# Decisions to Spec

Read the [supplied context contract](../references/context-contract.md), the accepted decision sources, and the affected public seams.

Build a ledger of facts, resolved decisions, assumptions, conflicts, and open questions. Preserve decisions verbatim. Mark missing required behavior `TBD`; do not decide it implicitly.

Write the specification using [the outline](references/spec-outline.md). Define observable behavior and ownership before internal implementation detail. Assign deterministic, heuristic, model, and human responsibilities with their authority, validation, confidence, and fallback.

Trace every normative requirement to an accepted decision or governing invariant. Label implementation suggestions as non-normative.

The specification is complete when an implementer can build and test it without inventing behavior, every open item is visible, and no accepted decision was weakened, strengthened, or reopened.

---
name: proposal-audit
description: Critically review an existing architecture, algorithm, data model, implementation, or product proposal against its stated problem and supplied constraints. Use explicitly for findings, not implementation.
---

# Proposal Audit

Read the [supplied context contract](../references/context-contract.md), the artifact under review, and the sources governing its claims. State the actual problem and success criterion independently of the proposal.

Apply every relevant part of [the audit checklist](references/audit-checklist.md). Trace inputs to outputs and claims to evidence. Exercise representative failure paths when the artifact is runnable.

Lead with findings ordered by impact. Each finding includes the violated requirement or outcome, concrete evidence, consequence, affected scope, uncertainty, and smallest corrective direction. Separate confirmed defects, risks, and questions.

Then record preserved strengths, hidden assumptions, and the overall assessment of problem fit, complexity, reproducibility, and behavior under partial information. Preserve accepted decisions unless evidence shows they cannot meet their stated outcome.

Stop at the audit. Implement repairs only under a separate request.

# Reasoning skill evaluations

[`cases.yaml`](cases.yaml) contains generic prompts plus injected facts and resolved decisions. [`rubric.yaml`](rubric.yaml) applies to every case.

Run each case in a fresh task and explicitly invoke the named skill. Give the model `prompt` and `provided_context`, but not `expected_signals`. Connected or attached project sources can replace `provided_context` in integration tests.

A case passes only when every common criterion scores `1` and every case-specific expected signal is present. Evaluate behavior, not headings or exact wording. A well-supported “unresolved” answer can pass; an unsupported confident choice cannot.

The set intentionally includes weak premises and unsettled choices. It checks early implementation, accidental promotion of research to fact, model overreach, unsupported absence claims, and silent reopening of decisions.

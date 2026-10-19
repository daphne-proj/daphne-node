---
name: disposable-prototype
description: Build and measure a narrow disposable experiment for a design question that discussion cannot settle. Use explicitly for evidence, not production implementation.
---

# Disposable Prototype

Read the [supplied context contract](../references/context-contract.md), then inspect the current seam, constraints, and representative inputs.

1. State the unresolved decision and one falsifiable hypothesis.
2. Define the baseline, independent variable, metric, decision threshold, and result that would remain inconclusive.
3. Build the smallest isolated fixture, benchmark, adapter, or throwaway program that exercises the disputed mechanism. Keep production interfaces and wiring unchanged.
4. Record revision, inputs, versions, environment, policy, seed, and commands. Repeat runs when variance matters.
5. Separate raw results from interpretation; include failures, truncation, unsupported cases, and resource cost.
6. Report whether the threshold was met, the architectural implication, confidence, threats to validity, and the next decision gate.

Use a temporary location by default. Retain experimental code only when requested, clearly isolated and labeled. A working demo is not production evidence unless its metric tests the hypothesis.

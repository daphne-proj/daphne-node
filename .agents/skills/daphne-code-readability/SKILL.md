---
name: daphne-code-readability
description: Use when completing TypeScript implementation or refactoring in Daphne, or when reviewing dense expressions, unclear names, excessive nesting, or unnecessary abstractions.
---

# Daphne code readability

Apply the [readability policy](../../../docs/agents/typescript-quality.md#readability) to the changed code. A smaller implementation should take less effort to understand, not merely occupy fewer lines.

1. Read the changed functions and their immediate callers. Identify the domain operation, inputs, outputs, and observable effects before simplifying.
2. Make the normal path and failure paths easy to follow. Use domain names and explicit steps where compressed expressions hide intent. Keep helpers that clarify a real operation; remove indirection that adds no meaning.
3. Compare the result with the original behavior, especially evaluation order, absent versus empty values, byte offsets, error propagation, and resource cleanup. Keep compatibility-sensitive names in serialized data unchanged.
4. Format the changed files with the repository Prettier configuration, run `bun run check`, and inspect the final diff. Report checks actually run.

Limit edits to the requested scope. A review-only request produces findings, not automatic edits. Do not impose line-count limits, reorganize unrelated modules, or add dependencies for style.

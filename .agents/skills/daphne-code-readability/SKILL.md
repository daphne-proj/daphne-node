---
name: daphne-code-readability
description: Use when writing, editing, reviewing, or presenting code in Daphne, including source files, scripts, tests, configuration, documentation examples, and chat snippets in any language.
---

# Daphne code readability

Apply the [readability policy](../../../docs/agents/typescript-quality.md#readability) whenever authoring or presenting code, not only at implementation completion. Its [logical spacing guidance](../../../docs/agents/typescript-quality.md#logical-spacing-for-all-code) applies across languages; follow language-specific syntax and formatter conventions.

Follow the [comment policy](../../../docs/agents/typescript-quality.md#comments): explain purpose, constraints and non-obvious choices for a teammate seeing the code for the first time. Use plain sentences with enough detail to make the reasoning clear; add comments where that context is missing from the code, not above every block.

1. Identify the logical steps: setup, validation, work, error handling, cleanup and result. Keep related statements together; use one blank line between distinct steps.
2. Inspect spacing around declaration groups, guard clauses, cancellation checks, loops, `try` blocks and final results. Separate transitions without inserting blank lines between every statement or expanding short cohesive blocks mechanically.
3. Keep normal and failure paths easy to follow with meaningful names, clear control flow and focused functions. For edits, inspect immediate callers and preserve evaluation order, bytes, side effects, cleanup and public contracts.
4. Before sending a snippet or completing an edit, visually scan every authored block for logical grouping. Formatter success alone does not establish readable spacing.
5. For implementation changes, format touched files and run the repository's required checks. For snippet-only or guidance-only work, inspect the relevant output without running unrelated builds or modifying source.

Keep changes within the user's scope. Preserve exact quotations, fixtures, string/template contents and whitespace-sensitive syntax. A review request produces findings unless edits are authorized. Do not reformat unrelated files or add dependencies for style.

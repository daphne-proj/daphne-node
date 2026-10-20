# TypeScript quality

Use the smallest complete implementation. Minimize unnecessary complexity, not line count; readable, explicit code takes precedence over compressed expressions. Inspect callers, serialization, tests, and downstream consumers before changing a contract. Prefer Node standard-library functions over dependencies for small operations.

- Keep strict compiler and typed lint checks enabled. Validate untrusted input once at its entry point, then pass typed values inward. Types alone do not validate JSON, provider output, subprocess output, persisted data or JavaScript callers. Internal functions trust those validated types; do not convert typed arguments back to `unknown` just to repeat object, property or primitive-type checks. Keep domain checks that types cannot express, such as safe integer indexes, bounds and snapshot membership.
- Model alternatives as discriminated unions and handle them exhaustively. Do not use casts, non-null assertions, `any`, or lint suppression to conceal an unproved invariant.
- Treat errors as explicit boundary behavior. Preserve causes and distinguish invalid input, unavailable evidence, and internal failures. Never turn extraction failure into an empty successful result.
- Await promises; define cancellation and deadlines for external work. Preserve bounded concurrency and clean up resources. Pass Git arguments as arrays, not interpolated shell commands.
- Preserve deterministic ordering. JavaScript strings use UTF-16; use bytes for Rust byte offsets. Check Rust integer range against JavaScript safe integers and serialized formats before conversion.
- Use `readonly` where mutation would break a concrete ownership or consistency guarantee, such as shared identities, retained evidence and snapshots. Use ordinary properties and arrays for short-lived request objects and local working data. `readonly` is not runtime validation or freezing; preserve existing immutability contracts without decorating every new type or introducing a functional architecture. Separate transport data from validated domain values when needed.
- Keep module exports intentional. Use `import type` and `.js` ESM relative specifiers. Consumers use public package exports, never a sibling's `src` tree.
- Test meaningful behavior and failure cases in `tests/`; review the final diff for unnecessary abstractions and dependencies.

Tool changes follow [CONTRIBUTING.md](../../CONTRIBUTING.md). Bun configuration uses seconds for `minimumReleaseAge`; keep Node as the script runtime and use `bun run test` for Vitest. Use the migration parity reference before translating Rust behavior.

## Readability

Logical grouping and spacing apply to all authored code, including documentation and chat snippets. The TypeScript-specific rules below remain scoped to TypeScript; other languages retain their own syntax and conventions.

- Name values and functions after their domain meaning. Include units when they prevent ambiguity, such as `timeoutMs` or `byteOffset`; avoid vague names such as `data` when a precise name is available.
- Keep the main flow visible. Use guard clauses for invalid inputs and terminal cases when they reduce nesting. Keep equally meaningful alternatives together when an `if`/`else` or `switch` reads better.
- Use braces for every control-flow body. Use `if`/`else` or `switch` for multi-way choices; nested ternaries are rejected by ESLint. A simple two-way ternary is fine.
- Give complex conditions or intermediate results a name when it explains intent. Prefer a plain loop over a dense chain when it makes state changes, error handling, or execution order easier to follow.
- Keep functions focused on one operation. Extract a helper when it gives a coherent operation a useful name or removes real duplication, not to satisfy an arbitrary line limit. Keep related logic together.
- Separate logical steps with blank lines using the guidance below. Use [comments](#comments) to supply context the code does not make clear.
- Simplification must preserve evaluation order, side effects, cancellation, cleanup, errors, and serialized contracts. Keep necessary boundary validation and domain checks; remove duplicate shape checks inside trusted typed code. Keep compiler strictness intact.
- Format changed files with Prettier and run `bun run check`. Review the resulting diff for readability; passing formatting and linting alone does not establish clear design.

### Comments

Write for a teammate who has not traced the implementation. A useful comment explains the problem being solved, why a choice matters, or what could break if the code changes.

- For a non-obvious algorithm, explain its goal first, then the strategy or guarantee the reader needs. Connect technical details to their effect: keeping lines readable, preserving exact bytes, or preventing caller edits during an asynchronous operation.
- Use natural, complete sentences and concrete terms. Prefer a clear explanation over compressed jargon; add a small example when an indexing or boundary rule is hard to picture. Brevity is useful only while the meaning stays clear.
- Place comments beside the decision they explain. A function comment gives purpose and important guarantees; comments inside it explain surprising steps. Do not narrate assignments, loops or each branch, or require a comment above every block.
- Check every claim against the implementation. Update or remove stale comments, and improve unclear names or structure before using comments to compensate for them.

Use `/* ... */` in TypeScript and JavaScript, on one line when it fits naturally and across several lines when the explanation needs space. Other languages use their native comment syntax.

For example, explain why a pager prefers line endings:

```ts
/*
 * Keep complete lines together so each page remains readable.
 * Split within a long line only when necessary, without breaking a Unicode character.
 */
```

### Logical spacing for all code

Apply this guidance to every authored or edited code block: implementation, scripts, tests, configuration, documentation examples and chat snippets, in any language. Use the language's own syntax and formatter conventions; the grouping principle is language-independent.

- Treat code like paragraphs: keep statements that perform one logical step together and put one blank line between distinct steps.
- Keep related declarations adjacent. Separate a declaration group from a following validation, loop, conditional or `try` block.
- Separate completed guard/validation blocks from subsequent work. Give a cancellation or other precondition check a clear boundary before the work it protects.
- Separate setup, the main operation, post-processing and a final result when they are distinct phases. Separate a variable declaration from its following `try` block.
- Keep related control-flow clauses together, such as `if`/`else` and `try`/`catch`/`finally`. Short cohesive blocks can remain compact; do not insert a blank line between every statement.
- Preserve whitespace-sensitive syntax and content, including Python indentation, shell continuations, string/template literals, exact quotations and fixture bytes.
- Review grouping visually after formatting. A formatter does not decide every logical boundary for the reader.

For example, related declarations stay together, while validation, preparation and error handling are visually separated:

```ts
const sourceId = validateId(input.sourceId);
const destinationId = validateId(input.destinationId);

if (sourceId === destinationId) {
  throw new Error('Source and destination must differ.');
}

checkCancellation(signal);

let result: TransferResult;

try {
  result = await transfer(sourceId, destinationId, signal);
} catch (error) {
  throw new TransferError('Transfer failed.', { cause: error });
}

return result;
```

Before presenting any snippet or completing any code edit, check that these logical groups are visible, related statements remain together, and spacing has not changed behavior. This check also applies when no file is modified.

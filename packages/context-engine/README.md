# Context engine

`@daphne/context-engine` turns supplied evidence into bounded, traceable context. It supports two independent paths: retaining excerpts for a selected JSON packet, and splitting a complete supplied diff into text pages. The CLI inspection command uses the first; semantic-split uses the second. Retrieval, Git cleanup, prompts and model generation belong to callers.

## Main APIs

| API                                                      | Purpose                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `createContextEngine(identity, limits)`                  | Create a ledger exposing `addSource`, `addToolResult`, `getEvidenceSnapshot` and `buildContextPacket`. |
| `buildContextPacket(snapshot, input)`                    | Build a packet from a supplied evidence snapshot, including one restored from JSON.                    |
| `splitDiffIntoContextPages({ identity, hunks, tokens })` | Yield diff pages within byte and token budgets, preserving supplied source text across fragments.      |

`defaultContextLimits` and `resolveContextLimits` configure retention and packet budgets. Paging does not use or mutate the ledger.

## Main types

- `EvidenceSnapshot` / `RetainedSource`: retained excerpts with evidence IDs, pinned identity and query history.
- `AssembleInput` / `ContextPacket`: priority-ordered evidence selection and its rendered result, measurements, notices and omitted IDs.
- `DiffContextHunk` / `DiffContextPage`: original hunk sources and pages that retain their original unit IDs.
- `TokenBudget`: a limit and asynchronous callback for counting the caller's complete intended model request.

## How it works

For packets, validate and retain supplied sources or tool results, reuse identical evidence, and reject conflicting provenance or bytes. Search previews and line-read window metadata remain navigation; only exact source fragments become citable evidence. Line-read continuations must agree on the selected window. Select evidence IDs in priority order, then render the largest fitting prefix of whole excerpts with explicit omissions and retrieval limitations. Git can already be closed.

For diff pages, validate the supplied hunks, render them together, and recursively divide oversized groups, sides or source ranges. Splits preserve UTF-8 boundaries and original byte offsets. Consume the iterator completely to preserve all supplied text; page boundaries do not define semantic groups.

The only workspace imports are types from `@daphne/review-evidence/contracts`, keeping context construction independent of retrieval. Node `Buffer` measures and splits UTF-8 bytes; `node:crypto` provides stable packet IDs and fingerprints. Callers supply token counting so this package needs no model SDK or tokenizer.

Defaults cap serialized retention at 4 MiB and packet/page text at 64 KiB. Explicit limits allow packets up to 8 MiB and retention up to 32 MiB; diff pages keep their 64 KiB ceiling. `ContextInputError`, `ContextConflictError` and `ContextLimitError` distinguish malformed input, inconsistent evidence and exceeded budgets. Validation checks supplied evidence consistency; it does not authenticate repository contents or establish semantic correctness.

See the [context and paging guide](docs/context-and-paging.md) for examples and budget behavior, the [contracts](src/contracts.ts) for data shapes, and the [boundary decision](../../docs/adr/0002-context-engine-boundary.md) for ownership.

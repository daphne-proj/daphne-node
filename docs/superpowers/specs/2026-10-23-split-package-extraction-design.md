# Reusable semantic split

The approved refactoring moves the existing split workflow out of the CLI so a future backend can call the same implementation. It preserves the behavior committed in `8840d18`; this is not a Rust migration.

## Ownership

- `packages/semantic-split` owns expected IDs, proposal types and validation, the proposal JSON schema and split-specific prompts. It uses evidence contracts only and performs no I/O.
- `packages/review-agent` owns the existing OpenAI adapter, pagination orchestration, page analysis, conversation history, repair loop, budgets and attempt records. Context-engine continues to implement packing and fragment splitting.
- `apps/cli` owns arguments, environment loading, PR/Git acquisition and cleanup, progress output, local artifact writing and exit codes.

## Interface and failures

Expose one `runSemanticSplit(input, options)` operation from review-agent. Input contains the pinned identity, original change inventory and collected hunks. Options supply the API key, model, input-token limit, cancellation signal and an optional synchronous page-progress callback used by the CLI. No environment, filesystem or terminal access belongs to the operation.

Return pages, completed analyses, attempts, call counts and the correction limit on both success and failure. A discriminated result accepts a proposal/response only on success; failure carries the original error and null accepted results. A failed later count, generation or paging operation must not discard earlier work. Progress callback failures also return the collected work.

## Approach and constraints

The user approved extraction into the owners already reserved by the architecture. Keeping the workflow in the executable prevents reuse; a generic agent/provider framework adds interfaces without another implementation. Move existing behavior and add only the public operation needed by callers.

Preserve ID spelling/order, prompts, schema, provider payloads, three corrections/four grouping generations, budgets, cancellation, errors, CLI progress, exit codes and the `daphne-split-pr-v3` artifact. Git must close before paging or model calls. Do not add dependencies beyond workspace edges, change tests, make live paid calls or implement a backend. Node remains 24.22.0 and Bun 1.4.3. The new refactoring stays uncommitted for review.

Verification uses existing checks, offline assertion-based comparisons with the committed implementation, and independent review. These checks do not establish live provider replay or semantic quality.

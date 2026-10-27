# Semantic split

`@daphne/semantic-split` groups a PR's changes by **intention**: edits that serve one purpose belong together even across files, while unrelated purposes stay separate. It owns prompts, grouping history, proposal validation and bounded corrections. PR acquisition, Git cleanup and artifact persistence belong to its callers, including PR review and evaluation.

## Main APIs

| API                                       | Purpose                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `runSemanticSplit(input, options)`        | Turn supplied evidence into a validated proposal, retaining completed work on success or failure. |
| `getExpectedUnitIds(changes)`             | Derive one unit per text hunk, or one metadata unit for a change without text hunks.              |
| `validateProposal(text, expectedUnitIds)` | Check JSON, proposal shape and exactly-once coverage independently of model claims.               |

The package also exports its prompts, `proposalSchema` and `maxCorrections` so callers can inspect or fingerprint the policy.

## Main types

- `SemanticSplitInput` / `SemanticSplitOptions`: pinned identity, inventory and hunk evidence, plus explicit model credentials, budgets, cancellation and callbacks.
- `Proposal` / `ProposalValidation`: intention groups with titles, reasons and unit IDs, or actionable validation diagnostics.
- `PageAnalysis` / `SplitAttempt`: each page's optional model notes and each completed grouping reply with its validation result.
- `SemanticSplitResult`: complete or failed output retaining pages, attempts and call counts; failure carries an error and no accepted proposal.

## How it works

1. Ask context-engine to pack the exact diff into pages within request limits, then check their unit IDs against the original inventory.
2. Group a single page's raw diff directly. For several pages, generate separate notes with unit IDs, then group from all notes. A single-page run has no page analysis.
3. Validate each proposal. For an invalid reply, replay the grouping conversation with diagnostics and request a complete replacement. Missing or duplicated known IDs also bring in original pages not yet supplied as raw evidence. Allow at most three corrections after the first grouping reply.

`context-engine` supplies `splitDiffIntoContextPages`; `llm` supplies `createOpenAI` for complete-request token counts, generation and replayable output. `review-evidence/contracts` supplies data types without repository I/O. The workflow performs no direct Git or filesystem operations.

Input budgets can stop corrections early. Completed page notes and attempts remain in the result for the caller to save; the CLI stores them in `run.json`. Valid coverage does not prove that groups are semantically right or independently applicable, and this workflow does not establish Rust migration parity.

See the [workflow](src/workflow.ts), [contracts](src/contracts.ts), [proposal validator](src/proposal.ts) and [architecture](../../docs/architecture.md) for details.

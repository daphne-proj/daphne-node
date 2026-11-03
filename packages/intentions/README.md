# Intentions

`@daphne/intentions` explains a complete PR comparison as ordered intention cards: actual behavior before and after, the desired outcome, its motivation, and potential issues. Cards may share evidence; they do not consume or modify semantic-split groups.

## Pattern: validation and repair

One investigating agent, called the **writer**, gathers evidence through tools and proposes an answer. Ordinary code validates that answer and returns diagnostics when repairs are needed. This is a **validation-and-repair loop**:

1. Give the writer the pinned PR metadata, complete change inventory and supported diff evidence.
2. Continue the same conversation while it requests tools. Count the complete request before each generation, execute tools sequentially, and replay provider output and tool results. A reply with pending tool calls is not a final answer.
3. When the writer returns a terminal proposal, call `validateIntentions` against the evidence delivered by that turn.
4. If invalid, append the diagnostics to the same writer history and request a complete replacement. The writer can investigate further before replying.
5. If valid, accept immediately, unless cancellation prevents completion.

The existing `@daphne/evaluator-optimizer` runner supplies iteration, candidate limits, cancellation and retained attempts. Its evaluator is a callback, so it can run deterministic code without an evaluator model. There are no semantic reviewer conversations or model-generated acceptance verdicts. Independent semantic and golden-dataset assessment belongs to `apps/eval` and runs separately when requested.

Each terminal proposal consumes one candidate slot; tool continuations do not. The last permitted candidate is still validated: a valid draft succeeds, while an invalid draft exhausts the budget. Repairs preserve the writer's client, history and original run budget.

## Deterministic validation

For the same proposal text and validation context, `validateIntentions` applies the same rules without a model call:

- Parse JSON and enforce the strict Zod schema: required fields, allowed variants, nonblank valid text and no extra properties.
- Require at least one intention for a nonempty change inventory, with nonempty, distinct, known change IDs on each card.
- Check that code citations reference retained evidence actually delivered to the writer, from the pinned session and commit. Before claims use BASE; after claims use HEAD. Purpose and issues may cite either revision.
- Require nonempty, half-open UTF-8 byte ranges inside the retained source, without splitting encoded characters. Resolve cited snippets from those trusted bytes; the model cannot supply its own source text.
- Require change citations to name known changes and stated-purpose quotations to appear exactly in the captured PR title or body. Stated purpose accepts no model-written text.

The result is either a validated proposal with resolved source snippets or diagnostic messages for repair. Validation establishes **structure and citation provenance**. It cannot establish that a claim follows from its citation, a quotation supports the stated motivation, or every behavior and issue was found. It does not enforce exactly-once hunk coverage or prove that the PR is correct. Those questions require independent semantic assessment.

## Public APIs and ownership

| API                                 | Purpose                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------- |
| `runIntentions(input, options)`     | Investigate under the caller's budget; return accepted cards or failure with retained work. |
| `validateIntentions(text, context)` | Validate a raw proposal against the supplied comparison and delivered source evidence.      |

The package exports input, result and card types; prompts, provider schemas and loop helpers remain internal.

| Owner                         | Responsibility                                                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@daphne/intentions`          | Investigation instructions, proposal schema, evidence delivery, citation checks, repair feedback and acceptance policy. |
| `@daphne/llm`                 | Provider calls, token counting, conversation replay and tool-call continuation.                                         |
| `@daphne/evaluator-optimizer` | Produce/check/revise lifecycle, shared run budget, cancellation and attempt retention.                                  |
| `@daphne/context-engine`      | Evidence retention and context assembly.                                                                                |
| Caller / evidence session     | PR acquisition, repository reads, cleanup, configuration and persistence.                                               |
| `apps/eval`                   | Saved-artifact verification and independent quality assessment.                                                         |

Zod defines and validates proposal shapes. Review-evidence is imported through its type-only contracts export. Intentions owns no Git handle, repository I/O, CLI, telemetry or filesystem persistence.

## Caller contract

Supply a pinned `ReviewIdentity`, complete `Change[]` inventory, exact `DiffContextHunk[]` evidence and captured PR `{ url, title, body }`. Each text hunk needs every existing side once, in BASE-then-HEAD order. Existing sides without changed lines have empty anchors; absent sides have no source. Metadata-only changes use `{ change, hunkIndex: null, sources: [] }`.

Input validation checks inventory coverage, hunk membership, paths, side order and line counts. Context-engine checks source identity, UTF-8 byte lengths and conflicts. Missing required evidence fails; unsupported content remains explicit metadata with a limitation. Inputs are shared with the returned comparison, so callers must leave them unchanged.

Options supply credentials, model, positive `maxInputTokens`, a shared `RunBudget`, an evidence executor and an optional `provider` (OpenAI by default). Create the budget before acquisition, bind acquisition and the executor to `budget.signal`, and keep the session alive until the investigation settles:

```ts
import { runIntentions } from '@daphne/intentions';

const result = await runIntentions(
  { identity: session.identity, changes, hunks, pr },
  {
    provider,
    apiKey,
    model,
    maxInputTokens: 256_000,
    budget,
    executeTool: session.execute,
  },
);
```

The executor must validate untrusted requests before I/O, enforce response limits and return evidence from the same pinned comparison. The review-evidence session provides this behavior. The caller owns cancellation, cleanup and publication. Optional `onModelCall` observations retain native usage, timing and candidate/conversation attribution, including failed requests.

## Tools and evidence delivery

The writer can call `list_changes`, `inspect_change`, `search_code` and `read_source_lines`, including searches and reads of unchanged code in either revision. Instructions ask it to investigate relevant callers, contracts, dependencies and failure paths, checking reachability and counterevidence before reporting concerns. There is no minimum tool-call requirement.

Only source bytes included in a request that receives a completed model reply become citable. Retention and token counting alone do not establish delivery. Each proposal uses its own terminal turn's delivery snapshot; later reads cannot legitimize an earlier citation. Search previews are navigation, not citable source. Retrieval notices and unfinished continuations remain visible even when a proposal validates.

## Card contract

A proposal contains `intentions` and `warnings`. Each card requires `title`, `changeIds`, `before`, `after`, `intendedOutcome`, `why` and `issues`:

- `before` and `after` describe actual behavior with citations.
- `intendedOutcome` describes the desired result; `why` describes its motivation. Each uses `basis: 'stated'` with only exact PR quotations in `citations` and no `text`, `'inferred'` with text and code/change citations, or `'unknown'` without an invented explanation. Stated quotations report the author's claims; the PR description may be wrong and does not establish implementation correctness or actual motivation. Actual behavior and discrepancies belong in code-supported fields.
- Each issue has narrative `text`, `relevance` (`introduced`, `worsened` or `made_relevant`), required nullable `uncertainty` and nonempty `citations`. Its narrative should explain the condition, consequence and connection to the PR. Non-null uncertainty names an unverified premise; null does not prove certainty.

Code citations contain `kind: 'code'`, `evidenceId` and an absolute byte `range`; validation adds the exact `source`. Change citations contain `kind: 'change'` and `changeId`, for metadata such as file absence, modes or renames. Empty issue lists are valid. Warnings describe investigation limitations.

## Budgets and results

| Guardrail                                      | Limit                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| Input tokens                                   | Caller supplied, counted before every generation |
| Output tokens                                  | 16,384 per generation                            |
| Candidates / overall deadline                  | Optional caller ceilings, unset by default       |
| Context packet / complete caller model request | 8 MiB each                                       |
| Retained evidence                              | 32 MiB                                           |

`createRunBudget` resolves optional `maxCandidates` and `timeoutMs` once for the entire run. There are no separate generation, tool-call or correction quotas; without a deadline, a tool conversation can continue until completion, cancellation or failure. Oversized requests fail without automatic compaction or fallback. The provider adapter also applies its transport envelope and per-request deadline.

A nonempty success returns the validated proposal, its writer response and `acceptedCandidate: { candidateNumber, writerTurnNumber }`. Attempt evaluations are `{ kind: 'structural', status: 'accept' }` or `{ kind: 'structural', status: 'revise', diagnostics }`; interrupted evaluations remain null. Candidate, turn and tool numbers are one-based.

An empty comparison succeeds with empty cards, zero calls and null response/accepted reference, unless cancelled. Failures and cancellation clear `proposal`, `response` and `acceptedCandidate` while retaining completed work and error information. Results preserve the comparison, budget, evidence, delivery snapshots, tools, turns, attempts, diagnostics, limitations and call counts. These are in-memory diagnostic records, not a crash-resume format; hosts serialize errors and persist artifacts.

## Verification

Existing conversation tests cover delivery snapshots, pending receipts after failed requests, retained tool failures and cancellation arriving with a terminal reply. Dedicated intentions workflow and artifact-reader regression coverage remains absent. Normal repository checks make no live model calls and establish no explanation-quality or issue-discovery guarantee.

See the [architecture](../../docs/architecture.md), [validation-and-repair plan](../../docs/superpowers/plans/2026-11-03-intentions-validation-repair.md) and [evaluation guide](../../apps/eval/README.md).

# Intentions

`@daphne/intentions` explains a complete PR comparison as ordered intention cards: what existed before, what changes afterward, and the supported or inferred reason. Intentions describe the overall code and can share evidence. They do not consume or modify semantic-split groups.

## Public entry points

- `runIntentions(input, options)` runs one investigation under the caller's run budget and returns accepted cards or a failure with collected work.
- `validateIntentions(text, context)` validates model JSON and resolves code citations from retained source bytes. It returns a valid proposal or diagnostic messages.

The validation context comes from the captured comparison and context-engine snapshot, with the source IDs actually delivered by the host. The package exports their input, result and card types. Provider schemas, prompts, limits and loop helpers stay internal.

## Caller contract

Supply a pinned `ReviewIdentity`, complete `Change[]` inventory, exact `DiffContextHunk[]` evidence and captured PR `{ url, title, body }` metadata. Every text hunk needs each existing side once in BASE-then-HEAD order. Existing sides with no changed lines have empty source anchors; absent file sides have no source. Include one `{ change, hunkIndex: null, sources: [] }` entry for each metadata-only change.

The package captures these inputs before asynchronous work. It checks hunk membership, paths, side order, line counts and complete inventory coverage. Context-engine validates source identity, exact UTF-8 byte lengths and conflicts. Missing required evidence fails; unsupported content remains explicit metadata with a limitation. An empty inventory returns an empty proposal without counting or generation.

The caller supplies credentials, model name, a positive `maxInputTokens`, a shared `RunBudget`, and an evidence executor. Create the budget before acquiring evidence and bind acquisition and the session executor to `budget.signal`. For example, after acquiring a session with that signal:

```ts
import { runIntentions } from '@daphne/intentions';

const result = await runIntentions(
  { identity: session.identity, changes, hunks, pr },
  {
    apiKey,
    model,
    maxInputTokens: 256_000,
    budget,
    executeTool: session.execute,
  },
);
```

Keep the borrowed session and its Git snapshot alive until the promise settles. The executor must accept untrusted requests, validate them before I/O, obey its response limits, and return results for the same pinned identity. The existing review-evidence session supplies this behavior. The caller owns the optional overall deadline, cancellation of repository work, cleanup, environment loading and persistence. An optional `onModelCall` receives the existing llm observations for native usage and timing.

## Investigation loop

1. Retain all diff sources in context-engine and preserve their change/hunk mappings. Assemble the entire supported diff with PR metadata and the full inventory. Omitted source or an oversized request fails explicitly.
2. Count the actual instructions, output schema, tool definitions and complete replay history before each generation.
3. If the model requests tools, execute them sequentially through the borrowed executor. Available tools are `list_changes`, `inspect_change`, `search_code` and `read_source_lines`. Search and line reads can address unchanged files in either pinned revision. Defaults for tool response/page limits stay with review-evidence.
4. Record each returned page in context-engine, assemble its exact sources with evidence IDs, and return navigation, notices and the continuation cursor. Replay every provider output item, including reasoning, with native results paired by `call_id`. Reused call IDs fail. Text accompanying pending calls is never accepted as final.
5. Return the terminal writer reply to the shared evaluator-optimizer runner. Validate its JSON through the Zod writer schema, then check citations against trusted evidence. Invalid proposals receive diagnostics in the continuing writer conversation and produce a complete replacement. Each terminal proposal consumes one candidate slot; tool continuations do not. Provider, retrieval, cancellation and capacity failures stop immediately.

The internal conversation helper owns history, pending tools, delivery receipts and seen call IDs. Conversations borrow the same client, evidence store and run budget, but delivery is isolated: only source evidence included in that conversation's request that produced a completed model reply is marked delivered and citable. Candidate validation uses the snapshot from its terminal writer reply. Token counting and shared retention do not establish delivery. Search previews remain navigation; a source read is needed for a code citation. Unavailable reads return notices, so the model can correct a line range or acknowledge missing context. Open continuations and retrieval notices remain visible even when the final proposal is valid.

The prompt directs the model to read surrounding source when a claim exceeds the supplied evidence, especially for absence claims and control flow. It prefers whole short evidence ranges over estimated offsets, with focused line reads when a block is too broad or incomplete. Before submitting or correcting a proposal, the model reviews each claim's support, the purpose behind each reason, and consequential behavior across the change inventory. These are model instructions, not an additional validation stage or a minimum tool-call requirement.

## Card contract and evidence

A model proposal has `intentions` and `warnings`. Each card has a title, known `changeIds`, and before/after claims containing text plus citations. For example, a card might explain **Return authentication explicitly**: before, the middleware writes request state; after, it returns a typed result. The reason is inferred from code unless the captured PR description states it.

Code citations sent by the model contain only `kind: 'code'`, `evidenceId` and an absolute, half-open UTF-8 byte `range`. Validation requires a nonempty range inside delivered retained evidence, on BASE for before claims and HEAD for after claims. Accepted citations gain a `source` containing the exact referenced bytes and provenance; the model never supplies that snippet. Change citations use `kind: 'change'` and `changeId` for file absence, modes, renames and other metadata.

Reasons use one of three forms:

- `basis: 'stated'`: text and exact `{ field: 'title' | 'body', quote }` citations from captured PR metadata.
- `basis: 'inferred'`: text and supporting code/change citations. Inferences should be phrased as such.
- `basis: 'unknown'`: no fabricated explanation or citations.

Validation proves structural consistency and citation provenance, not whether evidence semantically supports a claim. An exact PR quotation does not by itself prove it supports the stated motive. Human evaluation must check explanation quality, duplicate/missing intentions and appropriate use of metadata citations. There is no exactly-once hunk assignment rule.

## Budgets and outcomes

| Guardrail                                      | Limit                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| Input tokens                                   | Caller supplied, counted before every generation |
| Output tokens                                  | 16,384 per generation                            |
| Writer candidates / overall deadline           | Optional caller ceilings, unset by default       |
| Context packet / complete caller model request | 8 MiB each                                       |
| Retained evidence                              | 32 MiB                                           |

These are application limits, not model capacity claims. The model adapter adds its transport envelope and per-request deadline. There is no compaction, hierarchy or automatic fallback for an oversized initial diff. `createRunBudget` from `@daphne/evaluator-optimizer` resolves optional `maxCandidates` and `timeoutMs` settings once for the whole run. The CLI exposes them as `--max-candidates` and `--run-timeout-ms`. There are no local generation, tool-call or correction quotas. Without a configured deadline, a tool conversation can continue until completion, cancellation or failure; a candidate ceiling only limits completed proposals.

After input capture, `comparison` retains the exact PR metadata, pinned identity and full inventory used by the investigation. Both outcomes retain the resolved budget, capacity limits, the evidence snapshot, hunk mappings, writer-delivered IDs, tool requests/results, completed turns, diagnostics, retrieval limitations and attempted call counts. Turns and tools identify their conversation and candidate. Tool records distinguish completed execution from failure and record whether their output reached a completed model turn in that conversation. Failed runs have `proposal: null` and `response: null`; earlier drafts remain in `turns` for diagnosis. Results are in-memory data, not a crash-resume format. Hosts must serialize errors deliberately if saving artifacts.

## Ownership and verification

Runtime dependencies are context-engine for retention/assembly, llm for provider calls, evaluator-optimizer for proposal iteration and run budgets, and Zod for writer shape validation and the generated request schema. Review-evidence is imported only through its type-only contracts export. This package has no Git handle, repository I/O, PR acquisition, CLI, telemetry or filesystem persistence. It adds no RCI/PCG index or multi-agent orchestration.

Existing repository checks verify integration. No dedicated intentions tests were added under the repository policy, and no live model calls are part of normal checks. Live provider compatibility and explanation quality require a separate evaluation. Acceptance currently checks structure and citation provenance; the separate semantic reviewer follows in Tasks 4–5 of the [evaluator-optimizer plan](../../docs/superpowers/plans/2026-10-29-evaluator-optimizer.md). See also the [original implementation plan](../../docs/superpowers/plans/2026-10-25-intentions-agent.md) and [architecture](../../docs/architecture.md).

# Intentions

`@daphne/intentions` explains a complete PR comparison as ordered intention cards: actual behavior before and after, the desired outcome, its motivation, and supported potential issues. Intentions describe the overall code and can share evidence. They do not consume or modify semantic-split groups.

## Public entry points

- `runIntentions(input, options)` runs one investigation under the caller's run budget and returns accepted cards or a failure with collected work.
- `validateIntentions(text, context)` validates model JSON and resolves code citations from retained source bytes. It returns a valid proposal or diagnostic messages.
- `toIntentionProposalInput(proposal)` projects a validated proposal for independent judges, keeping citation IDs and byte ranges while leaving source text in the separately supplied evidence packet. It does not mutate the enriched proposal used for artifact and report validation; supply all delivered sources, including uncited evidence needed to find omissions.

The validation context comes from the supplied comparison and context-engine snapshot, with the source IDs actually delivered by the host. The package exports their input, result and card types. Provider schemas, prompts, limits and loop helpers stay internal.

## Caller contract

Supply a pinned `ReviewIdentity`, complete `Change[]` inventory, exact `DiffContextHunk[]` evidence and captured PR `{ url, title, body }` metadata. Every text hunk needs each existing side once in BASE-then-HEAD order. Existing sides with no changed lines have empty source anchors; absent file sides have no source. Include one `{ change, hunkIndex: null, sources: [] }` entry for each metadata-only change.

The package validates these inputs without copying them. Callers must leave them unchanged because the workflow and returned comparison share them. It checks hunk membership, paths, side order, line counts and complete inventory coverage. Context-engine validates source identity, exact UTF-8 byte lengths and conflicts. Missing required evidence fails; unsupported content remains explicit metadata with a limitation. An empty inventory returns an empty proposal without counting or generation.

The caller supplies an optional `provider` (OpenAI by default), credentials, model name, a positive `maxInputTokens`, a shared `RunBudget`, and an evidence executor. Create the budget before acquiring evidence and bind acquisition and the session executor to `budget.signal`. For example, after acquiring a session with that signal:

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

Keep the borrowed session and its Git snapshot alive until the promise settles. The executor must accept untrusted requests, validate them before I/O, obey its response limits, and return results for the same pinned identity. The existing review-evidence session supplies this behavior. The caller owns the optional overall deadline, cancellation of repository work, cleanup, environment loading and persistence. An optional `onModelCall` receives native usage and timing plus role, candidate number and conversation ID, including failed requests. The continuing writer owns one client and its call counters.

## Investigation loop

1. Retain all diff sources in context-engine and preserve their change/hunk mappings. Assemble the entire supported diff with PR metadata and the full inventory. Omitted source or an oversized request fails explicitly.
2. Count the actual instructions, output schema, tool definitions and complete replay history before each generation.
3. If the model requests tools, execute them sequentially through the borrowed executor. Available tools are `list_changes`, `inspect_change`, `search_code` and `read_source_lines`. Search and line reads can address unchanged files in either pinned revision. Defaults for tool response/page limits stay with review-evidence.
4. Record each returned page in context-engine, assemble its exact sources with evidence IDs, and return navigation, notices and the continuation cursor. Replay every provider output item, including reasoning, with native results paired by `call_id`. Text accompanying pending calls is never accepted as final.
5. Return the terminal writer reply to the shared evaluator-optimizer runner. Validate its JSON through the Zod writer schema, then check citations against trusted evidence. Invalid proposals receive diagnostics in the continuing writer conversation and produce a complete replacement. Each terminal proposal consumes one candidate slot; tool continuations do not.
6. Accept a structurally valid proposal immediately. No reviewer model participates in acceptance. The independent judge in `apps/eval` assesses semantic quality after generation.

The internal conversation wrapper supplies prompts, schemas, tools and the writer history to `runModelConversation` from `@daphne/llm`. LLM manages counting, capacity checks, replay and sequential tool continuation. Intentions retains pending tools, delivery receipts and diagnostic records through required callbacks. Only source evidence included in a request that produced a completed model reply is marked delivered and citable. Candidate validation uses the snapshot from its terminal writer reply. Token counting and retention do not establish delivery. Search previews remain navigation; a source read is needed for a code citation. Unavailable reads return notices, so the model can correct a line range or acknowledge missing context. Open continuations and retrieval notices remain visible even when the final proposal is valid.

The writer investigates consequential questions about the transition, including relevant unchanged callers, contracts, dependencies and failure paths in either revision. It examines implementation problems and harmful engineering choices, checking reachability and counterevidence before reporting concerns. Existing weaknesses matter when the PR introduces, worsens or makes them relevant to the intention. This is proportional investigation, not a full repository audit or a minimum tool-call requirement. Whole short evidence ranges and focused reads help avoid incomplete citations; instructions cannot prove semantic support or reliable issue discovery.

## Card contract and evidence

A model proposal has `intentions` and `warnings`. Each card requires a title, known `changeIds`, `before`, `after`, `intendedOutcome`, `why`, and `issues`. Before and after explain actual behavior with citations. Intended outcome describes the desired result; why explains its motivation. They can differ from the implementation, and neither should silently become an invented requirement. Missing fields are rejected rather than defaulted.

Code citations sent by the model contain only `kind: 'code'`, `evidenceId` and an absolute, half-open UTF-8 byte `range`. Validation requires a nonempty range inside delivered retained evidence, on BASE for before claims and HEAD for after claims. Accepted citations gain a `source` containing the exact referenced bytes and provenance; the model never supplies that snippet. Change citations use `kind: 'change'` and `changeId` for file absence, modes, renames and other metadata.

Intended outcome and motivation both use `IntentionReason`, with one of three forms:

- `basis: 'stated'`: text and exact `{ field: 'title' | 'body', quote }` citations from captured PR metadata.
- `basis: 'inferred'`: text and supporting code/change citations. Inferences should be phrased as such.
- `basis: 'unknown'`: no fabricated explanation or citations.

A feature request can support a stated outcome while leaving its motivation unknown. Each quotation must support the particular assertion; exact quotation matching alone does not prove that interpretation.

Potential issues use the exported `IntentionIssue`: `text`, `relevance` (`introduced`, `worsened`, or `made_relevant`), required nullable `uncertainty`, and nonempty `citations`. The narrative explains the condition, consequence, threatened outcome or constraint, and connection to the PR. Citations may combine BASE and HEAD, including unchanged source; purpose-based concerns rely on the card's supported purpose. Non-null uncertainty names a specific unverified premise and must be nonblank. A relevant conditional concern is allowed; null does not establish certainty. Cross-intention concerns belong once on the most relevant card.

An empty issues array is valid and does not certify correctness. Warnings record investigation limitations rather than hiding potential issues. Runtime acceptance checks structure and citation provenance. Whether an issue is supported requires independent semantic assessment.

The writer schema and explicit citation checks establish structural consistency and provenance. They cannot prove whether evidence semantically supports a claim or an exact PR quotation supports the stated motive. Independent evaluation must check explanation quality, duplicate/missing intentions, issue discovery and appropriate use of metadata citations. There is no exactly-once hunk assignment rule.

## Budgets and outcomes

| Guardrail                                      | Limit                                            |
| ---------------------------------------------- | ------------------------------------------------ |
| Input tokens                                   | Caller supplied, counted before every generation |
| Output tokens                                  | 16,384 per generation                            |
| Writer candidates / overall deadline           | Optional caller ceilings, unset by default       |
| Context packet / complete caller model request | 8 MiB each                                       |
| Retained evidence                              | 32 MiB                                           |

These are application limits, not model capacity claims. The model adapter adds its transport envelope and per-request deadline. There is no compaction, hierarchy or automatic fallback for an oversized initial diff. `createRunBudget` from `@daphne/evaluator-optimizer` resolves optional `maxCandidates` and `timeoutMs` settings once for the whole run. The CLI exposes them as `--max-candidates` and `--run-timeout-ms`. There are no local generation, tool-call or correction quotas. Without a configured deadline, a tool conversation can continue until completion, cancellation or failure; a candidate ceiling only limits completed proposals.

After input validation, `comparison` references the supplied PR metadata, pinned identity and full inventory used by the investigation. Both outcomes retain the resolved budget, capacity limits, the evidence snapshot, hunk mappings, per-turn and per-attempt delivered-source snapshots, tool requests/results, completed turns, diagnostics, retrieval limitations and attempted call counts. Turns and tools identify their conversation and candidate. Tool records distinguish completed execution from failure and record whether their output reached a completed model turn in that conversation. A nonempty success has `acceptedCandidate: { candidateNumber, writerTurnNumber }` and the selected writer response. Completed attempt evaluations are `{ kind: 'structural', status: 'accept' }` or `{ kind: 'structural', status: 'revise', diagnostics }`; interrupted evaluations remain null. Empty success has no attempts, calls or accepted reference. Candidate/turn/tool numbers are one-based. Failed runs have `proposal: null`, `response: null` and `acceptedCandidate: null`; earlier drafts remain in `turns` for diagnosis. Results are in-memory data, not a crash-resume format. Hosts must serialize errors deliberately if saving artifacts.

## Ownership and verification

Runtime dependencies are context-engine for retention/assembly, llm for provider calls and conversation protocol, evaluator-optimizer for proposal iteration and run budgets, and Zod for proposal shape validation, inferred raw types and generated request schemas. Review-evidence is imported only through its type-only contracts export. This package has no Git handle, repository I/O, PR acquisition, CLI, telemetry or filesystem persistence. It adds no RCI/PCG index or general-purpose agent framework.

Offline conversation tests verify delivery snapshots, failed requests leaving receipts pending, retained tool failures and terminal replies arriving with cancellation. Repository checks verify integration; no live model calls are part of normal checks. Dedicated intentions workflow and artifact-reader tests remain deferred under repository test policy; static review and temporary offline checks do not replace permanent coverage. Live provider compatibility and explanation quality require separate evaluation. See the [validation-and-repair plan](../../docs/superpowers/plans/2026-11-03-intentions-validation-repair.md), [original implementation plan](../../docs/superpowers/plans/2026-10-25-intentions-agent.md) and [architecture](../../docs/architecture.md).

Provider request/response formats stay in `@daphne/llm`. The writer uses one client for the selected provider/model; every completed turn retains its actual instructions for provider-independent evaluation.

# Intentions Token Efficiency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. The user selected inline execution earlier; preserve that choice. Steps use checkbox (`- [ ]`) syntax for tracking. The current request authorizes writing this plan only.

**Goal:** Reduce repeated input and unnecessary model continuations in the intentions workflow while preserving evidence, citation provenance, and semantic acceptance requirements.

**Architecture:** Keep the evaluator–optimizer loop, writer history, fresh reviewer conversations, and deterministic validation. Remove hydrated citation copies only from reviewer input, add optional page selection to context assembly, and organize reviewer evidence before candidate-specific content. Measure the batching already enabled; keep reviewer-quality changes in their separate plan.

**Tech Stack:** Existing TypeScript/Node/Bun workspaces, Responses API adapter, context engine, CLI artifacts, and evaluation reader. Node 24.22.0 and Bun 1.4.3; no new dependencies or packages.

**Spec:** The user's request in this chat to reduce token consumption without losing essential source context or validation, captured in [Requirements and scope](#requirements-and-scope). Preserve the contracts in [ADR 0006](../../adr/0006-evaluator-optimizer.md), [architecture](../../architecture.md), and the [intentions design](../specs/2026-10-25-intentions-agent-design.md). The [reviewer-generalization plan](2026-10-31-intentions-review-generalization.md) is related work, not an implementation dependency.

## Global constraints

- This planning task writes only this document. It makes no production/test edits, paid calls, commits, uploads, or changes to existing experiment artifacts or the reviewer plan.
- During implementation, preserve writer instructions, reviewer criteria/instructions, independent judge rubric, schemas, acceptance policy, model, reasoning effort, and global budget. Prompt changes intended to reduce unnecessary repairs belong to the reviewer-generalization plan.
- Preserve full supported diff coverage, complete change inventory, exact source bytes, evidence IDs, source ordering, UTF-8 byte ranges, and pinned BASE/HEAD identity. Do not merge overlapping excerpts or renumber evidence to shrink requests.
- Preserve deterministic validation before semantic review, full replacements, a fresh whole-proposal reviewer for every structurally valid candidate, all five criteria, failure retention, and accepted writer/reviewer linkage.
- Retained evidence is not delivered evidence. Keep conversation-specific receipts, successful-generation delivery confirmation, and transfer of all newly delivered reviewer sources during repair, including evidence for omissions.
- Keep run artifacts, enriched public proposals, and the existing `daphne-context-v1` packet shape. Existing context assembly without the new selection must retain byte-identical rendering and packet IDs.
- Keep output capacity 16,384 tokens, context/request capacity 8,388,608 bytes, and retention capacity 33,554,432 bytes. Count the exact complete request before generation; no silent truncation or capacity increases.
- Do not add or modify tests unless explicitly requested, except existing tests broken by the new behavior as allowed by repository policy. This overrides generic TDD steps. Do not disguise new tests as temporary assertion scripts. Run existing checks and disclose the missing focused coverage.
- Use public workspace exports, relative `.js` imports, existing strictness, and Node runtime APIs. Add concise comments for changed contracts and update their owning documentation.
- Paid measurement is a separate step requiring a concrete, authorized allocation. The original nine runs and this planning request do not authorize another paid experiment.

## Review focus

Dedicated reviewer, context-selection, and artifact-reader tests are currently absent. These five cases require deliberate source review and verification against any matching recorded data; absent examples remain verification limitations, not invented test coverage.

1. Multiple cards cite identical or overlapping multibyte source ranges: removing embedded snippets preserves every citation and its exact resolvable bytes. Task 1 owns this check.
2. A continuation or retry refers to an earlier page: selection finds the requested page, preserves original page indexes/cursors, and never constructs an invalid shortened ledger. Task 2 owns this check.
3. A tool fails, or generation fails/cancels after retrieval: no source becomes writer- or reviewer-citable merely because it was retained or counted. Task 2 owns this check.
4. A reviewer starts after another reviewer discovered sources: its initial delivered IDs remain exactly the current writer's IDs, in order; sources needed for omissions survive feedback. Tasks 1 and 3 own this check.
5. Larger requests, failed runs, and cold or uncertain caches: capacity rejection remains explicit, failures stay in denominators, and fewer bytes or a higher cache-hit percentage are not presented as measured cost or quality gains. Tasks 3 and 4 own this check.

## Requirements and scope

The agreed separation is two focused plans under one objective. This plan reduces payload and continuation overhead with review behavior held fixed. The reviewer-generalization plan later measures the additional effect of changing review instructions on this optimized baseline; it must record a new baseline revision rather than reuse an obsolete one.

**Required:** deduplicate reviewer source representation; stop including unrelated historical navigation in each tool reply; prepare stable reviewer evidence messages; measure the existing batching change; compare tokens and cost alongside quality. Keep the complete retained ledger for audit and fresh-conversation preparation.

**Deferred:** writer-history compaction, source summarization, delta-only semantic review, model/reasoning changes, prompt-level batching guidance, new token quotas, count-endpoint removal, concurrent tool execution, additional critics, and changes to independent judge payloads. These change other factors or have weaker evidence of benefit.

**Cache scope:** stable message organization is an implementation task. Provider-specific explicit cache controls are an optional isolated experiment after support is verified for both counting and generation. They are not enabled globally or inferred from model-name prefixes in this plan. The generic CLI accepts arbitrary model names; a capability registry or new public cache setting needs a separate justified decision.

**Success:** smaller measured requests with unchanged source/provenance invariants, followed by lower observed workflow input or monetary cost without a confirmed material quality regression in a controlled pilot. Mechanical completion and semantic-quality qualification are separate outcomes; no percentage saving is promised.

## Baseline evidence and measurement rules

Planning inspected revision `4066d8d62a799c61cb73cb0b6496da29a15c55d7`. Capture the actual execution revision and existing changes before implementing; do not overwrite unrelated work.

The [recorded experiment](../../../outputs/evaluator-optimizer-2026-10-31T110742-905Z/report.md) used 2,595,462 workflow tokens over 96 generations, with 19 candidates, 18 semantic reviews, and 59 tool calls. It predates `fdce95b`, which enabled multiple tool requests per reply. Treat it as diagnostic evidence rather than a contemporaneous baseline.

The observed duplication has two distinct causes:

- `proposal.ts` resolves source text into each citation; `review/review.ts` sends that enriched proposal alongside the writer-delivered source packet. PR #3 run 1's first proposal contained 56,021 compact JSON bytes, including 35,081 bytes of citation source text.
- `tools.ts` selects the current result's sources, but `context-engine/assembly.ts` includes the entire retained query/observation history. Across 59 tool replies, 59 unique query records appeared 231 times. This does not mean the executor repeated identical requests within a workflow.

Measure serialized request bytes, source-text bytes, navigation bytes, input/output tokens, cache-read/cache-write details when supplied, generations, tool calls per generation, candidates, failures, and latency by role. Distinguish tool requests from model continuations and terminal outputs. Count-endpoint calls are separate requests, not another copy of generation usage to add to token totals.

Keep measurement scripts and reports in a fresh ignored `outputs/intentions-token-efficiency-<UTC>/` directory at execution time. Reconstruct historical requests using their recorded instructions, schemas, replies, and tool outputs; label reconstructed values, compare recorded input counts where available, and report missing settings rather than claiming byte-exact replay. Use separate source/build states when a comparison changes executable code. Do not add a permanent benchmarking framework.

## File and ownership map

| Path                                                                                                                           | Responsibility and planned action                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `packages/intentions/src/review/input.ts`                                                                                      | New package-local projection from validated proposal to compact reviewer proposal.                 |
| `packages/intentions/src/review/review.ts`                                                                                     | Consume the projection; construct stable and changing reviewer messages.                           |
| `packages/context-engine/src/{contracts,assembly,index}.ts`                                                                    | Add and export optional query-page selection; preserve default packet behavior.                    |
| `packages/context-engine/src/engine.ts`                                                                                        | Inspect forwarding of the new option; edit only if needed to preserve it.                          |
| `packages/intentions/src/{context,tools}.ts`                                                                                   | Select the current tool page while preserving full retention and source delivery.                  |
| `packages/intentions/src/workflow.ts`                                                                                          | Inspect initial/feedback receipt contracts; no behavior change planned.                            |
| `apps/eval/src/intentions/{artifact-delivery,artifact-trace,artifact,evidence,judgment}.ts`                                    | Verify reader compatibility; no weakening or shape change planned.                                 |
| `packages/intentions/src/conversation.ts`, `packages/llm/src/{conversation,openai,usage}.ts`                                   | Inspect batching, replay, exact counting, and raw usage; no production change planned.             |
| `packages/context-engine/docs/context-and-paging.md`, `packages/intentions/src/review/README.md`, `apps/eval/docs/commands.md` | Document the changed assembly contract, reviewer representation, and bounded comparison procedure. |

## Verification common to implementation tasks

Use the pinned runtimes, then run `bun install --frozen-lockfile` once and record its result. The planning shell defaulted to Node 22/Bun 1.1; do not assume the shell selects the pins. Node 24.22.0 and Bun 1.4.3 were available under `/private/tmp/daphne-intentions-runtimes/`, but temporary paths must be checked again at execution.

For Tasks 1–3, format only changed files with the repository Prettier configuration, run `bun run test packages/intentions/tests/conversation.test.ts packages/llm/tests`, then `bun run check`. Expected: successful exit, no new lint/type/format failures, and all existing tests passing. Inspect output and separate pre-existing failures from regressions; never reformat unrelated files to conceal a baseline failure.

The existing conversation checks exercise delivery isolation and cancellation, not all new selection/projection behavior. Review the listed invariants directly and record read-only artifact comparisons. New permanent or temporary tests remain outside current authorization. Future implementation receives one fresh-context review of the complete change; the author self-reviews this plan.

### Task 1: Remove hydrated source copies from reviewer proposals

**Files:** Create `packages/intentions/src/review/input.ts`; modify `packages/intentions/src/review/review.ts` and its `README.md`; read `schema.ts`, `proposal.ts`, and the artifact reader.

**Interfaces:** Consume `IntentionsProposal` from `../contracts.js` and existing `RawIntentionsProposal` from `../schema.js`. Produce package-local `toReviewProposal(proposal: IntentionsProposal): RawIntentionsProposal`. No public package export or schema change.

- [ ] Record the baseline revision, prompt/schema hashes, capacities, batching setting, and artifact hashes in the experiment directory. Record the saved proposals' source duplication and reviewer request sizes before changing their representation.
- [ ] Implement the pure projection. Rebuild code citations with `kind`, `evidenceId`, and `range`, omitting only `source`; preserve all text, indexes, array ordering, warnings, change citations, and stated/inferred/unknown rationale variants. Do not mutate the validated proposal or reparse trusted typed values through Zod.
- [ ] Use that projection only in reviewer input. Keep the complete writer-delivered evidence packet, whose exact source references and absolute byte ranges resolve the attached citations. Do not create a second table of copied citation snippets or narrow evidence to cited ranges alone.
- [ ] Compare recorded validated proposals with projected inputs: all non-source fields agree and every code citation resolves to the same retained bytes. Include repeated citations and inspect multibyte/overlapping ranges if present; report any absent input class.
- [ ] Document the distinction between compact model input and enriched public/artifact proposals, then run the common verification commands.

**Completion:** Reviewer requests no longer contain hydrated citation source copies; accepted proposals and independent judge packets retain them. Report measured byte reduction, with token/cost effects still unmeasured.

### Task 2: Select current-page navigation for tool responses

**Files:** Modify the context-engine contracts, assembly, public type exports, and context/paging documentation; modify intentions `context.ts` and `tools.ts`. Inspect `engine.ts`, `apps/cli/src/context.ts`, and `apps/eval/src/intentions/artifact-delivery.ts`.

**Interfaces:** Add exported `QueryPageSelection` with readonly `queryId: string` and zero-based `pageIndex: number`. Add optional `queryPages?: readonly QueryPageSelection[]` to `AssembleInput`. Extend `assembleEvidence(engine: ContextEngine, evidenceIds: readonly string[], queryPages?: readonly QueryPageSelection[]): ContextPacket`. Existing two-argument calls retain their behavior.

- [ ] Validate the complete snapshot as today, then validate the optional page selection against it. Reject unknown queries, duplicate pairs, unsafe/negative indexes, and out-of-range pages. Do not filter the snapshot before `validateAndCopySnapshot`: a continuation-only ledger fails its cursor-chain and fingerprint invariants.
- [ ] When selection is absent, preserve current rendering and packet IDs exactly. When present, render navigation entries/notices only from selected pages, in ledger order with original page indexes, plus one summary per selected query. Preserve that query's actual retained status and `recordedPages`; they describe retained progress, not proof of model delivery. An empty selection renders no queries or navigation.
- [ ] Keep source selection independent and unchanged. Omission counters describe selected content that did not fit, not deliberately unselected history. Preserve current byte budgeting and explicit rejection when required selected content cannot fit.
- [ ] After `engine.addToolResult(result)`, locate the retained query by the normalized returned request with `cursor: null`, then locate the page by `result.request.cursor`. Use structural equality; do not reimplement query hashing or assume the requested page is always the last one. Pass that one query/page selection and the existing result source IDs to `assembleEvidence`.
- [ ] Preserve the tool output envelope (`request`, `completeness`, `nextCursor`, `notices`, JSON-string `context`), exact source arrays, and evidence receipts. Keep every query/page in the retained engine snapshot. Initial reviewer assembly and repair feedback may still use the full snapshot; this task changes only tool-response navigation selection.
- [ ] Verify the unchanged artifact reader still requires exact raw-result/source agreement, `daphne-context-v1`, and zero required-content omissions. Re-read historical accepted artifacts through `loadIntentionArtifact`; expected: the same complete/failed classifications. Review continuation, retry, unavailable-source, failed-generation, and cross-conversation delivery paths. Do not relax reader checks or add a legacy decoder.
- [ ] Document default-versus-selected assembly semantics. Run common verification and compare recorded tool payloads: old unrelated query pages disappear, current navigation/cursors/notices and source bytes remain.

**Completion:** Each tool reply includes its own navigation page without historical copies. Default context inspection, complete retention, artifact format, and delivery authorization remain unchanged.

### Task 3: Put immutable review evidence before changing candidates

**Files:** Modify `packages/intentions/src/review/review.ts` and its `README.md`; consume Task 1's projection and Task 2's optional selection.

**Interfaces:** Keep `reviewIntentionCandidate(candidate, runtime)` and `IntentionReviewRuntime` unchanged. Reviewer history remains provider input items consumed by `runIntentionConversation`; no new provider option, public model setting, or delivery-receipt kind.

- [ ] Derive the initial diff IDs from `runtime.hunks`, deduplicated in existing first-occurrence order. Assemble them with `queryPages: []`. Construct the first user message from pinned identity, PR metadata, changes, hunks, and this diff packet; exclude changing limitations, proposals, and tool history.
- [ ] Assemble the writer-delivered IDs not already in the diff packet as a separate supplemental packet, retaining the current navigation snapshot once. Put it in the next message with current limitations and the compact proposal. Each source ID appears in one of these initial packets; do not coalesce distinct overlapping evidence IDs.
- [ ] Seed delivery with the original `candidate.deliveredEvidenceIds`, preserving order. Verify that the two packets contain exactly that set, and that all required diff IDs are present. A missing required source is an invariant failure, never an invitation to include undelivered retained evidence.
- [ ] Enforce the existing context capacity across both evidence packets together and retain the complete-request byte/token checks. Splitting messages must not double the effective context allowance or silently drop source/navigation. Keep tool and writer histories untouched.
- [ ] Compare serialized first messages across revisions of the same pinned run; expected: identical bytes despite candidate/extra-evidence changes. Verify each fresh reviewer still receives the current full candidate and all writer-delivered sources, without prior verdicts or writer reasoning. Run common verification.

**Completion:** Stable source material precedes changing content and the request preserves its evidence contract. This establishes prefix stability, not a measured cache hit. OpenAI's current documentation says GPT-6 shared-prefix reuse can require an explicit breakpoint; evaluate that only under Task 4's separately authorized, model-specific experiment.

### Task 4: Measure the optimized workflow with a bounded comparison

**Files:** Modify `apps/eval/docs/commands.md`; create measurement records and reports only in the new ignored experiment directory. Reuse the CLI, `loadIntentionArtifact`, existing independent judge, and raw model usage; no new benchmark package or production telemetry interface.

**Interfaces:** Consume current run artifacts and `loadIntentionArtifact(path: string): Promise<PreparedIntentionArtifact>`. Keep all judge inputs/rubrics unchanged. Inspection and offline measurement do not authorize the CLI's paid generation/judge commands.

- [ ] Before paid calls, report per-task offline payload differences using identical saved trajectories. Compare base → Task 1 → Task 2 → Task 3 separately. Record that a fixed trajectory measures serialization, not how the model will choose tools or repair candidates after a change.
- [ ] Prepare a concrete manifest with exact pinned PR URLs/commits and captured metadata from the original three cases, isolated baseline/candidate source hashes, models, prompt/schema hashes, output directories, execution order, concurrency, quality assessor, and paid-call allocation. Keep both arms on the current batched code; hold all prompts and budgets fixed.
- [ ] Propose a first pilot of six workflows: three known PRs × baseline/optimized, one run per arm, with at most six independent judgments of accepted outputs. Use the recorded experiment settings in both arms: `gpt-6-sol`, low reasoning, 256,000 input capacity, three candidates, 600,000 ms shared deadline, and existing output capacity; judge with `gpt-6.1-sol` and the existing timeout. Confirm model availability before authorization. Include human/source inspection effort; do not add unbudgeted model adjudication calls.
- [ ] Obtain authorization for that concrete manifest before execution. Use counterbalanced arm order and comparable concurrency; record cache reuse conditions rather than claiming fresh caches. Do not overwrite original artifacts or replace failed runs with extra samples.
- [ ] If separately authorized, isolate batching with three additional workflows on the same baseline with only `parallel_tool_calls` disabled; compare against the already scheduled batched baseline. All other settings remain identical. Do not infer batching's causal benefit from the older nine-run experiment, or from faster local tool execution.
- [ ] Keep explicit-cache measurement optional and separately allocated. For the pinned supported model, verify official count/generate support, then use an isolated experiment patch marking the stable content boundary while preserving implicit continuation caching. Do not ship the patch globally, use a different model silently, add a retry fallback, or assume a cache key alone fixes prefix matching. Record the final request shape and cache writes as well as reads.
- [ ] For each scheduled run, retain success/failure and per-role usage. Read cache-write information from raw responses; current `TokenUsage` lacks that field. Treat missing breakdowns as unknown. Use verified rates with disjoint ordinary-input/cache-read/cache-write categories for dollars; do not charge inclusive input again or treat cached tokens as free. Report raw tokens independently from cost.
- [ ] Revalidate accepted artifacts, assess source-grounded accuracy/citations/rationale/coverage/coherence with the unchanged rubric, and retain all failures in denominators. Report independently assessed clean accepted outputs per scheduled run, inadequate accepted outputs, assessment gaps, and consumption including unsuccessful workflows. One run per PR is a pilot, not a generalization claim.
- [ ] Document adoption evidence: reduced observed input or cost with preserved provenance and no confirmed material quality regression supports further use; inconsistent behavior, missing quality assessment, or a worse quality/cost tradeoff is inconclusive. Do not choose a winner solely on cache-hit percentage or a byte reduction. Record separate outcomes for mechanical implementation, live efficiency, and quality.

**Commands at execution:** `bun run build` must succeed before running compiled CLI/eval commands. Reuse the [intentions CLI](../../../apps/cli/docs/intentions.md) and [evaluation commands](../../../apps/eval/docs/commands.md); resolve paths and arguments from the authorized manifest. A failed workflow is a retained experimental result, not a failed measurement script to retry automatically.

**Completion:** A reader can distinguish proven payload reduction, observed batching/cache effects, total workflow savings, and quality uncertainty. If paid execution is not authorized, finish implementation/offline reporting and explicitly leave live measurement pending; do not report semantic or monetary success.

## External guidance and limits

- [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), checked 2026-10-31: matching prefixes require eligible boundaries; GPT-6 supports explicit breakpoints, and cache writes have distinct accounting. Stable message layout alone is not proof of reuse. Verify provider details again before the optional experiment.
- [Anthropic tool design](https://www.anthropic.com/research/writing-tools-for-agents): return relevant tool information and evaluate token use, tool activity, and errors. Daphne's exact source and provenance requirements limit which fields can safely be removed.
- [Anthropic evaluator–optimizer pattern](https://www.anthropic.com/research/building-effective-agents): refinement should deliver measurable value. This plan holds the evaluator fixed so payload effects can be separated from the later reviewer-quality experiment.

## Planning completion and handoff

The author checked requirement coverage, interface names, selection/continuation invariants, artifact-reader coupling, and the separation from reviewer-quality work. A focused read-only investigation checked consumers; it did not implement or review the plan in place of the author's self-review.

Implementation uses the previously selected inline executing-plans workflow and one final fresh-context review. Current authorization ends at this document; no implementation, new tests, paid evaluation, commit, or merge follows automatically. Review the plan before execution. The reviewer-generalization plan remains unchanged and should adopt the measured optimized baseline only when that separate work begins.

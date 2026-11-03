# Intentions efficiency investigation

This records the documentation and implementation evidence behind the November 1,
2026 fixes. It is not a live performance comparison or authorization for model
calls. The November 2 cleanup removes the provider-specific review schema fork and
duplicate source ledger. The Anthropic adapter compacts object alternatives and
string literal choices while the canonical local schema retains variant checks.

## Documented API facts

- [Claude automatic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#automatic-caching)
  requires opt-in. Its moving boundary suits appended conversations; the default
  lifetime is five minutes. Reuse needs an identical prefix and sufficient length.
  The 20-block lookback and changes to tools, system content, effort, thinking or
  output format can affect reuse. One-use writes can cost more than ordinary input.
- [Claude token counting](https://platform.claude.com/docs/en/build-with-claude/token-counting#how-to-count-message-tokens)
  supports the same structured inputs, including cache control and output
  configuration. [Pricing and the caching FAQ](https://platform.claude.com/docs/en/build-with-claude/token-counting#pricing-and-rate-limits)
  establish that counting is free, rate limited, and does not warm the generation
  cache. An estimate matching these runs does not guarantee equality for every
  future request.
- [Claude cache usage](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance)
  separates ordinary input, reads and writes; add those three counts for inclusive
  input. The existing normalizer and cost estimator already follow this rule.
- [Claude tool continuations](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls#handling-tool-use-and-tool-result-content-blocks)
  retain matching tool IDs and adjacent assistant/tool-result messages, with tool
  results before other user content. Native thinking and tool blocks stay intact.
  [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
  likewise requires returned reasoning items alongside tool outputs; its
  [conversation-state guide](https://developers.openai.com/api/docs/guides/conversation-state)
  describes retaining replayable response output.
- [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#how-it-works)
  use `output_config.format`. Grammar compilation has its own cache; changing the
  schema or tool set can invalidate it. This is distinct from prompt caching.
  Local validation remains necessary for unsupported schema constraints and
  workflow invariants.
- [Claude input and context guidance](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence#trim-input-and-context-tokens)
  supports removing unnecessary repeated input. It does not establish the quality
  or latency effect of changing Daphne's reviewers. [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)
  has different activation, lifetime and accounting rules; equivalent-looking
  settings are not interchangeable.

## Verified problems and changes

The evidence is the two original `generation/run.json` and `evaluation/input.json`
files under `outputs/intentions-eval-2026-11-01T20-17-17.343Z-77099/` and
`outputs/intentions-eval-2026-11-01T21-18-05.548Z-18147/`.

| Demonstrated problem                                                                                    | Smallest complete change                                                                                                                                                                                                                                                                 | Producers, consumers and contracts                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All 23 Claude generations report zero cache reads and writes; its request builder omits caching opt-in. | Cache the initial message and growing history inside the existing Anthropic request builder; leave scalar one-shot inputs uncached. The caching and counting documentation above supports both fields and their distinct behavior.                                                       | Anthropic adapter and its count/generate transport. No new workflow setting, model-name check or public request contract.                                                                                                                          |
| Enriched code citations copy source text already present in the judge inventory.                        | Reuse the existing compact proposal projection after full artifact validation. This follows input-trimming guidance without editing continuation history.                                                                                                                                | Eval owns compact proposal serialization in `toIntentionJudgeInput`. Reply validation retains the enriched proposal and all source IDs and bytes.                                                                                                  |
| The Claude reviewer performed a complete empty HEAD `.handle(` search, but the judge could not see it.  | Validate saved query chains and each delivered tool packet, then include scoped search receipts with origin and delivery turns. Tool-continuation documentation supports preserving results; the exact search semantics come from Daphne's retrieval contract, not provider assumptions. | Eval reuses the validated snapshot directly. Tool/delivery/trace readers and the judge packet carry receipts. Gold's synthetic snapshot declares an empty query list. Judge instructions distinguish investigation receipts from source citations. |

The source of truth for search semantics is
[retrieval](../../../packages/review-evidence/docs/retrieval.md): literal,
case-sensitive, single-line matches in pinned committed regular text. Receipts
retain page cursors, completeness and notices. They cannot prove arbitrary caller
absence, make previews citable, authorize new source IDs or establish inherited
writer delivery. Saved query fingerprints, source bytes, tool calls and rendered
navigation must agree before receipts enter a judge packet. Invalid saved context
is reported as invalid output, including conflicts and capacity failures.

The original token/cost totals were independently reconciled against native
usage. The 37 preflight counts match their corresponding generation input counts
in these artifacts. Summed API time includes parallel work and is not wall time.
The original gold case, writer prompt and judge rubric match, but the captured
accuracy-review prompts differ. These runs do not isolate model performance.

## Verification and experiments

Run the repository's pinned Node/Bun versions, `bun install --frozen-lockfile`,
format changed files, and `bun run check`. Existing tests remain the automated
regression gate; repository policy does not authorize adding tests for this task.
Use temporary offline assertions to reload both original artifacts, reconstruct
compact source references, preserve proposal/source identity, check malformed
receipt rejection, and capture adapter requests without contacting a provider.

Serialized byte reductions measured from saved trajectories are payload
measurements only. No inference-token, billing, latency, semantic-quality or cache
hit improvement is claimed without live measurement. The historical artifacts
remain unchanged. Paid model reruns require an explicit request; the user
authorized the November 2 live verification below.

### November 2 live verification

The first authorized rerun confirmed HTTP 400 grammar-size failures on all three
reviewers. Schema-only probes rejected both the original object unions and the
object-only compaction; merging string literal alternatives into enums succeeded.
This follows the documented [schema complexity guidance](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits).
Strict tools and canonical local validation remain enabled.

The exact `make intentions-eval CASE=apps/eval/datasets/intentions/cases/pr_1.json PROVIDER=anthropic`
then exited successfully. The run under
`outputs/intentions-eval-2026-11-02T08-43-07.907Z-67539/` completed generation and
independent evaluation. Generation took 173.944 seconds, with 19 successful
generations and 19 counts, four candidates, and an estimated cost of $1.9117998.
Native usage records 257,525 cache-write tokens, 601,774 cache-read tokens, 70
ordinary input tokens and 25,177 output tokens. Every count matched inclusive
generation input. These observations establish live caching and API acceptance,
not controlled savings. The provisional judge still found quality problems and
missed-known-issue coverage; reviewer or acceptance changes remain experiments.

### Investigating the 44/100 result

The four equally weighted areas were explanation quality (65), complete behavior
transitions (1/9, or 11.11), relevant supported issues (2/4, or 50), and gold issue
checks (50: the known issue was missing, both false-alarm controls were avoided).
Their average is 44.03; this is not an accuracy percentage.

The collision source was delivered to the writer and reviewers. Executing the
frozen repository and fingerprint helper confirms that `(a:b, c)` and `(a, b:c)`
retrieve the same record with equal fingerprints; the header validator permits
the colon. Tenant issuance restrictions remain unknown. All 12 reviewer calls
reported zero thinking tokens and performed no retrieval. They accepted
future-backend and future-HTTP-layer concerns and broad coverage quotes despite
missing behavioral details.

The adapter forced `effort: 'low'` for every Anthropic request. The official
[effort guide](https://platform.claude.com/docs/en/build-with-claude/effort#how-effort-works)
documents reduced capability, fewer tool calls and terser explanations at lower
effort. Removing that override restores each model's documented default without
changing prompts or validation. This fixes the configuration choice; whether it
recovers the issue or improves quality requires a controlled paid comparison.

Reviewer count, reviewer-model choice, review reuse, incremental review, altered
acceptance rules and prompt changes require controlled experiments. Fix pinned
revisions, metadata, source state, prompts, schemas, model settings and budgets;
vary one factor at a time. Record cache reads/writes, inclusive tokens, wall time,
cost, incomplete outcomes, independently assessed defects and human review effort.
Do not accept an exhausted draft, skip a review merely because a prior one passed,
remove evidence, or weaken citation validation to reduce calls. See the existing
[comparison procedure](commands.md#compare-intentions-token-efficiency).

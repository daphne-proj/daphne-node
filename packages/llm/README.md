# LLM

`@daphne/llm` is Daphne's shared model-access package. It sends requests, validates provider responses, counts input tokens, continues model/tool conversations and normalizes reported token usage. It supports the OpenAI Responses API and the native Anthropic Messages API behind one `ModelClient`; semantic-split and intentions reuse it through public exports.

The package has no runtime package or workspace dependencies. It uses Node's native `fetch` and `AbortSignal` for HTTP, caller cancellation and request deadlines. Workflows supply prompts, schemas, conversation state, capacity limits, recording callbacks and tool executors. The package manages the continuation protocol over that state; evidence, acceptance policy, environment loading, telemetry and artifacts remain with callers.

## Main APIs

`createModel(provider, apiKey, model, signal, onModelCall?)` synchronously creates a `ModelClient` with explicit credentials, model and cancellation. `ModelProvider` is `'openai' | 'anthropic'`. `createOpenAI(apiKey, model, signal, onModelCall?)` remains compatible. Factories make no requests. `parseModelProvider(value)` validates provider configuration and defaults to OpenAI when omitted. `defaultModels` holds manually maintained latest model strings; it performs no discovery.

| API                                        | Purpose                                                                                                                                                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `count(request): Promise<number>`          | Count the complete supplied input through the provider's count endpoint, including instructions, messages, tools and response schema. Returns a nonnegative safe integer.                                                |
| `generate(request): Promise<ModelReply>`   | Call the provider, validate a completed response, and return answer text or function calls, replayable output and raw response JSON.                                                                                     |
| `calls`                                    | Mutable counters for attempted `count` and `generate` requests, including failures. Read them for reporting; callers must not modify them.                                                                               |
| `normalizeModelUsage(response, provider?)` | Parse usage from raw response JSON without making a request. Return `TokenUsage` when present and `null` when absent; throw an `Error` for malformed counts, inconsistent totals or breakdowns larger than their totals. |

Counting and generation are separate operations. `generate` does not count first or enforce an input budget: the workflow decides whether to split, stop or generate. A count can be reused only while the provider, model and complete request remain unchanged. Each adapter uses its provider's counting endpoint; see the [OpenAI token-counting guide](https://developers.openai.com/api/docs/guides/token-counting) and [Anthropic token-counting guide](https://platform.claude.com/docs/en/build-with-claude/token-counting).

For example, with `provider`, `apiKey`, `modelName`, `signal` and `maxInputTokens` supplied by the application:

```ts
import { createModel } from '@daphne/llm';

const model = createModel(provider, apiKey, modelName, signal);
const request = {
  instructions: 'Summarize the supplied changes.',
  input: 'The parser now rejects empty identifiers.',
};

const inputTokens = await model.count(request);

if (inputTokens > maxInputTokens) {
  throw new Error('The request exceeds the input-token budget.');
}

const reply = await model.generate(request);
```

## Main types and response behavior

`runModelConversation(conversation, options)` continues one caller-owned history until a terminal reply. `ModelConversation` contains only `history`. `ModelConversationOptions<Turn>` borrows an existing client and signal, request settings without `input`, positive validated `maxInputTokens`/`maxRequestBytes` capacities, and two callbacks:

- `recordTurn(reply, inputTokens): Turn` synchronously retains each completed reply and returns its exact reference. It can also confirm domain-specific delivery. Recording failures propagate; this callback is required work, unlike the optional model-call observer.
- `executeTool(call, turn): Promise<string>` executes a requested tool using that retained turn for any diagnostic records, then returns serialized output. The executor and client must honor the supplied signal. Failures propagate unchanged.

For example, with an existing client and domain callbacks:

```ts
import { runModelConversation } from '@daphne/llm';

const conversation = {
  history: [{ role: 'user', content: 'Investigate this change.' }],
};

const turn = await runModelConversation(conversation, {
  model,
  signal,
  request: { instructions, tools },
  maxInputTokens,
  maxRequestBytes,
  recordTurn,
  executeTool,
});
```

The helper checks serialized request size, counts the complete request on every turn, generates, records the reply, and appends all provider output before executing tools sequentially. Tool results are appended as canonical `function_call_output` items using the provider's call IDs. The Anthropic adapter converts adjacent results to `tool_result` blocks in one user message, including parallel calls. The supplied history is updated in place and can be reused after the caller appends repair feedback; use separate histories for separate conversations and providers.

Completed terminal turns are returned even if cancellation arrived with generation, allowing an outer evaluator to retain the candidate and reject acceptance. Aborted tool-request turns are recorded but start no tools. Completed replies/tool outputs remain available after later failure. The helper adds no timeout, call quota, retry, candidate counting or domain validation. Intentions wraps it with evidence delivery and writer/reviewer records; semantic split retains its direct generation path and reuse of the unchanged initial token count.

- `ModelRequest`: instructions, string or message-array input, an optional strict JSON response schema, function definitions, parallel-call settings and an output-token cap. Existing field names are provider independent; adapters translate them. The workflow owns the original schema and validates its domain rules after generation.
- `ModelReply`: extracted answer `text`, validated replayable `output`, optional `functionCalls`, and the untouched raw `response`. OpenAI commentary stays in replay without entering answer text. Anthropic output is one `{ role: 'assistant', content: [...] }` message containing every native response block, including unchanged thinking signatures and redacted thinking. Append complete output without inspecting or reconstructing the wire format.
- `decodeModelReply(provider, response, tools?)`: validates saved raw response JSON through the same decoder as generation. Omitted tools enables structural validation; supplied tools additionally enforce allowed function names. Invalid, refused, incomplete or unsupported content fails before any tool calls are exposed.
- `ModelCallObservation`: provider, call kind, per-kind sequence number, timing, outcome and raw response JSON. Provider is optional only for older saved events; both adapters emit it. Its model name uses the returned name when available, otherwise the requested name. Requests and credentials are excluded. The callback runs after every attempted HTTP request, including response-validation failures; observer exceptions cannot replace the call's outcome.
- `TokenUsage`: inclusive `inputTokens` and `outputTokens`, plus nullable `cachedInputTokens` and `reasoningOutputTokens` breakdowns. Anthropic also reports `cacheCreationInputTokens` separately from cache reads. `normalizeModelUsage(response, provider = 'openai')` adds uncached input, cache reads and cache writes for Anthropic's inclusive total, and reads reported thinking tokens when available. Missing breakdowns remain unknown, not zero. These fields come from generation usage, not a preflight count.
- `ModelError`: transport, cancellation, timeout or provider-response validation failure. HTTP failures expose the status without returning the provider's error body.

Usage parsing is intentionally separate from generation validation. A successful reply can have unavailable or malformed usage; reporting callers catch normalization errors without changing that reply's outcome. Failed generation observations can still contain usage that should be recorded. The eval app owns Langfuse recording, non-overlapping token buckets and reporting issues.

## Main flow and limits

1. The workflow supplies a request and optionally counts it before deciding whether to generate.
2. The adapter records the attempt, sends it with authorization and a 120-second deadline, then validates the count or completed response.
3. The observer receives timing, status and any parsed response JSON. The workflow decides what to retain and whether another turn is needed.

Counting and generation share each provider's prompt, tools, schema and settings. Generation defaults to a 4,096-token output ceiling, including thinking; callers may set `max_output_tokens`. Counting omits this output cap. Both providers leave reasoning effort at the model defaults. OpenAI uses `store: false` and encrypted reasoning for tool replay. Anthropic also leaves thinking at the model defaults, following its [effort guidance](https://platform.claude.com/docs/en/build-with-claude/effort#recommended-effort-levels), and uses API version `2026-10-21` with bearer authorization. Its endpoints are `POST /v1/messages` and `POST /v1/messages/count_tokens`; see the [Messages reference](https://platform.claude.com/docs/en/api/messages/create) and [token counting reference](https://platform.claude.com/docs/en/api/messages/count_tokens).

Anthropic conversation arrays cache the first plain-text user message explicitly and enable [automatic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#automatic-caching) for the growing history. This keeps initial evidence reusable when later proposal messages change. Scalar one-shot inputs do not opt in. Native replay blocks stay intact; default lifetimes, minimum lengths and invalidation remain provider-owned. [Counting accepts the same fields but does not populate caches](https://platform.claude.com/docs/en/build-with-claude/token-counting#does-token-counting-use-prompt-caching).

Anthropic converts strict response schemas to `output_config.format` and function schemas to `input_schema`. Unsupported numerical and string constraints are moved into descriptions; unsupported array limits and string formats are also removed. Closed object alternatives with shared required fields are compacted for the native grammar, and string literal alternatives become enums; variant relationships remain locally validated. The original workflow schema is unchanged and remains the local validator, as described in [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Provider counting includes the same converted schemas used for generation.

Refusals, incomplete replies, unsupported content and empty final answers fail explicitly. Anthropic accepts only consistent `end_turn` or `tool_use` completions. Tool-only replies may have empty text; each call must name a supplied function and contain a JSON argument object. Anthropic tool IDs become both `id` and `call_id`; native blocks remain intact for replay. Transport failures are not retried. `runModelConversation` handles replay and sequential invocation of caller-owned tools; callers using `generate` directly manage their own continuation. Streaming remains outside this adapter.

Prompts, conversation identity and lifetime, capacity configuration, semantic validation and revision policy belong to workflows such as [semantic-split](../semantic-split/README.md) and [intentions](../intentions/README.md). Evidence packing belongs to context-engine; environment loading, telemetry export and persistence belong to applications. Offline conversation tests cover replay, ordering, cancellation, capacity failures and original callback/provider errors. See the [workspace architecture](../../docs/architecture.md) and [LLM ownership decision](../../docs/adr/0004-shared-llm-package.md).

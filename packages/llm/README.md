# LLM

`@daphne/llm` is Daphne's shared model-access package. It sends requests, validates provider responses, counts input tokens, continues model/tool conversations and normalizes reported token usage. Its current implementation uses the OpenAI Responses API; semantic-split and intentions reuse it through public exports.

The package has no runtime package or workspace dependencies. It uses Node's native `fetch` and `AbortSignal` for HTTP, caller cancellation and request deadlines. Workflows supply prompts, schemas, conversation state, capacity limits, recording callbacks and tool executors. The package manages the continuation protocol over that state; evidence, acceptance policy, environment loading, telemetry and artifacts remain with callers.

## Main APIs

`createOpenAI(apiKey, model, signal, onModelCall?)` creates a client with explicit credentials, model and cancellation. The factory itself makes no request.

| API                                      | Purpose                                                                                                                                                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `count(request): Promise<number>`        | Count the complete supplied input through `POST /v1/responses/input_tokens`, including instructions, message structure and any response schema. Returns a nonnegative safe integer.                                      |
| `generate(request): Promise<ModelReply>` | Call `POST /v1/responses`, validate a completed response, and return answer text or function calls, replayable output items and raw response JSON.                                                                       |
| `calls`                                  | Mutable counters for attempted `count` and `generate` requests, including failures. Read them for reporting; callers must not modify them.                                                                               |
| `normalizeModelUsage(response)`          | Parse usage from raw response JSON without making a request. Return `TokenUsage` when present and `null` when absent; throw an `Error` for malformed counts, inconsistent totals or breakdowns larger than their totals. |

Counting and generation are separate operations. `generate` does not count first or enforce an input budget: the workflow decides whether to split, stop or generate. A count can be reused only while the model and complete request remain unchanged. OpenAI documents this preflight approach in [Counting tokens](https://developers.openai.com/api/docs/guides/token-counting) and the [input-token endpoint reference](https://developers.openai.com/api/reference/typescript/resources/responses/subresources/input_tokens/methods/count).

For example, with `apiKey`, `modelName`, `signal` and `maxInputTokens` supplied by the application:

```ts
import { createOpenAI } from '@daphne/llm';

const model = createOpenAI(apiKey, modelName, signal);
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

`runModelConversation(conversation, options)` continues one caller-owned history until a terminal reply. `ModelConversation` contains only `history` and the set of previously seen `callIds`. `ModelConversationOptions<Turn>` borrows an existing client and signal, request settings without `input`, positive validated `maxInputTokens`/`maxRequestBytes` capacities, and two callbacks:

- `recordTurn(reply, inputTokens): Turn` synchronously retains each completed reply and returns its exact reference. It can also confirm domain-specific delivery. Recording failures propagate; this callback is required work, unlike the optional model-call observer.
- `executeTool(call, turn): Promise<string>` executes a requested tool using that retained turn for any diagnostic records, then returns serialized output. The executor and client must honor the supplied signal. Failures propagate unchanged.

For example, with an existing client and domain callbacks:

```ts
import { runModelConversation } from '@daphne/llm';

const conversation = {
  history: [{ role: 'user', content: 'Investigate this change.' }],
  callIds: new Set<string>(),
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

The helper checks serialized request size, counts the complete request on every turn, generates, records the reply, and appends all provider output before executing tools sequentially. It rejects reused call IDs within the same conversation. Tool results are appended as native `function_call_output` items. The supplied history and call-ID set are updated in place and can be reused after the caller appends repair feedback; use separate state for separate conversations.

Completed terminal turns are returned even if cancellation arrived with generation, allowing an outer evaluator to retain the candidate and reject acceptance. Aborted tool-request turns are recorded but start no tools. Completed replies/tool outputs remain available after later failure. The helper adds no timeout, call quota, retry, candidate counting or domain validation. Intentions wraps it with evidence delivery and writer/reviewer records; semantic split retains its direct generation path and reuse of the unchanged initial token count.

- `ModelRequest`: instructions, string or message-array input, an optional strict JSON response schema, native function definitions, parallel-call settings and an output-token cap. The workflow owns the schema and validates its domain rules after generation; see [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
- `ModelReply`: extracted answer `text`, validated reasoning/assistant/function-call `output` items, optional `functionCalls`, and the raw `response`. Commentary is excluded from answer text but retained in output. For subsequent turns, replay complete output items rather than reconstructing history from text; see [Conversation state](https://developers.openai.com/api/docs/guides/conversation-state).
- `ModelCallObservation`: call kind, per-kind sequence number, timing, outcome and raw response JSON. Its model name uses the provider's returned name when available, otherwise the requested name. Requests and credentials are excluded. The synchronous callback runs after every attempted request, including response-validation failures; observer exceptions cannot replace the call's outcome.
- `TokenUsage`: inclusive `inputTokens` and `outputTokens`, plus nullable `cachedInputTokens` and `reasoningOutputTokens` breakdowns. Missing breakdowns remain unknown, not zero. These fields come from the generation response's [usage object](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), not from a preflight count.
- `ModelError`: transport, cancellation, timeout or provider-response validation failure. HTTP failures expose the status without returning the provider's error body.

Usage parsing is intentionally separate from generation validation. A successful reply can have unavailable or malformed usage; reporting callers catch normalization errors without changing that reply's outcome. Failed generation observations can still contain usage that should be recorded. The eval app owns Langfuse recording, non-overlapping token buckets and reporting issues.

## Main flow and limits

1. The workflow supplies a request and optionally counts it before deciding whether to generate.
2. The adapter records the attempt, sends it with authorization and a 120-second deadline, then validates the count or completed response.
3. The observer receives timing, status and any parsed response JSON. The workflow decides what to retain and whether another turn is needed.

Both operations use low reasoning effort. Generation uses `store: false` and defaults to a 4,096-token output ceiling, including reasoning tokens; callers may set `max_output_tokens`. Counting omits this output cap. These are current adapter settings, not provider requirements; see the [Responses API reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create). Refusals, incomplete replies, unsupported output items and empty final answers fail explicitly. Transport failures are not retried. The adapter supports text, structured text and native function-call responses. Tool-only replies may have empty text. Each call must name a supplied function and contain a JSON argument object; its output `id` and `call_id` are preserved. Tool requests include encrypted reasoning for replay. `runModelConversation` handles replay and sequential invocation of caller-owned tools; callers using `generate` directly manage their own continuation. Streaming remains outside this adapter.

Prompts, conversation identity and lifetime, capacity configuration, semantic validation and revision policy belong to workflows such as [semantic-split](../semantic-split/README.md) and [intentions](../intentions/README.md). Evidence packing belongs to context-engine; environment loading, telemetry export and persistence belong to applications. Offline conversation tests cover replay, ordering, cancellation, capacity failures and original callback/provider errors. See the [workspace architecture](../../docs/architecture.md) and [LLM ownership decision](../../docs/adr/0004-shared-llm-package.md).

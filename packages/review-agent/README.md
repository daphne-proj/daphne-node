# Review agent

`@daphne/review-agent` owns model transport and provider-response validation. Its current implementation is a concrete OpenAI Responses adapter used by semantic-split. Callers supply instructions, input, credentials, model and cancellation; domain workflows decide what to ask, which history to retain and when to correct a reply.

## Main APIs

`createOpenAI(apiKey, model, signal, onModelCall?)` returns:

| Member              | Purpose                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `count(request)`    | Count the complete supplied input through the provider's input-token endpoint.                       |
| `generate(request)` | Generate and validate a reply, returning answer text, replayable output items and raw response JSON. |
| `calls`             | Track attempted count and generation requests, including failed calls.                               |

The optional observation callback reports each attempted call for host-owned telemetry. Observer failures cannot replace the provider outcome.

## Main types

- `ModelRequest`: instructions, string or message-array input, and an optional strict JSON response schema.
- `ModelReply`: extracted answer text, validated reasoning/assistant items for replay, and the provider response.
- `ModelCallObservation`: call kind, sequence number, timing, status, model and response JSON; it excludes requests and credentials.
- `ModelError`: provider, transport, cancellation or response-validation failure.

## How it works

1. Count the attempt, serialize the caller's request and send it with explicit authorization, cancellation and a 120-second request deadline.
2. Validate token-count responses or completed generation output. Extract answer text while preserving full accepted output items, including commentary and metadata, for replay.
3. Notify the optional observer on success or failure. Transport failures are not retried.

Native `fetch` calls the OpenAI Responses and input-token APIs; `AbortSignal` combines caller cancellation with request deadlines. There are no runtime package or workspace dependencies. Prompts, context packing, grouping validation, environment loading and persistence stay outside this adapter.

Generation uses `store: false` and a 4,096-token output ceiling. Commentary is retained for replay but excluded from answer text. Provider validation checks response structure, not whether the answer satisfies the caller's domain rules.

See the [adapter and contracts](src/openai.ts), [semantic-split overview](../semantic-split/README.md) and [architecture](../../docs/architecture.md).

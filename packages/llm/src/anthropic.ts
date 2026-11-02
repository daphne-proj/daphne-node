import type {
  ModelCallObservation,
  ModelClient,
  ModelRequest,
} from './contracts.js';
import { decodeAnthropicResponse } from './anthropic-response.js';
import { anthropicSchema } from './anthropic-schema.js';
import { ModelError } from './response.js';
import {
  createTransport,
  inputTokenCount,
  outputTokenLimit,
} from './transport.js';

/* Group adjacent canonical tool results into one native user turn for parallel calls. */
function messages(input: ModelRequest['input']): Record<string, unknown>[] {
  if (typeof input === 'string') {
    return [{ role: 'user', content: input }];
  }

  const result: Record<string, unknown>[] = [];
  let toolResults: Record<string, unknown>[] = [];

  function flushResults() {
    if (toolResults.length > 0) {
      result.push({ role: 'user', content: toolResults });
      toolResults = [];
    }
  }

  for (const item of input) {
    if (item.type === 'function_call_output') {
      if (
        typeof item.call_id !== 'string' ||
        !item.call_id.trim() ||
        typeof item.output !== 'string'
      ) {
        throw new ModelError(
          'Anthropic requires a tool call ID and serialized result.',
        );
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: item.call_id,
        content: item.output,
      });
      continue;
    }

    flushResults();

    if (
      (item.role !== 'user' && item.role !== 'assistant') ||
      (typeof item.content !== 'string' && !Array.isArray(item.content))
    ) {
      throw new ModelError(
        'Anthropic requires native user or assistant history messages.',
      );
    }

    /* The initial user message stays stable when a proposal or tool results follow. */
    if (
      result.length === 0 &&
      item.role === 'user' &&
      typeof item.content === 'string'
    ) {
      result.push({
        ...item,
        content: [
          {
            type: 'text',
            text: item.content,
            cache_control: { type: 'ephemeral' },
          },
        ],
      });
    } else {
      result.push(item);
    }
  }

  flushResults();
  return result;
}

/*
 * Counting and generation share the same prompt, tools, settings and cache policy.
 * Conversation history caches its initial message and growing tail; scalar
 * one-shot inputs do not opt in. Native replay blocks remain unchanged.
 */
function requestBody(request: ModelRequest): Record<string, unknown> {
  return {
    ...(typeof request.input === 'string'
      ? {}
      : { cache_control: { type: 'ephemeral' } }),
    system: request.instructions,
    messages: messages(request.input),
    output_config: {
      ...(request.text
        ? {
            format: {
              type: 'json_schema',
              schema: anthropicSchema(request.text.format.schema),
            },
          }
        : {}),
    },
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            strict: tool.strict,
            input_schema: anthropicSchema(tool.parameters),
          })),
          tool_choice: {
            type: 'auto',
            ...(request.parallel_tool_calls === undefined
              ? {}
              : {
                  disable_parallel_tool_use: !request.parallel_tool_calls,
                }),
          },
        }
      : {}),
  };
}

/* Native Claude messages retain default thinking; no retry or domain policy is added. */
export function createAnthropic(
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onModelCall?: (event: ModelCallObservation) => void,
): ModelClient {
  const { calls, observe } = createTransport(
    'anthropic',
    apiKey,
    model,
    signal,
    onModelCall,
  );

  return {
    calls,
    async count(request) {
      return observe(
        'count',
        '/count_tokens',
        requestBody(request),
        (response) => inputTokenCount(response, 'Anthropic'),
      );
    },
    async generate(request) {
      const maxTokens = outputTokenLimit(request.max_output_tokens);

      return observe(
        'generate',
        '',
        { ...requestBody(request), max_tokens: maxTokens },
        (response) => decodeAnthropicResponse(response, request.tools ?? []),
      );
    },
  };
}

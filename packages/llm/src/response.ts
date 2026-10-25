import type {
  ModelFunctionCall,
  ModelFunctionTool,
  ModelReply,
} from './openai.js';

export class ModelError extends Error {
  override readonly name = 'ModelError';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new ModelError('OpenAI returned an invalid response.');
  }

  return value;
}

function functionCall(
  item: Record<string, unknown>,
  tools: readonly ModelFunctionTool[],
): ModelFunctionCall {
  if (
    typeof item.id !== 'string' ||
    !item.id ||
    typeof item.call_id !== 'string' ||
    !item.call_id ||
    typeof item.name !== 'string' ||
    !tools.some((tool) => tool.name === item.name) ||
    typeof item.arguments !== 'string' ||
    (item.status !== undefined && item.status !== 'completed')
  ) {
    throw new ModelError(
      'OpenAI returned an invalid or unrequested function call.',
    );
  }

  try {
    object(JSON.parse(item.arguments));
  } catch {
    throw new ModelError(
      'OpenAI returned function arguments that are not a JSON object.',
    );
  }

  return {
    id: item.id,
    call_id: item.call_id,
    name: item.name,
    arguments: item.arguments,
  };
}

export function decodeResponse(
  response: Record<string, unknown>,
  tools: readonly ModelFunctionTool[],
): ModelReply {
  if (response.status !== 'completed' || !Array.isArray(response.output)) {
    throw new ModelError('OpenAI did not complete the response.');
  }

  const output = response.output.map(object);
  const texts: string[] = [];
  const functionCalls: ModelFunctionCall[] = [];
  const ids = new Set<string>();
  const callIds = new Set<string>();

  for (const item of output) {
    if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) {
      throw new ModelError('OpenAI returned a missing or repeated output ID.');
    }

    ids.add(item.id);

    if (item.type === 'reasoning') {
      if (
        !Array.isArray(item.summary) ||
        !item.summary.every(
          (part: unknown) =>
            isObject(part) &&
            part.type === 'summary_text' &&
            typeof part.text === 'string',
        ) ||
        (item.status !== undefined && item.status !== 'completed') ||
        (item.encrypted_content !== undefined &&
          item.encrypted_content !== null &&
          typeof item.encrypted_content !== 'string')
      ) {
        throw new ModelError('LLM returned invalid reasoning output.');
      }

      continue;
    }

    if (item.type === 'function_call') {
      const call = functionCall(item, tools);

      if (callIds.has(call.call_id)) {
        throw new ModelError('OpenAI returned a repeated function call ID.');
      }

      callIds.add(call.call_id);
      functionCalls.push(call);
      continue;
    }

    if (
      item.type !== 'message' ||
      item.role !== 'assistant' ||
      item.status !== 'completed' ||
      !Array.isArray(item.content)
    ) {
      throw new ModelError('LLM returned unexpected output.');
    }

    for (const part of item.content) {
      const content = object(part);

      if (content.type !== 'output_text' || typeof content.text !== 'string') {
        throw new ModelError(
          'OpenAI refused the request or returned unexpected content.',
        );
      }

      /* Commentary stays in replay history, but is not part of the answer. */
      if (item.phase !== 'commentary') {
        texts.push(content.text);
      }
    }
  }

  const text = texts.join('');

  /* A tool turn has work to do; a final answer still requires nonempty text. */
  if (!text.trim() && functionCalls.length === 0) {
    throw new ModelError('OpenAI returned no answer text.');
  }

  /* Replay all items, including reasoning, and pair tool results with call_id. */
  if (functionCalls.length > 0) {
    return { text, output, response, functionCalls };
  }

  return { text, output, response };
}

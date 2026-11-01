import type {
  ModelFunctionCall,
  ModelFunctionTool,
  ModelReply,
} from './contracts.js';
import { isObject, ModelError, object } from './response.js';

/*
 * Validate the whole native message before exposing tool calls. Replay every
 * content block unchanged: thinking signatures and redacted data are opaque
 * continuity tokens, including when the visible thinking string is empty.
 */
export function decodeAnthropicResponse(
  response: Record<string, unknown>,
  tools?: readonly ModelFunctionTool[],
): ModelReply {
  if (
    response.type !== 'message' ||
    response.role !== 'assistant' ||
    typeof response.id !== 'string' ||
    !response.id.trim() ||
    !Array.isArray(response.content) ||
    (response.stop_reason !== 'end_turn' &&
      response.stop_reason !== 'tool_use') ||
    (response.stop_details !== undefined && response.stop_details !== null) ||
    (response.status !== undefined && response.status !== 'completed') ||
    (response.stop_sequence !== undefined && response.stop_sequence !== null)
  ) {
    throw new ModelError(
      'Anthropic refused the request or did not complete the response.',
    );
  }

  const content = response.content.map((block: unknown) =>
    object(block, 'Anthropic'),
  );
  const texts: string[] = [];
  const functionCalls: ModelFunctionCall[] = [];
  const ids = new Set<string>();

  for (const block of content) {
    switch (block.type) {
      case 'text': {
        if (typeof block.text !== 'string') {
          throw new ModelError('Anthropic returned invalid text.');
        }

        texts.push(block.text);
        break;
      }
      case 'thinking': {
        if (
          typeof block.thinking !== 'string' ||
          typeof block.signature !== 'string' ||
          !block.signature.trim()
        ) {
          throw new ModelError('Anthropic returned invalid thinking output.');
        }

        break;
      }
      case 'redacted_thinking': {
        if (typeof block.data !== 'string' || !block.data.trim()) {
          throw new ModelError(
            'Anthropic returned invalid redacted thinking output.',
          );
        }

        break;
      }
      case 'tool_use': {
        if (
          typeof block.id !== 'string' ||
          !block.id.trim() ||
          ids.has(block.id) ||
          typeof block.name !== 'string' ||
          !block.name.trim() ||
          (tools !== undefined &&
            !tools.some((tool) => tool.name === block.name)) ||
          !isObject(block.input)
        ) {
          throw new ModelError(
            'Anthropic returned an invalid or unrequested tool call.',
          );
        }

        ids.add(block.id);
        functionCalls.push({
          id: block.id,
          call_id: block.id,
          name: block.name,
          arguments: JSON.stringify(block.input),
        });
        break;
      }
      default: {
        throw new ModelError(
          'Anthropic refused the request or returned unexpected content.',
        );
      }
    }
  }

  const text = texts.join('');

  const hasToolCalls = functionCalls.length > 0;

  if ((response.stop_reason === 'tool_use') !== hasToolCalls) {
    throw new ModelError(
      'Anthropic returned inconsistent tool-call completion.',
    );
  }

  if (!text.trim() && functionCalls.length === 0) {
    throw new ModelError('Anthropic returned no answer text.');
  }

  const output = [{ role: 'assistant', content }];

  return functionCalls.length > 0
    ? { text, output, response, functionCalls }
    : { text, output, response };
}

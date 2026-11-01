import type {
  ModelCallObservation,
  ModelClient,
  ModelRequest,
} from './contracts.js';
import { decodeResponse } from './response.js';
import {
  createTransport,
  inputTokenCount,
  outputTokenLimit,
} from './transport.js';

export { ModelError } from './response.js';
export type {
  ModelCallObservation,
  ModelFunctionCall,
  ModelFunctionTool,
  ModelReply,
  ModelRequest,
} from './contracts.js';

/* Keep the original factory available; createModel selects this same adapter. */
export function createOpenAI(
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onModelCall?: (event: ModelCallObservation) => void,
): ModelClient {
  const { calls, observe } = createTransport(
    'openai',
    apiKey,
    model,
    signal,
    onModelCall,
  );

  return {
    calls,
    async count(request: ModelRequest): Promise<number> {
      const input = { ...request };
      delete input.max_output_tokens;

      return observe(
        'count',
        '/input_tokens',
        { reasoning: { effort: 'low' }, ...input },
        (response) => inputTokenCount(response, 'OpenAI'),
      );
    },
    async generate(request: ModelRequest) {
      const maxOutputTokens = outputTokenLimit(request.max_output_tokens);

      return observe(
        'generate',
        '',
        {
          reasoning: { effort: 'low' },
          ...request,
          store: false,
          max_output_tokens: maxOutputTokens,
          ...(request.tools?.length
            ? { include: ['reasoning.encrypted_content'] }
            : {}),
        },
        (response) => decodeResponse(response, request.tools ?? []),
      );
    },
  };
}

import { decodeResponse, ModelError, object } from './response.js';

export { ModelError } from './response.js';

export interface ModelFunctionTool {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: object;
}

export interface ModelFunctionCall {
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

export interface ModelRequest {
  tools?: readonly ModelFunctionTool[];
  parallel_tool_calls?: boolean;
  max_output_tokens?: number;
  instructions: string;
  input: string | readonly Record<string, unknown>[];
  text?: {
    format: { type: 'json_schema'; name: string; strict: true; schema: object };
  };
}

export interface ModelReply {
  functionCalls?: readonly ModelFunctionCall[];
  text: string;
  output: readonly Record<string, unknown>[];
  response: Record<string, unknown>;
}

/* Observations contain response JSON only; never authentication or request data. */
export interface ModelCallObservation {
  kind: 'count' | 'generate';
  number: number;
  /* Prefer the provider's resolved model name, falling back to the requested model. */
  model: string;
  startedAt: Date;
  endedAt: Date;
  elapsedMs: number;
  status: 'complete' | 'failed';
  response: Record<string, unknown> | null;
}

/* Validate provider JSON here and preserve accepted output items for local replay. */
export function createOpenAI(
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onModelCall?: (event: ModelCallObservation) => void,
) {
  const calls = { count: 0, generate: 0 };

  async function post(path: string, body: object) {
    try {
      const response = await fetch(
        'https://api.openai.com/v1/responses' + path,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            reasoning: { effort: 'low' },
            ...body,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
          redirect: 'error',
        },
      );

      if (!response.ok) {
        await response.body?.cancel();
        throw new ModelError(
          `OpenAI request failed (HTTP ${String(response.status)}).`,
        );
      }

      return object(await response.json());
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      throw new ModelError(
        'OpenAI request failed, timed out or was cancelled.',
        { cause: error },
      );
    }
  }

  async function observe<T>(
    kind: ModelCallObservation['kind'],
    path: string,
    body: object,
    decode: (response: Record<string, unknown>) => T,
  ): Promise<T> {
    const number = ++calls[kind];
    const startedAt = new Date();
    const started = performance.now();
    let response: Record<string, unknown> | null = null;
    let status: ModelCallObservation['status'] = 'failed';

    try {
      response = await post(path, body);
      const result = decode(response);
      status = 'complete';
      return result;
    } finally {
      try {
        const responseModel = response?.model;
        const observedModel =
          typeof responseModel === 'string' && responseModel.trim()
            ? responseModel
            : model;

        onModelCall?.({
          kind,
          number,
          model: observedModel,
          startedAt,
          endedAt: new Date(),
          elapsedMs: performance.now() - started,
          status,
          response,
        });
      } catch {
        /* Observers cannot change provider outcomes; hosts check missing events. */
      }
    }
  }

  return {
    calls,
    async count(request: ModelRequest): Promise<number> {
      const input = { ...request };
      delete input.max_output_tokens;

      return observe('count', '/input_tokens', input, (response) => {
        const count = response.input_tokens;

        if (
          typeof count !== 'number' ||
          !Number.isSafeInteger(count) ||
          count < 0
        ) {
          throw new ModelError('OpenAI returned an invalid input token count.');
        }

        return count;
      });
    },
    async generate(request: ModelRequest): Promise<ModelReply> {
      const maxOutputTokens = request.max_output_tokens ?? 4096;

      if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens <= 0) {
        throw new ModelError(
          'Output token limit must be a positive safe integer.',
        );
      }

      return observe(
        'generate',
        '',
        {
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

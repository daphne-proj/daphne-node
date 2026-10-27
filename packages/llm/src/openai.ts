export class ModelError extends Error {
  override readonly name = 'ModelError';
}

export interface ModelRequest {
  instructions: string;
  input: string | readonly Record<string, unknown>[];
  text?: {
    format: { type: 'json_schema'; name: string; strict: true; schema: object };
  };
}

export interface ModelReply {
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isObject(value)) {
    throw new ModelError('OpenAI returned an invalid response.');
  }

  return value;
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
      return observe('count', '/input_tokens', request, (response) => {
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
      return observe(
        'generate',
        '',
        {
          ...request,
          store: false,
          max_output_tokens: 4096,
        },
        (response) => {
          if (
            response.status !== 'completed' ||
            !Array.isArray(response.output)
          ) {
            throw new ModelError('OpenAI did not complete the response.');
          }

          const output = response.output.map(object);
          const texts: string[] = [];

          for (const item of output) {
            if (typeof item.id !== 'string' || !item.id) {
              throw new ModelError(
                'LLM returned an output item without an ID.',
              );
            }

            if (item.type === 'reasoning') {
              if (
                !Array.isArray(item.summary) ||
                !item.summary.every(
                  (part: unknown) =>
                    isObject(part) &&
                    part.type === 'summary_text' &&
                    typeof part.text === 'string',
                ) ||
                (item.status !== undefined && item.status !== 'completed')
              ) {
                throw new ModelError('LLM returned invalid reasoning output.');
              }

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

              if (
                content.type !== 'output_text' ||
                typeof content.text !== 'string'
              ) {
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

          if (!text.trim()) {
            throw new ModelError('OpenAI returned no answer text.');
          }

          return { text, output, response };
        },
      );
    },
  };
}

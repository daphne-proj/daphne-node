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

  return {
    calls,
    async count(request: ModelRequest): Promise<number> {
      calls.count += 1;
      const response = await post('/input_tokens', request);
      const count = response.input_tokens;

      if (
        typeof count !== 'number' ||
        !Number.isSafeInteger(count) ||
        count < 0
      ) {
        throw new ModelError('OpenAI returned an invalid input token count.');
      }

      return count;
    },
    async generate(request: ModelRequest): Promise<ModelReply> {
      calls.generate += 1;
      const response = await post('', {
        ...request,
        store: false,
        max_output_tokens: 4096,
      });

      if (response.status !== 'completed' || !Array.isArray(response.output)) {
        throw new ModelError('OpenAI did not complete the response.');
      }

      const output = response.output.map(object);
      const texts: string[] = [];

      for (const item of output) {
        if (typeof item.id !== 'string' || !item.id) {
          throw new ModelError('LLM returned an output item without an ID.');
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

          texts.push(content.text);
        }
      }

      const text = texts.join('');

      if (!text.trim()) {
        throw new ModelError('OpenAI returned no answer text.');
      }

      return { text, output, response };
    },
  };
}

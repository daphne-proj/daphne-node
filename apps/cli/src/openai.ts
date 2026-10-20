export class ModelError extends Error {
  override readonly name = 'ModelError';
}

export interface ModelRequest {
  instructions: string;
  input: string;
  text?: {
    format: { type: 'json_schema'; name: string; strict: true; schema: object };
  };
}

export interface ModelReply {
  text: string;
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

/* Keep provider JSON validation here; callers work with counts and text. */
export function createOpenAI(
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
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
    async count(request: ModelRequest): Promise<number> {
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
      const response = await post('', {
        ...request,
        store: false,
        max_output_tokens: 4096,
      });

      if (response.status !== 'completed' || !Array.isArray(response.output)) {
        throw new ModelError('OpenAI did not complete the response.');
      }

      const texts: string[] = [];

      for (const item of response.output) {
        const output = object(item);

        if (output.type === 'reasoning') {
          continue;
        }

        if (output.type !== 'message' || !Array.isArray(output.content)) {
          throw new ModelError('OpenAI returned unexpected output.');
        }

        for (const item of output.content) {
          const content = object(item);

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

      return { text, response };
    },
  };
}

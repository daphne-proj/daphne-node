import type { ModelCallObservation, ModelProvider } from './contracts.js';
import { ModelError, isObject, object } from './response.js';

/* Share deadlines, observations and failure accounting across both HTTP adapters. */
export function createTransport(
  provider: ModelProvider,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onModelCall?: (event: ModelCallObservation) => void,
) {
  const calls = { count: 0, generate: 0 };
  const label = provider === 'openai' ? 'OpenAI' : 'Anthropic';
  const baseUrl =
    provider === 'openai'
      ? 'https://api.openai.com/v1/responses'
      : 'https://api.anthropic.com/v1/messages';

  async function post(path: string, body: object) {
    try {
      const response = await fetch(baseUrl + path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...(provider === 'anthropic'
            ? { 'anthropic-version': '2026-10-21' }
            : {}),
        },
        body: JSON.stringify({ model, ...body }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        redirect: 'error',
      });

      if (!response.ok) {
        let detail = '';

        try {
          const body: unknown = await response.json();

          if (
            isObject(body) &&
            isObject(body.error) &&
            typeof body.error.message === 'string'
          ) {
            detail = ': ' + body.error.message.slice(0, 1000);
          }
        } catch {
          /* Preserve the HTTP failure when the server body is not readable JSON. */
        }

        throw new ModelError(
          `${label} request failed (HTTP ${String(response.status)})${detail}.`,
        );
      }

      return object(await response.json(), label);
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      throw new ModelError(
        `${label} request failed, timed out or was cancelled.`,
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
          provider,
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

  return { calls, observe };
}

export function inputTokenCount(
  response: Record<string, unknown>,
  label: string,
): number {
  const count = response.input_tokens;

  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
    throw new ModelError(`${label} returned an invalid input token count.`);
  }

  return count;
}

export function outputTokenLimit(requested: number | undefined): number {
  const limit = requested ?? 4096;

  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new ModelError('Output token limit must be a positive safe integer.');
  }

  return limit;
}

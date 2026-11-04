import { createAnthropic } from './anthropic.js';
import { createCodex } from './codex.js';
import { decodeAnthropicResponse } from './anthropic-response.js';
import type {
  ModelCallObservation,
  ModelClient,
  ModelFunctionTool,
  ModelProvider,
  ModelReply,
} from './contracts.js';
import { createOpenAI } from './openai.js';
import { decodeResponse } from './response.js';

/*
 * Select a provider synchronously, for example createModel('anthropic', key,
 * modelName, signal). The returned client owns provider deadlines and decoding;
 * Codex uses CLI sign-in and ignores apiKey. Callers own conversation lifetime
 * and schema/domain validation; API callers also supply their credentials.
 */
export function createModel(
  provider: ModelProvider,
  apiKey: string,
  model: string,
  signal: AbortSignal,
  onModelCall?: (event: ModelCallObservation) => void,
): ModelClient {
  switch (provider) {
    case 'openai':
      return createOpenAI(apiKey, model, signal, onModelCall);
    case 'anthropic':
      return createAnthropic(apiKey, model, signal, onModelCall);
    case 'codex':
      return createCodex(model, signal, onModelCall);
  }
}

/* Validate saved raw replies; omitted tools checks structure, supplied tools also restrict names. */
export function decodeModelReply(
  provider: ModelProvider,
  response: Record<string, unknown>,
  tools?: readonly ModelFunctionTool[],
): ModelReply {
  switch (provider) {
    case 'openai':
    case 'codex':
      return decodeResponse(response, tools);
    case 'anthropic':
      return decodeAnthropicResponse(response, tools);
  }
}

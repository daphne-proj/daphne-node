import { createAnthropic } from './anthropic.js';
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
 * modelName, signal). The returned client owns HTTP deadlines and decoding;
 * callers own credentials, conversation lifetime and schema/domain validation.
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
      return decodeResponse(response, tools);
    case 'anthropic':
      return decodeAnthropicResponse(response, tools);
  }
}

import type { ModelProvider } from './contracts.js';
import { ModelError } from './response.js';

/* Manually maintained latest defaults; selecting a provider performs no model discovery. */
export const defaultModels = {
  openai: 'gpt-6.1-sol',
  anthropic: 'claude-opus-5-5',
} as const satisfies Record<ModelProvider, string>;

/* Validate CLI/environment provider names once before selecting credentials or HTTP. */
export function parseModelProvider(value = 'openai'): ModelProvider {
  if (value !== 'openai' && value !== 'anthropic') {
    throw new ModelError('Model provider must be "openai" or "anthropic".');
  }

  return value;
}

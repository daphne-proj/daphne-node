import type { ModelProvider, OpenAIReasoningEffort } from './contracts.js';
import { ModelError } from './response.js';

/* Manually maintained latest defaults; selecting a provider performs no model discovery. */
export const defaultModels = {
  openai: 'gpt-6.1-sol',
  anthropic: 'claude-opus-5-5',
  codex: 'gpt-6.1-sol',
} as const satisfies Record<ModelProvider, string>;

/* Validate CLI/environment provider names once before selecting credentials or HTTP. */
export function parseModelProvider(value = 'openai'): ModelProvider {
  if (value !== 'openai' && value !== 'anthropic' && value !== 'codex') {
    throw new ModelError(
      'Model provider must be "openai", "anthropic" or "codex".',
    );
  }

  return value;
}

/* Validate CLI/environment effort before I/O; model-specific support remains with OpenAI. */
export function parseOpenAIReasoningEffort(
  value = 'medium',
): OpenAIReasoningEffort {
  switch (value) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
    case 'max':
      return value;
    default:
      throw new ModelError(
        'OpenAI reasoning effort must be none, minimal, low, medium, high, xhigh or max.',
      );
  }
}

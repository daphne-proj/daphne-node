import type {
  ModelCallObservation,
  ModelProvider,
  TokenUsage,
} from '@daphne/llm';

/* Standard direct-API USD rates per million tokens, verified on 2026-11-01. */
export const modelPricing = {
  asOf: '2026-11-01',
  openai: 'https://developers.openai.com/api/docs/models/gpt-6.1-sol',
  anthropic: 'https://platform.claude.com/docs/en/about-claude/pricing',
  codex: 'https://learn.chatgpt.com/docs/pricing',
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/*
 * Price recorded generation usage for the selected model, including reasoning
 * output and cache reads/writes. summarizeIntentionRun calls this per request;
 * null means the rates or billing breakdown are unknown, never a free request.
 * These are list-price estimates, not invoices or subscription-credit charges.
 */
export function estimateModelCost(
  call: ModelCallObservation,
  provider: ModelProvider,
  model: string,
  usage: TokenUsage,
): number | null {
  if (provider === 'codex') {
    return null;
  }

  const native = record(call.response?.usage);
  const details = record(native?.input_tokens_details);
  const reads = usage.cachedInputTokens;
  const writes =
    provider === 'openai'
      ? count(details?.cache_write_tokens)
      : usage.cacheCreationInputTokens;

  if (reads === null || writes == null || reads + writes > usage.inputTokens) {
    return null;
  }

  const uncached = usage.inputTokens - reads - writes;

  if (provider === 'openai' && model === 'gpt-6.1-sol') {
    const tier = call.response?.service_tier;
    let multiplier = 1;

    if (tier === 'fast' || tier === 'priority') {
      multiplier = 2;
    } else if (tier === 'ultrafast') {
      multiplier = 6;
    } else if (tier === 'flex' || tier === 'batch') {
      multiplier = 0.5;
    } else if (
      tier !== undefined &&
      tier !== 'default' &&
      tier !== 'standard' &&
      tier !== 'auto'
    ) {
      return null;
    }

    const retention = record(call.response?.prompt_cache_options)?.ttl;

    if (
      writes > 0 &&
      retention !== undefined &&
      retention !== '30m' &&
      retention !== '12h'
    ) {
      return null;
    }

    const long = usage.inputTokens > 272_000;
    const input = long ? 2 : 1;
    const output = long ? 1.5 : 1;
    const writeRate = retention === '12h' ? 5 : 2.5;

    return (
      (multiplier *
        (input * (uncached * 2 + reads * 0.1 + writes * writeRate) +
          usage.outputTokens * 10 * output)) /
      1_000_000
    );
  }

  if (provider === 'anthropic' && model === 'claude-opus-5-5') {
    const creation = record(native?.cache_creation);
    const hourWrites =
      creation === null ? 0 : count(creation.ephemeral_1h_input_tokens);

    if (hourWrites === null || hourWrites > writes) {
      return null;
    }

    return (
      (uncached * 4 +
        reads * 0.2 +
        (writes - hourWrites) * 5 +
        hourWrites * 8 +
        usage.outputTokens * 20) /
      1_000_000
    );
  }

  return null;
}

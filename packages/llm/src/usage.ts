/* Inclusive provider totals; missing cached-input and reasoning-output breakdowns remain unknown. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number | null;
  reasoningOutputTokens: number | null;
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field}: expected an object.`);
  }

  return Object.fromEntries(Object.entries(value));
}

function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field}: expected a nonnegative safe integer.`);
  }

  return value;
}

function detail(value: unknown, key: string, total: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const count = object(value, 'usage detail')[key];

  if (count === undefined || count === null) {
    return null;
  }

  const tokens = integer(count, key);

  if (tokens > total) {
    throw new Error('Provider token detail exceeds its total.');
  }

  return tokens;
}

/* Parse provider usage independently so missing or malformed accounting cannot invalidate a completed generation. */
export function normalizeModelUsage(
  response: Record<string, unknown> | null,
): TokenUsage | null {
  if (response?.usage === undefined || response.usage === null) {
    return null;
  }

  const usage = object(response.usage, 'usage');
  const inputTokens = integer(usage.input_tokens, 'input_tokens');
  const outputTokens = integer(usage.output_tokens, 'output_tokens');
  const total = integer(inputTokens + outputTokens, 'total_tokens');

  if (
    usage.total_tokens !== undefined &&
    integer(usage.total_tokens, 'total_tokens') !== total
  ) {
    throw new Error('Provider token totals disagree.');
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: detail(
      usage.input_tokens_details,
      'cached_tokens',
      inputTokens,
    ),
    reasoningOutputTokens: detail(
      usage.output_tokens_details,
      'reasoning_tokens',
      outputTokens,
    ),
  };
}

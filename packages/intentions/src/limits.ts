/* Application guardrails, independent of the selected model's advertised capacity. */
export const intentionsLimits = Object.freeze({
  maxOutputTokens: 16_384,
  maxGenerations: 24,
  maxToolCalls: 24,
  maxCorrections: 1,
  maxContextBytes: 8_388_608,
  maxRetainedBytes: 33_554_432,
  maxRequestBytes: 8_388_608,
});

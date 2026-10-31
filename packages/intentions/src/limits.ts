/* Request and memory capacities; the shared run budget owns overall effort. */
export const intentionsLimits = Object.freeze({
  maxOutputTokens: 16_384,
  maxContextBytes: 8_388_608,
  maxRetainedBytes: 33_554_432,
  maxRequestBytes: 8_388_608,
});

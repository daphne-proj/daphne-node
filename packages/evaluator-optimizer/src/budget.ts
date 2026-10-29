import type { RunBudget, RunBudgetPolicy } from './contracts.js';

/* Create once before preparation; invalid limits throw and later policy edits have no effect. */
export function createRunBudget(
  policy: RunBudgetPolicy,
  signal: AbortSignal,
): RunBudget {
  const { maxCandidates, timeoutMs } = policy;

  if (
    maxCandidates !== undefined &&
    (!Number.isSafeInteger(maxCandidates) || maxCandidates <= 0)
  ) {
    throw new RangeError('maxCandidates must be a positive safe integer.');
  }

  if (
    timeoutMs !== undefined &&
    (!Number.isSafeInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 2_147_483_647)
  ) {
    throw new RangeError('timeoutMs must be an integer from 1 to 2147483647.');
  }

  const deadlineAt = timeoutMs === undefined ? null : Date.now() + timeoutMs;
  const runSignal =
    timeoutMs === undefined
      ? signal
      : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);

  return Object.freeze({
    signal: runSignal,
    maxCandidates: maxCandidates ?? null,
    deadlineAt,
  });
}

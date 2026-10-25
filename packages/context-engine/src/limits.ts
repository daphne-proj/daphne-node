import { ContextInputError } from './errors.js';

/* Bound investigation retention and individual rendered packets independently so a host can keep evidence for later selections. */
export interface ContextLimits {
  readonly maxContextBytes: number;
  readonly maxRetainedBytes: number;
}

/*
 * These are application byte budgets, not model context-window limits.
 * The existing 64 KiB / 4 MiB defaults are the starting policy documented in
 * packages/context-engine/README.md. The 8 MiB / 32 MiB ceilings below were
 * chosen in docs/superpowers/plans/2026-10-25-intentions-agent.md to allow
 * larger intentions requests; they are not derived from provider specs or benchmarks.
 */
export const defaultContextLimits: ContextLimits = Object.freeze({
  maxContextBytes: 65_536,
  maxRetainedBytes: 4_194_304,
});

const maximumContextLimits: ContextLimits = {
  maxContextBytes: 8_388_608,
  maxRetainedBytes: 33_554_432,
};

/* Keep engine overrides within the supported packet and retention ceilings. */
export function resolveContextLimits(
  overrides?: Partial<ContextLimits>,
): ContextLimits;
export function resolveContextLimits(overrides: unknown = {}): ContextLimits {
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new ContextInputError('Context limits must be an object.');
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (name !== 'maxContextBytes' && name !== 'maxRetainedBytes') {
      throw new ContextInputError('Unknown context limit.');
    }

    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > maximumContextLimits[name]
    ) {
      throw new ContextInputError(
        'Context limits must be positive safe integers within the supported packet (8 MiB) and retention (32 MiB) bounds.',
      );
    }
  }

  return Object.freeze({ ...defaultContextLimits, ...overrides });
}

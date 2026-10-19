import { ContextInputError } from './errors.js';

export interface ContextLimits {
  readonly maxContextBytes: number;
  readonly maxRetainedBytes: number;
}

export const defaultContextLimits: ContextLimits = Object.freeze({
  maxContextBytes: 65_536,
  maxRetainedBytes: 4_194_304,
});

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
      value > defaultContextLimits[name]
    ) {
      throw new ContextInputError(
        'Context limits must be positive safe integers no greater than their defaults.',
      );
    }
  }

  return Object.freeze({ ...defaultContextLimits, ...overrides });
}

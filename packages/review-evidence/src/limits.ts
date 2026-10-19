import { EvidenceInputError } from './errors.js';

export interface EvidenceLimits {
  readonly maxToolBytes: number;
  readonly maxPageEntries: number;
}

export const defaultEvidenceLimits: EvidenceLimits = Object.freeze({
  maxToolBytes: 16_384,
  maxPageEntries: 100,
});

export function resolveEvidenceLimits(
  overrides?: Partial<EvidenceLimits>,
): EvidenceLimits;
export function resolveEvidenceLimits(overrides: unknown = {}): EvidenceLimits {
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new EvidenceInputError('Evidence limits must be an object.');
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (name !== 'maxToolBytes' && name !== 'maxPageEntries') {
      throw new EvidenceInputError('Unknown evidence limit.');
    }

    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > defaultEvidenceLimits[name]
    ) {
      throw new EvidenceInputError(
        'Evidence limits must be positive safe integers no greater than their defaults.',
      );
    }
  }

  return Object.freeze({ ...defaultEvidenceLimits, ...overrides });
}

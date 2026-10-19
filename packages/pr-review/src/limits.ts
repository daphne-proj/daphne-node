export interface PullRequestLimits {
  readonly httpTimeoutMs: number;
  readonly maxHttpBytes: number;
}

export interface ResolvePullRequestOptions {
  readonly signal: AbortSignal;
  readonly limits: PullRequestLimits;
  readonly token?: string;
}

export class PullRequestInputError extends Error {
  override readonly name = 'PullRequestInputError';
}

export const defaultPullRequestLimits: PullRequestLimits = Object.freeze({
  httpTimeoutMs: 30_000,
  maxHttpBytes: 2_097_152,
});

function isLimitName(name: string): name is keyof PullRequestLimits {
  return Object.hasOwn(defaultPullRequestLimits, name);
}

export function resolvePullRequestLimits(
  overrides?: Partial<PullRequestLimits>,
): PullRequestLimits;
export function resolvePullRequestLimits(
  overrides: unknown = {},
): PullRequestLimits {
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new PullRequestInputError('Pull request limits must be an object.');
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (!isLimitName(name)) {
      throw new PullRequestInputError('Unknown pull request limit.');
    }

    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > defaultPullRequestLimits[name]
    ) {
      throw new PullRequestInputError(
        `Pull request limit ${name} must be a positive safe integer no greater than ${String(defaultPullRequestLimits[name])}.`,
      );
    }
  }

  return Object.freeze({ ...defaultPullRequestLimits, ...overrides });
}

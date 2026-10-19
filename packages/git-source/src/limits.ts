export interface GitLimits {
  readonly acquisitionTimeoutMs: number;
  readonly gitTimeoutMs: number;
  readonly maxGitOutputBytes: number;
  readonly maxBlobBytes: number;
}

export interface GitOperationOptions {
  readonly signal: AbortSignal;
  readonly limits: GitLimits;
}

export class GitInputError extends Error {
  override readonly name = 'GitInputError';
}

type GitErrorCode =
  | 'git'
  | 'cancelled'
  | 'timeout'
  | 'output_limit'
  | 'acquisition'
  | 'invalid_comparison'
  | 'invalid_git_output'
  | 'unsupported'
  | 'closed'
  | 'cleanup';

export class GitOperationError extends Error {
  override readonly name = 'GitOperationError';

  constructor(
    readonly code: GitErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export const defaultGitLimits: GitLimits = Object.freeze({
  acquisitionTimeoutMs: 300_000,
  gitTimeoutMs: 30_000,
  maxGitOutputBytes: 16_777_216,
  maxBlobBytes: 2_097_152,
});

function isLimitName(name: string): name is keyof GitLimits {
  return Object.hasOwn(defaultGitLimits, name);
}

export function resolveGitLimits(overrides?: Partial<GitLimits>): GitLimits;
export function resolveGitLimits(overrides: unknown = {}): GitLimits {
  if (
    typeof overrides !== 'object' ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new GitInputError('Git limits must be an object.');
  }

  for (const [name, value] of Object.entries(overrides)) {
    if (!isLimitName(name)) {
      throw new GitInputError('Unknown Git limit.');
    }

    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > defaultGitLimits[name]
    ) {
      throw new GitInputError(
        `Git limit ${name} must be a positive safe integer no greater than ${String(defaultGitLimits[name])}.`,
      );
    }
  }
  return Object.freeze({ ...defaultGitLimits, ...overrides });
}

export function checkCancellation(signal: AbortSignal): void {
  if (!signal.aborted) {
    return;
  }

  if (
    signal.reason instanceof DOMException &&
    signal.reason.name === 'TimeoutError'
  ) {
    throw new GitOperationError(
      'timeout',
      'The Git operation exceeded its deadline.',
    );
  }
  throw new GitOperationError('cancelled', 'The Git operation was cancelled.');
}

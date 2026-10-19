/**
 * Bounds how long Git runs and how much output or blob content we read.
 * Example: a blob above maxBlobBytes is classified as unsupported instead of loaded.
 */
export interface GitLimits {
  readonly acquisitionTimeoutMs: number;
  readonly gitTimeoutMs: number;
  readonly maxGitOutputBytes: number;
  readonly maxBlobBytes: number;
}

/**
 * Lets the caller cancel work and supply limits explicitly, without global configuration.
 * Example: one AbortController can cancel both acquisition and later inventory calls.
 */
export interface GitOperationOptions {
  readonly signal: AbortSignal;
  readonly limits: GitLimits;
}

/**
 * Identifies invalid caller input so it can be corrected before retrying.
 * Example: a branch name such as main is rejected where a full commit ID is required.
 */
export class GitInputError extends Error {
  override readonly name = 'GitInputError';
}

/**
 * Gives callers stable failure categories without making them parse error messages.
 * Example: timeout can be presented differently from an already closed snapshot.
 */
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

/**
 * Carries an operation's failure category and safe diagnostics across the package boundary.
 * Example: a failed Git command includes its exit code, not raw stderr or credentials.
 */
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

/**
 * Provides fixed upper bounds that callers can tighten but cannot increase.
 * Example: an interactive caller can lower the Git deadline from 30 seconds to 5.
 */
export const defaultGitLimits: GitLimits = Object.freeze({
  acquisitionTimeoutMs: 300_000,
  gitTimeoutMs: 30_000,
  maxGitOutputBytes: 16_777_216,
  maxBlobBytes: 2_097_152,
});

/**
 * Checks a runtime key before using it to look up a limit.
 * Example: maxBlobBytes is accepted; a misspelled maxBlobByte is rejected.
 */
function isLimitName(name: string): name is keyof GitLimits {
  return Object.hasOwn(defaultGitLimits, name);
}

/**
 * Validates overrides and fills omitted settings with defaults, returning a frozen result.
 * Example: resolveGitLimits({ gitTimeoutMs: 5000 }) keeps the default byte caps.
 */
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

/**
 * Stops work with a safe error instead of exposing the caller's arbitrary abort reason.
 * Example: an expired deadline becomes timeout; a user cancellation becomes cancelled.
 */
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

import { PullRequestInputError, resolvePullRequestLimits } from '../limits.js';
import type { ResolvePullRequestOptions } from '../limits.js';

export interface PullRequestRef {
  readonly url: string;
  readonly owner: string;
  readonly repository: string;
  readonly number: number;
}

export interface ResolvedPullRequest {
  readonly ref: PullRequestRef;
  readonly targetRepositoryUrl: string;
  readonly headRepositoryUrl: string;
  readonly targetCommit: string;
  readonly headCommit: string;
}

type PullRequestErrorCode =
  | 'authentication'
  | 'forbidden'
  | 'not_found'
  | 'rate_limit'
  | 'redirect'
  | 'http'
  | 'invalid_response'
  | 'unsupported_repository'
  | 'response_limit'
  | 'cancelled'
  | 'timeout'
  | 'network';

export class PullRequestError extends Error {
  override readonly name = 'PullRequestError';

  constructor(
    readonly code: PullRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const ownerPattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/;
const repositoryPattern = /^[a-zA-Z0-9_.-]+$/;

function isOwnerName(value: unknown): value is string {
  return typeof value === 'string' && ownerPattern.exec(value)?.[0] === value;
}

function isRepositoryName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    repositoryPattern.exec(value)?.[0] === value &&
    value !== '.' &&
    value !== '..'
  );
}

export function parsePullRequestUrl(value: string): PullRequestRef {
  if (typeof value !== 'string') {
    throw new PullRequestInputError('Pull request URL must be a string.');
  }
  const match =
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/.exec(
      value,
    );
  const owner = match?.[1];
  const repository = match?.[2];
  const number = Number(match?.[3]);

  if (
    !isOwnerName(owner) ||
    !isRepositoryName(repository) ||
    !Number.isSafeInteger(number) ||
    number <= 0 ||
    match?.[0] !== value
  ) {
    throw new PullRequestInputError(
      'Expected https://github.com/OWNER/REPOSITORY/pull/NUMBER, with no credentials, query or fragment.',
    );
  }

  return Object.freeze({
    url: `https://github.com/${owner}/${repository}/pull/${String(number)}`,
    owner,
    repository,
    number,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidResponse(): PullRequestError {
  return new PullRequestError(
    'invalid_response',
    'GitHub returned invalid pull request metadata.',
  );
}

function readRevision(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.sha !== 'string' ||
    value.sha.length !== 40 ||
    !/^[0-9a-f]{40}$/i.test(value.sha)
  ) {
    throw invalidResponse();
  }
  const repo = value.repo;
  if (repo === null) {
    throw new PullRequestError(
      'unsupported_repository',
      'The pull request repository is no longer available.',
    );
  }
  if (
    !isRecord(repo) ||
    !isRecord(repo.owner) ||
    !isOwnerName(repo.owner.login) ||
    !isRepositoryName(repo.name) ||
    typeof repo.private !== 'boolean'
  ) {
    throw invalidResponse();
  }
  if (repo.private) {
    throw new PullRequestError(
      'unsupported_repository',
      'Only public base and head repositories are supported.',
    );
  }

  return {
    owner: repo.owner.login,
    repository: repo.name,
    repositoryUrl: `https://github.com/${repo.owner.login}/${repo.name}.git`,
    commit: value.sha.toLowerCase(),
  };
}

function readMetadata(
  value: unknown,
  ref: PullRequestRef,
): ResolvedPullRequest {
  if (!isRecord(value) || value.number !== ref.number) {
    throw invalidResponse();
  }
  const target = readRevision(value.base);
  const head = readRevision(value.head);
  if (
    target.owner.toLowerCase() !== ref.owner.toLowerCase() ||
    target.repository.toLowerCase() !== ref.repository.toLowerCase()
  ) {
    throw invalidResponse();
  }

  return Object.freeze({
    ref,
    targetRepositoryUrl: target.repositoryUrl,
    headRepositoryUrl: head.repositoryUrl,
    targetCommit: target.commit,
    headCommit: head.commit,
  });
}

function httpError(response: Response): PullRequestError {
  const status = response.status;
  const cause = { status };

  if (
    status === 429 ||
    (status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.has('retry-after')))
  ) {
    return new PullRequestError(
      'rate_limit',
      'GitHub rate limit reached; retry later or supply a read token.',
      { cause },
    );
  }

  if (status === 401) {
    return new PullRequestError(
      'authentication',
      'GitHub rejected the supplied token.',
      { cause },
    );
  }

  if (status === 403) {
    return new PullRequestError(
      'forbidden',
      'GitHub denied access; check token permissions or a possible secondary rate limit.',
      { cause },
    );
  }

  if (status === 404) {
    return new PullRequestError(
      'not_found',
      'Pull request not found or not accessible with the supplied credentials.',
      { cause },
    );
  }

  if (status >= 300 && status < 400) {
    return new PullRequestError(
      'redirect',
      'GitHub redirected the request; use the current canonical pull request URL.',
      { cause },
    );
  }

  return new PullRequestError(
    'http',
    `GitHub request failed with HTTP ${String(status)}.`,
    { cause },
  );
}

async function readJson(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.body) {
    throw invalidResponse();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;

  try {
    let chunk = await reader.read();
    while (!chunk.done) {
      const value: unknown = chunk.value;

      if (!(value instanceof Uint8Array)) {
        throw invalidResponse();
      }

      bytes += value.byteLength;

      if (bytes > maxBytes) {
        throw new PullRequestError(
          'response_limit',
          'GitHub metadata exceeds the configured response byte limit.',
        );
      }

      chunks.push(value);
      chunk = await reader.read();
    }
  } finally {
    reader.releaseLock();
  }

  try {
    const value: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Buffer.concat(chunks, bytes),
      ),
    );

    return value;
  } catch {
    throw invalidResponse();
  }
}

export async function resolvePullRequest(
  ref: PullRequestRef,
  options: ResolvePullRequestOptions,
): Promise<ResolvedPullRequest> {
  const parsed = parsePullRequestUrl(ref.url);

  if (
    parsed.owner !== ref.owner ||
    parsed.repository !== ref.repository ||
    parsed.number !== ref.number
  ) {
    throw new PullRequestInputError(
      'Pull request reference does not match its URL.',
    );
  }

  const limits = resolvePullRequestLimits(options.limits);
  const request = new AbortController();

  const signal = AbortSignal.any([
    options.signal,
    request.signal,
    AbortSignal.timeout(limits.httpTimeoutMs),
  ]);

  try {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'daphne-pr-review',
    };

    if (options.token !== undefined) {
      headers.Authorization = `Bearer ${options.token}`;
    }

    const response = await fetch(
      `https://api.github.com/repos/${parsed.owner}/${parsed.repository}/pulls/${String(parsed.number)}`,
      { headers, signal, redirect: 'manual' },
    );

    if (!response.ok) {
      throw httpError(response);
    }

    const payload = await readJson(response, limits.maxHttpBytes);
    signal.throwIfAborted();

    return readMetadata(payload, parsed);
  } catch (error) {
    if (options.signal.aborted) {
      throw new PullRequestError(
        'cancelled',
        'Pull request resolution was cancelled.',
      );
    }

    if (signal.aborted) {
      throw new PullRequestError(
        'timeout',
        'Pull request resolution exceeded its deadline.',
      );
    }

    if (error instanceof PullRequestError) {
      throw error;
    }

    // Native errors and caller abort reasons may contain credentials.
    throw new PullRequestError(
      'network',
      'Could not complete the GitHub metadata request.',
    );
  } finally {
    // Abort also releases unread error or oversized response bodies.
    request.abort();
  }
}

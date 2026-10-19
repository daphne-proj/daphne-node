export class EvidenceInputError extends Error {
  override readonly name = 'EvidenceInputError';
}

type SourceUnavailableReason =
  | 'missing'
  | 'symlink'
  | 'submodule'
  | 'not_regular'
  | 'too_large'
  | 'binary'
  | 'invalid_utf8';

/** An unavailable source is distinct from a valid empty excerpt or a failed Git operation. */
export class SourceUnavailableError extends Error {
  override readonly name = 'SourceUnavailableError';

  constructor(
    readonly reason: SourceUnavailableReason,
    message: string,
  ) {
    super(message);
  }
}

/** No complete response or indivisible item fits the requested byte allowance. */
export class EvidenceLimitError extends Error {
  override readonly name = 'EvidenceLimitError';
}

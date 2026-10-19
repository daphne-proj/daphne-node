export class ContextInputError extends Error {
  override readonly name = 'ContextInputError';
}

export class ContextConflictError extends Error {
  override readonly name = 'ContextConflictError';
}

export class ContextLimitError extends Error {
  override readonly name = 'ContextLimitError';

  constructor(
    readonly limit: 'retention' | 'packet',
    message: string,
  ) {
    super(message);
  }
}

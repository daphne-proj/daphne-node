/* Reject malformed or foreign supplied data before it can become retained evidence or packet content. */
export class ContextInputError extends Error {
  override readonly name = 'ContextInputError';
}

/* Distinguish contradictory evidence or query history from an ordinary input-shape error. */
export class ContextConflictError extends Error {
  override readonly name = 'ContextConflictError';
}

/* Identify whether retention or packet construction failed so the host can adjust its collection or selection policy. */
export class ContextLimitError extends Error {
  override readonly name = 'ContextLimitError';

  constructor(
    readonly limit: 'retention' | 'packet',
    message: string,
  ) {
    super(message);
  }
}

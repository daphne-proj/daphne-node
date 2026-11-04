import {
  assembleCompleteEvidence,
  ContextInputError,
  validateDiffInput,
} from '@daphne/context-engine';
import type {
  ContextEngine,
  ContextPacket,
  QueryPageSelection,
} from '@daphne/context-engine';
import type { IntentionsInput } from './contracts.js';
import { intentionsLimits } from './limits.js';

function checkText(value: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new ContextInputError(
      'Intentions input requires well-formed UTF-8 text.',
    );
  }
}

/* Validate PR text and the shared diff invariants before retaining the initial context. */
export function assertValidInput(input: IntentionsInput): void {
  checkText(input.pr.url);
  checkText(input.pr.title, true);

  if (input.pr.body !== null) {
    checkText(input.pr.body, true);
  }

  validateDiffInput(input);
}

/* Require every selected source and tool page to fit the intentions packet. */
export function assembleEvidence(
  engine: ContextEngine,
  evidenceIds: readonly string[],
  queryPages?: readonly QueryPageSelection[],
): ContextPacket {
  return assembleCompleteEvidence(engine, {
    evidenceIds,
    maxBytes: intentionsLimits.maxContextBytes,
    ...(queryPages === undefined ? {} : { queryPages }),
  });
}

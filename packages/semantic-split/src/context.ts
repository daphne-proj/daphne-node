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
import type { SemanticSplitInput } from './contracts.js';
import { splitLimits } from './limits.js';

function checkText(value: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new ContextInputError('Split input requires well-formed UTF-8 text.');
  }
}

/* Capture owned input before any await so caller edits cannot change IDs or the code they identify. */
export function captureSplitInput(
  value: SemanticSplitInput,
): SemanticSplitInput {
  const input = structuredClone(value);
  checkText(input.pr.url);
  checkText(input.pr.title, true);

  if (input.pr.body !== null) {
    checkText(input.pr.body, true);
  }

  validateDiffInput(input);

  for (const change of input.changes) {
    for (const hunk of change.hunks) {
      Object.freeze(hunk);
    }

    Object.freeze(change.hunks);
    Object.freeze(change);
  }

  Object.freeze(input.identity);
  Object.freeze(input.pr);
  Object.freeze(input.changes);

  return Object.freeze(input);
}

/* Require every selected source and tool page to fit the split packet. */
export function assembleEvidence(
  engine: ContextEngine,
  evidenceIds: readonly string[],
  queryPages?: readonly QueryPageSelection[],
): ContextPacket {
  return assembleCompleteEvidence(engine, {
    evidenceIds,
    maxBytes: splitLimits.maxContextBytes,
    ...(queryPages === undefined ? {} : { queryPages }),
  });
}

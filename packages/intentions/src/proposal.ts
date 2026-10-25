import type { Side } from '@daphne/review-evidence/contracts';
import type {
  Intention,
  IntentionCitation,
  IntentionClaim,
  IntentionReason,
  IntentionsValidation,
  IntentionsValidationContext,
} from './contracts.js';

function object(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected a JSON object.');
  }

  const result = Object.fromEntries(Object.entries(value));

  if (
    Object.keys(result).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(result, key))
  ) {
    throw new Error(`Expected exactly these fields: ${keys.join(', ')}.`);
  }

  return result;
}

function text(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new Error('Expected nonempty UTF-8 text.');
  }

  return value;
}

function array(value: unknown, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new Error(
      `Expected an array with at least ${String(minimum)} items.`,
    );
  }

  return value;
}

function offset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Citation offsets must be nonnegative safe integers.');
  }

  return value;
}

function citation(
  value: unknown,
  context: IntentionsValidationContext,
  side?: Side,
): IntentionCitation {
  if (typeof value !== 'object' || value === null || !('kind' in value)) {
    throw new Error('Expected a code or change citation.');
  }

  if (value.kind === 'change') {
    const input = object(value, ['kind', 'changeId']);
    const changeId = text(input.changeId);

    if (!context.changes.some((change) => change.id === changeId)) {
      throw new Error(`Unknown cited change: ${changeId}.`);
    }

    return { kind: 'change', changeId };
  }

  if (value.kind !== 'code') {
    throw new Error('Unknown citation kind.');
  }

  const input = object(value, ['kind', 'evidenceId', 'range']);
  const evidenceId = text(input.evidenceId);
  const retained = context.sources.find(
    (source) => source.evidenceId === evidenceId,
  );

  /* Retention alone is insufficient: the model must have received this source. */
  if (!retained || !context.deliveredEvidenceIds.includes(evidenceId)) {
    throw new Error(`Unknown or undelivered evidence: ${evidenceId}.`);
  }

  const { ref, text: sourceText } = retained.source;
  const expectedCommit =
    ref.side === 'base'
      ? context.identity.baseCommit
      : context.identity.headCommit;

  /* Before and after are revision-specific; inferred reasons can cite either side. */
  if (
    ref.sessionId !== context.identity.sessionId ||
    ref.commit !== expectedCommit ||
    (side !== undefined && ref.side !== side)
  ) {
    throw new Error(
      `Evidence ${evidenceId} belongs to the wrong session or revision side.`,
    );
  }

  const selected = object(input.range, ['startByte', 'endByte']);
  const range = {
    startByte: offset(selected.startByte),
    endByte: offset(selected.endByte),
  };
  const bytes = Buffer.from(sourceText);
  const start = range.startByte - ref.range.startByte;
  const end = range.endByte - ref.range.startByte;

  /* Offsets address original UTF-8 bytes, not JavaScript characters or model-written code. */
  if (
    !Number.isSafeInteger(ref.range.startByte) ||
    ref.range.startByte < 0 ||
    !Number.isSafeInteger(ref.range.endByte) ||
    Buffer.byteLength(sourceText) !== ref.range.endByte - ref.range.startByte ||
    bytes.toString('utf8') !== sourceText ||
    start < 0 ||
    end <= start ||
    end > bytes.length ||
    ((bytes[start] ?? 0) & 0xc0) === 0x80 ||
    (end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80)
  ) {
    throw new Error(
      `Citation ${evidenceId} must select a nonempty UTF-8 range inside its source.`,
    );
  }

  return {
    kind: 'code',
    evidenceId,
    range,
    source: {
      ref: { ...ref, range },
      text: bytes.subarray(start, end).toString('utf8'),
    },
  };
}

function claim(
  value: unknown,
  context: IntentionsValidationContext,
  side: Side,
): IntentionClaim {
  const input = object(value, ['text', 'citations']);

  return {
    text: text(input.text),
    citations: array(input.citations, 1).map((item) =>
      citation(item, context, side),
    ),
  };
}

function reason(
  value: unknown,
  context: IntentionsValidationContext,
): IntentionReason {
  if (typeof value !== 'object' || value === null || !('basis' in value)) {
    throw new Error('Expected a stated, inferred or unknown reason.');
  }

  if (value.basis === 'unknown') {
    object(value, ['basis']);
    return { basis: 'unknown' };
  }

  const input = object(value, ['basis', 'text', 'citations']);
  const explanation = text(input.text);
  const references = array(input.citations, 1);

  if (value.basis === 'inferred') {
    return {
      basis: 'inferred',
      text: explanation,
      citations: references.map((item) => citation(item, context)),
    };
  }

  if (value.basis !== 'stated') {
    throw new Error('Unknown reason basis.');
  }

  return {
    basis: 'stated',
    text: explanation,
    citations: references.map((item) => {
      const reference = object(item, ['field', 'quote']);
      const { field } = reference;
      const quote = text(reference.quote);

      if (
        (field !== 'title' && field !== 'body') ||
        !context.pr[field]?.includes(quote)
      ) {
        throw new Error(
          'An author-stated reason must quote the captured PR title or body exactly.',
        );
      }

      return { field, quote };
    }),
  };
}

export function validateIntentions(
  textInput: string,
  context: IntentionsValidationContext,
): IntentionsValidation {
  try {
    const parsed: unknown = JSON.parse(textInput);
    const input = object(parsed, ['intentions', 'warnings']);
    const intentions = array(
      input.intentions,
      context.changes.length === 0 ? 0 : 1,
    ).map((value): Intention => {
      const card = object(value, [
        'title',
        'changeIds',
        'before',
        'after',
        'why',
      ]);
      const changeIds = array(card.changeIds, 1).map(text);

      if (
        new Set(changeIds).size !== changeIds.length ||
        changeIds.some(
          (id) => !context.changes.some((change) => change.id === id),
        )
      ) {
        throw new Error(
          'Each intention must reference distinct, known change IDs.',
        );
      }

      return {
        title: text(card.title),
        changeIds,
        before: claim(card.before, context, 'base'),
        after: claim(card.after, context, 'head'),
        why: reason(card.why, context),
      };
    });

    return {
      status: 'valid',
      proposal: { intentions, warnings: array(input.warnings).map(text) },
    };
  } catch (error) {
    return {
      status: 'invalid',
      diagnostics: [
        error instanceof Error ? error.message : 'Invalid intentions JSON.',
      ],
    };
  }
}

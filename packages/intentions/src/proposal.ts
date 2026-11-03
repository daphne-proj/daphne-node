import type { Side } from '@daphne/review-evidence/contracts';
import type {
  Intention,
  IntentionCitation,
  IntentionClaim,
  IntentionReason,
  IntentionsValidation,
  IntentionsValidationContext,
} from './contracts.js';
import { intentionsOutputSchema } from './schema.js';
import type {
  RawIntentionCitation,
  RawIntentionClaim,
  RawIntentionReason,
} from './schema.js';

function citation(
  value: RawIntentionCitation,
  context: IntentionsValidationContext,
  side?: Side,
): IntentionCitation {
  if (value.kind === 'change') {
    const { changeId } = value;

    if (!context.changes.some((change) => change.id === changeId)) {
      throw new Error(`Unknown cited change: ${changeId}.`);
    }

    return { kind: 'change', changeId };
  }

  const { evidenceId, range } = value;
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

  /* Before and after are revision-specific; purpose and issues can cite either side. */
  if (
    ref.sessionId !== context.identity.sessionId ||
    ref.commit !== expectedCommit ||
    (side !== undefined && ref.side !== side)
  ) {
    throw new Error(
      `Evidence ${evidenceId} belongs to the wrong session or revision side.`,
    );
  }

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
  value: RawIntentionClaim,
  context: IntentionsValidationContext,
  side: Side,
): IntentionClaim {
  return {
    text: value.text,
    citations: value.citations.map((item) => citation(item, context, side)),
  };
}

function reason(
  value: RawIntentionReason,
  context: IntentionsValidationContext,
): IntentionReason {
  if (value.basis === 'unknown') {
    return { basis: 'unknown' };
  }

  if (value.basis === 'inferred') {
    return {
      basis: 'inferred',
      text: value.text,
      citations: value.citations.map((item) => citation(item, context)),
    };
  }

  return {
    basis: 'stated',
    citations: value.citations.map(({ field, quote }) => {
      if (!context.pr[field]?.includes(quote)) {
        throw new Error(
          'An author-stated purpose must quote the captured PR title or body exactly.',
        );
      }

      return { field, quote };
    }),
  };
}

/*
 * Decode and validate a writer proposal, then resolve citations from delivered
 * evidence. For example, a valid raw code range gains its exact source bytes.
 * Shape failures include field paths; contextual failures remain diagnostics,
 * and neither path mutates text or trusts model-supplied source content.
 */
export function validateIntentions(
  textInput: string,
  context: IntentionsValidationContext,
): IntentionsValidation {
  let value: unknown;

  try {
    value = JSON.parse(textInput);
  } catch (error) {
    return {
      status: 'invalid',
      diagnostics: [
        error instanceof Error ? error.message : 'Invalid intentions JSON.',
      ],
    };
  }

  const parsed = intentionsOutputSchema.safeParse(value);

  if (!parsed.success) {
    return {
      status: 'invalid',
      diagnostics: parsed.error.issues.map(
        (issue) =>
          `${issue.path.map(String).join('.') || 'proposal'}: ${issue.message}`,
      ),
    };
  }

  try {
    const input = parsed.data;

    if (context.changes.length > 0 && input.intentions.length === 0) {
      throw new Error('A nonempty inventory requires at least one intention.');
    }

    const intentions = input.intentions.map((card): Intention => {
      const { changeIds } = card;

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
        title: card.title,
        changeIds,
        before: claim(card.before, context, 'base'),
        after: claim(card.after, context, 'head'),
        intendedOutcome: reason(card.intendedOutcome, context),
        why: reason(card.why, context),
        issues: card.issues.map((issue) => ({
          ...issue,
          citations: issue.citations.map((item) => citation(item, context)),
        })),
      };
    });

    return {
      status: 'valid',
      proposal: { intentions, warnings: input.warnings },
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

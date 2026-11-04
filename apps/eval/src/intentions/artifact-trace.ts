import { isDeepStrictEqual } from 'node:util';
import { validateIntentions } from '@daphne/intentions';
import type {
  IntentionsProposal,
  IntentionsValidationContext,
} from '@daphne/intentions';
import { parseDeliveredTurns } from '../artifact-delivery.js';
import type { WriterDeliveryContext } from '../artifact-delivery.js';
import type { WriterSearchReceipt } from '../artifact-tools.js';
import { parseRunBudget } from '../run-budget.js';
import * as parse from '../parse.js';

export interface IntentionArtifactContext extends WriterDeliveryContext {
  changes: IntentionsValidationContext['changes'];
  pr: IntentionsValidationContext['pr'];
}

/* Accepted output keeps writer-delivered source IDs separate from directly confirmed search receipts. */
export interface ParsedIntentionTrace {
  generationInstructions: string | null;
  proposal: IntentionsProposal;
  response: Record<string, unknown> | null;
  deliveredEvidenceIds: readonly string[];
  searches: readonly WriterSearchReceipt[];
}

/*
 * Resolve the accepted writer and repeat structural validation from raw replies.
 * For example, each repair must follow an invalid draft and the final draft must
 * validate against its own delivered sources. Saved proposals and acceptance
 * references are claims to verify, not authority or semantic certification.
 * Invalid complete traces throw; callers reject failed host runs before this parser.
 */
export function parseIntentionTrace(
  value: unknown,
  context: IntentionArtifactContext,
): ParsedIntentionTrace {
  const investigation = parse.object(value, 'investigation');
  const budget = parseRunBudget(investigation.budget);
  const attempts = parse.array(
    investigation.attempts,
    'investigation.attempts',
  );
  const { turns, searches } = parseDeliveredTurns(investigation, context);
  const calls = parse.object(investigation.calls, 'investigation.calls');

  if (
    'deliveredEvidenceIds' in investigation ||
    (budget.maxCandidates !== null && attempts.length > budget.maxCandidates) ||
    calls.count !== turns.length ||
    calls.generate !== turns.length ||
    calls.tools !==
      parse.array(investigation.tools, 'investigation.tools').length
  ) {
    throw new parse.EvaluationError(
      'The investigation has obsolete delivery state or inconsistent budget/call accounting.',
    );
  }

  if (context.changes.length === 0) {
    if (
      turns.length > 0 ||
      attempts.length > 0 ||
      investigation.acceptedCandidate !== null ||
      investigation.response !== null
    ) {
      throw new parse.EvaluationError(
        'Empty comparisons require zero calls, no attempts and no accepted candidate.',
      );
    }

    return {
      generationInstructions: null,
      proposal: { intentions: [], warnings: [] },
      response: null,
      deliveredEvidenceIds: [],
      searches: [],
    };
  }

  let cursor = 0;
  let accepted: ParsedIntentionTrace | null = null;

  for (const [index, value] of attempts.entries()) {
    const attempt = parse.object(value, 'attempt');
    const number = index + 1;
    const writerNumber = parse.integer(
      attempt.writerTurnNumber,
      'attempt.writerTurnNumber',
    );
    const writer = turns[writerNumber - 1];
    const writerTurns = turns.slice(cursor, writerNumber);

    if (
      attempt.number !== number ||
      !writer ||
      writer.candidateNumber !== number ||
      writer.reply.functionCalls.length > 0 ||
      writerTurns.length === 0 ||
      writerTurns.some((turn) => turn.candidateNumber !== number) ||
      writerTurns
        .slice(0, -1)
        .some(
          (turn) =>
            turn.reply.functionCalls.length === 0 || turn.validation !== null,
        ) ||
      !isDeepStrictEqual(
        attempt.deliveredEvidenceIds,
        writer.deliveredEvidenceIds,
      )
    ) {
      throw new parse.EvaluationError(
        'An attempt must reference its consecutive terminal writer draft and exact delivery snapshot.',
      );
    }

    const validation = validateIntentions(writer.reply.text, {
      ...context,
      deliveredEvidenceIds: writer.deliveredEvidenceIds,
    });

    if (!isDeepStrictEqual(writer.validation, validation)) {
      throw new parse.EvaluationError(
        'Saved writer validation differs from its raw proposal.',
      );
    }

    const expectedEvaluation =
      validation.status === 'valid'
        ? { kind: 'structural', status: 'accept' }
        : {
            kind: 'structural',
            status: 'revise',
            diagnostics: validation.diagnostics,
          };

    if (!isDeepStrictEqual(attempt.evaluation, expectedEvaluation)) {
      throw new parse.EvaluationError(
        'Structural acceptance or feedback disagrees with the writer validation.',
      );
    }

    const status = expectedEvaluation.status;
    cursor = writerNumber;

    if (validation.status === 'valid') {
      if (
        !isDeepStrictEqual(investigation.acceptedCandidate, {
          candidateNumber: number,
          writerTurnNumber: writerNumber,
        })
      ) {
        throw new parse.EvaluationError(
          'Accepted candidate references differ from the structurally valid attempt.',
        );
      }

      accepted = {
        generationInstructions: writer.instructions,
        proposal: validation.proposal,
        response: writer.reply.response,
        deliveredEvidenceIds: writer.deliveredEvidenceIds,
        searches,
      };
    }

    if (status !== (index === attempts.length - 1 ? 'accept' : 'revise')) {
      throw new parse.EvaluationError(
        'A complete investigation requires revisions followed by one final acceptance.',
      );
    }
  }

  if (!accepted || cursor !== turns.length) {
    throw new parse.EvaluationError(
      'A complete nonempty investigation requires an accepting final attempt with no extra turns.',
    );
  }

  return accepted;
}

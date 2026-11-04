import { isDeepStrictEqual } from 'node:util';
import type { ModelProvider } from '@daphne/llm';
import { getExpectedUnitIds, validateProposal } from '@daphne/semantic-split';
import type { SplitScoreInput } from './contracts.js';
import type { EvidenceSnapshot } from '@daphne/context-engine';
import { parseDeliveredTurns } from '../artifact-delivery.js';
import type { Change } from '@daphne/review-evidence/contracts';
import { parseRunBudget } from '../run-budget.js';
import * as parse from '../parse.js';

/* Verify candidate references against provider replies, not a separately saved proposal copy. */
export function parseSplitTrace(
  input: Record<string, unknown>,
  changes: readonly Change[],
  provider: ModelProvider,
  snapshot: EvidenceSnapshot | null,
): SplitScoreInput {
  const status = parse.choice(
    input.status,
    ['complete', 'failed'],
    'investigation.status',
  );
  const expected = getExpectedUnitIds(changes);
  const budget = parseRunBudget(input.budget);
  const recordedTurns = parse.array(input.turns, 'turns');
  const recordedTools = parse.array(input.tools, 'tools');

  if (
    snapshot === null &&
    (status === 'complete' ||
      recordedTurns.length > 0 ||
      recordedTools.length > 0)
  ) {
    throw new parse.EvaluationError(
      'Model activity requires a retained evidence snapshot.',
    );
  }

  const initialEvidenceIds = [
    ...new Set(
      parse
        .array(input.hunks, 'hunks')
        .flatMap((value) =>
          parse
            .array(parse.object(value, 'hunk').evidenceIds, 'hunk.evidenceIds')
            .map((id) => parse.text(id, 'evidence ID')),
        ),
    ),
  ];
  const turns =
    snapshot === null
      ? []
      : parseDeliveredTurns(input, {
          ...snapshot,
          provider,
          initialEvidenceIds,
        }).turns;
  const terminals = turns.filter(
    (turn) => turn.reply.functionCalls.length === 0,
  );
  const attempts = parse
    .array(input.attempts, 'attempts')
    .map((value, index) => {
      const attempt = parse.object(value, 'attempt');
      const turn = terminals[index];

      if (
        !turn ||
        attempt.number !== index + 1 ||
        attempt.writerTurnNumber !== turn.number ||
        turn.candidateNumber !== index + 1
      ) {
        throw new parse.EvaluationError(
          'Attempts must refer once, in order, to terminal writer replies.',
        );
      }

      const validation = validateProposal(turn.reply.text, expected);

      if (
        attempt.validation !== null &&
        !isDeepStrictEqual(attempt.validation, validation)
      ) {
        throw new parse.EvaluationError(
          'Saved proposal validation disagrees with deterministic validation.',
        );
      }

      if (
        (attempt.validation === null || validation.status === 'valid') &&
        turn.number !== turns.length
      ) {
        throw new parse.EvaluationError(
          'Only an evaluated invalid proposal can lead to another turn.',
        );
      }

      return {
        turn,
        validation: attempt.validation === null ? null : validation,
      };
    });
  let candidate = 1;

  for (const turn of turns) {
    if (turn.candidateNumber !== candidate) {
      throw new parse.EvaluationError(
        'Tool turns must stay within their current candidate.',
      );
    }

    if (turn.reply.functionCalls.length === 0) {
      candidate += 1;
    }
  }

  const calls = parse.object(input.calls, 'calls');

  if (
    snapshot === null &&
    (calls.count !== 0 || calls.generate !== 0 || calls.tools !== 0)
  ) {
    throw new parse.EvaluationError(
      'Uninitialized investigations cannot contain model activity.',
    );
  }

  if (
    attempts.length !== terminals.length ||
    (budget.maxCandidates !== null && attempts.length > budget.maxCandidates) ||
    parse.integer(calls.generate, 'calls.generate') < turns.length ||
    parse.integer(calls.count, 'calls.count') <
      parse.integer(calls.generate, 'calls.generate') ||
    parse.integer(calls.tools, 'calls.tools') !== recordedTools.length ||
    (status === 'complete' &&
      (calls.count !== turns.length || calls.generate !== turns.length))
  ) {
    throw new parse.EvaluationError(
      'Recorded attempts, calls or tools are inconsistent.',
    );
  }

  const attemptTexts = attempts.map(({ turn }) => turn.reply.text);

  if (status === 'failed') {
    if (
      input.proposal !== null ||
      input.response !== null ||
      input.acceptedCandidate !== null
    ) {
      throw new parse.EvaluationError(
        'Failed runs cannot contain accepted output or references.',
      );
    }

    return { status, attemptTexts };
  }

  const proposalText = JSON.stringify(input.proposal);
  const accepted = validateProposal(proposalText, expected);

  if (accepted.status !== 'valid') {
    throw new parse.EvaluationError(
      'Accepted output fails deterministic proposal validation.',
    );
  }

  if (expected.size === 0) {
    if (
      turns.length !== 0 ||
      recordedTools.length !== 0 ||
      calls.count !== 0 ||
      calls.generate !== 0 ||
      input.acceptedCandidate !== null ||
      input.response !== null
    ) {
      throw new parse.EvaluationError(
        'An empty split must not contain model activity or an accepted candidate.',
      );
    }
  } else {
    const reference = parse.object(
      input.acceptedCandidate,
      'acceptedCandidate',
    );
    const last = attempts.at(-1);

    if (
      !last ||
      last.validation?.status !== 'valid' ||
      reference.candidateNumber !== attempts.length ||
      reference.writerTurnNumber !== last.turn.number ||
      last.turn.number !== turns.length ||
      !isDeepStrictEqual(last.validation.proposal, accepted.proposal) ||
      !isDeepStrictEqual(input.response, last.turn.reply.response)
    ) {
      throw new parse.EvaluationError(
        'Accepted output must match the last validated terminal reply.',
      );
    }
  }

  return {
    status,
    attemptTexts,
    proposalText: JSON.stringify(accepted.proposal),
  };
}

import { isDeepStrictEqual } from 'node:util';
import { intentionReviewers } from '@daphne/intentions';
import { parseReviewTurnNumbers } from './artifact-reviews.js';
import { decodeModelReply } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import type { EvidenceSnapshot } from '@daphne/context-engine';
import { parseIntentionToolEvidence } from './artifact-tools.js';
import type { IntentionSearchReceipt } from './artifact-tools.js';
import type { ReviewIdentity } from '@daphne/review-evidence/contracts';
import * as parse from '../parse.js';

/* The trace reader supplies one validated ledger; query history never expands source citation eligibility. */
export interface IntentionDeliveryContext {
  provider?: ModelProvider;
  identity: ReviewIdentity;
  sources: EvidenceSnapshot['sources'];
  queries: EvidenceSnapshot['queries'];
  initialEvidenceIds: string[];
}

/* Parse only fields needed for current trace verification; provider payloads remain retained verbatim. */
function parseTurn(value: unknown, index: number, provider: ModelProvider) {
  const turn = parse.object(value, `turns[${String(index)}]`);
  const number = parse.integer(turn.number, 'turn.number');
  const candidateNumber = parse.integer(
    turn.candidateNumber,
    'turn.candidateNumber',
  );
  const reply = parse.object(turn.reply, 'turn.reply');
  const response = parse.object(reply.response, 'reply.response');
  const output = parse
    .array(reply.output, 'reply.output')
    .map((item) => parse.object(item, 'output item'));
  const text = parse.text(reply.text, 'reply.text', true);
  const decoded = decodeModelReply(provider, response);
  const functionCalls = decoded.functionCalls ?? [];
  const instructions =
    turn.instructions === undefined ? response.instructions : turn.instructions;

  if (
    response.instructions !== undefined &&
    response.instructions !== null &&
    instructions !== response.instructions
  ) {
    throw new parse.EvaluationError(
      'Saved instructions differ from the provider response.',
    );
  }

  if (
    number !== index + 1 ||
    candidateNumber === 0 ||
    parse.integer(turn.generationNumber, 'turn.generationNumber') < 1 ||
    !isDeepStrictEqual(decoded.output, output) ||
    text !== decoded.text ||
    !isDeepStrictEqual(reply.functionCalls ?? [], functionCalls)
  ) {
    throw new parse.EvaluationError(
      'Turn numbering or saved provider reply copies disagree.',
    );
  }

  parse.integer(turn.inputTokens, 'turn.inputTokens');

  return {
    number,
    instructions:
      instructions === undefined || instructions === null
        ? null
        : parse.text(instructions, 'turn.instructions'),
    candidateNumber,
    generationNumber: parse.integer(
      turn.generationNumber,
      'turn.generationNumber',
    ),
    role: parse.choice(turn.role, ['writer', 'reviewer'], 'turn.role'),
    conversationId: parse.text(turn.conversationId, 'turn.conversationId'),
    deliveries: parse.array(turn.deliveries, 'turn.deliveries'),
    deliveredEvidenceIds: parse
      .array(turn.deliveredEvidenceIds, 'turn.deliveredEvidenceIds')
      .map((id) => parse.text(id, 'evidence ID')),
    validation: turn.validation,
    review: turn.review,
    reply: { text, response, functionCalls },
  };
}

export type DeliveredIntentionTurn = ReturnType<typeof parseTurn>;

function evidenceIds(value: unknown, known: ReadonlySet<string>): string[] {
  const ids = parse
    .array(value, 'evidence IDs')
    .map((id) => parse.text(id, 'evidence ID'));

  if (new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new parse.EvaluationError(
      'Evidence delivery contains unknown or duplicate IDs.',
    );
  }

  return ids;
}

/*
 * Reconstruct delivery from completed requests, separately for each conversation.
 * Initial reviewer context comes from its writer, tools stay in their origin,
 * and feedback transfers only a previous reviewer's delivered source content.
 * Search receipts retain direct tool delivery separately; they do not infer that
 * feedback transferred navigation. Throw on inconsistent receipts before any
 * saved citation or investigation claim can reach the judge.
 */
export function parseDeliveredTurns(
  investigation: Record<string, unknown>,
  context: IntentionDeliveryContext,
) {
  const turns = parse
    .array(investigation.turns, 'investigation.turns')
    .map((value, index) =>
      parseTurn(value, index, context.provider ?? 'openai'),
    );
  const tools = parse
    .array(investigation.tools, 'investigation.tools')
    .map((value) => parse.object(value, 'tool'));
  const toolEvidence = parseIntentionToolEvidence(tools, context);
  const searches: IntentionSearchReceipt[] = [];
  const known = new Set(context.sources.map((source) => source.evidenceId));
  const conversations = new Map<
    string,
    {
      role: DeliveredIntentionTurn['role'];
      delivered: Set<string>;
      callIds: Set<string>;
      generationNumber: number;
    }
  >();
  const deliveredTools = new Set<number>();
  const requestedTools: {
    turn: DeliveredIntentionTurn;
    call: DeliveredIntentionTurn['reply']['functionCalls'][number];
  }[] = [];

  for (const turn of turns) {
    let conversation = conversations.get(turn.conversationId);
    const first = conversation === undefined;

    if (!conversation) {
      conversation = {
        role: turn.role,
        delivered: new Set(),
        callIds: new Set(),
        generationNumber: 0,
      };
      conversations.set(turn.conversationId, conversation);
    }

    const validOrigin =
      turn.role === 'writer'
        ? turn.conversationId === 'writer'
        : intentionReviewers.some(
            (reviewer) =>
              turn.conversationId ===
              `reviewer-${reviewer}-${String(turn.candidateNumber)}`,
          );

    if (
      conversation.role !== turn.role ||
      !validOrigin ||
      turn.generationNumber !== conversation.generationNumber + 1
    ) {
      throw new parse.EvaluationError(
        'Turn has an inconsistent conversation origin or local generation number.',
      );
    }

    conversation.generationNumber = turn.generationNumber;

    let initials = 0;
    let feedbacks = 0;

    for (const value of turn.deliveries) {
      const receipt = parse.object(value, 'delivery');
      const kind = parse.choice(
        receipt.kind,
        ['initial', 'tool', 'review_feedback'],
        'delivery.kind',
      );
      let ids: readonly string[];

      if (kind === 'initial') {
        initials += 1;
        ids = evidenceIds(receipt.evidenceIds, known);
        const writer = turns.find(
          (candidate) =>
            candidate.role === 'writer' &&
            candidate.candidateNumber === turn.candidateNumber &&
            candidate.reply.functionCalls.length === 0,
        );
        const expected =
          turn.role === 'writer'
            ? context.initialEvidenceIds
            : writer?.deliveredEvidenceIds;

        if (
          !first ||
          !isDeepStrictEqual(ids, expected) ||
          (turn.role === 'reviewer' &&
            (!writer || writer.number >= turn.number))
        ) {
          throw new parse.EvaluationError(
            'Initial evidence differs from the original diff or the reviewed writer snapshot.',
          );
        }
      } else if (kind === 'review_feedback') {
        feedbacks += 1;
        ids = evidenceIds(receipt.evidenceIds, known);
        const numbers = parseReviewTurnNumbers(receipt.reviewTurnNumbers);
        const reviews = intentionReviewers.map((reviewer) => {
          const review = turns[numbers[reviewer] - 1];

          if (
            turn.role !== 'writer' ||
            !review ||
            review.role !== 'reviewer' ||
            review.number >= turn.number ||
            review.candidateNumber !== turn.candidateNumber - 1 ||
            review.conversationId !==
              `reviewer-${reviewer}-${String(review.candidateNumber)}` ||
            review.reply.functionCalls.length > 0
          ) {
            throw new parse.EvaluationError(
              'Review feedback must name all previous candidate reviewer terminals.',
            );
          }

          return review;
        });
        const delivered = new Set(
          reviews.flatMap((review) => review.deliveredEvidenceIds),
        );

        if (ids.some((id) => !delivered.has(id))) {
          throw new parse.EvaluationError(
            'Feedback evidence was not delivered to any referenced reviewer.',
          );
        }
      } else {
        const number = parse.integer(receipt.toolNumber, 'delivery.toolNumber');
        const tool = tools[number - 1];
        const previous = turns
          .filter(
            (candidate) =>
              candidate.number < turn.number &&
              candidate.conversationId === turn.conversationId,
          )
          .at(-1);

        if (
          !previous ||
          !tool ||
          tool.number !== number ||
          deliveredTools.has(number) ||
          tool.status !== 'complete' ||
          tool.delivered !== true ||
          tool.role !== turn.role ||
          tool.candidateNumber !== turn.candidateNumber ||
          tool.conversationId !== turn.conversationId ||
          tool.turnNumber !== previous.number
        ) {
          throw new parse.EvaluationError(
            'Tool delivery must follow its completed tool in the same conversation.',
          );
        }

        const evidence = toolEvidence[number - 1];

        if (!evidence) {
          throw new parse.EvaluationError(
            'Tool delivery has no validated packet.',
          );
        }

        ids = evidence.evidenceIds;
        deliveredTools.add(number);

        if (evidence.search) {
          searches.push({
            ...evidence.search,
            toolNumber: number,
            conversationId: turn.conversationId,
            role: turn.role,
            candidateNumber: turn.candidateNumber,
            requestingTurnNumber: previous.number,
            deliveredTurnNumber: turn.number,
          });
        }
      }

      for (const id of ids) {
        conversation.delivered.add(id);
      }
    }

    if (
      initials !== (first ? 1 : 0) ||
      feedbacks > 1 ||
      !isDeepStrictEqual(turn.deliveredEvidenceIds, [...conversation.delivered])
    ) {
      throw new parse.EvaluationError(
        'Turn evidence snapshot disagrees with cumulative delivery receipts.',
      );
    }

    for (const call of turn.reply.functionCalls) {
      if (conversation.callIds.has(call.call_id)) {
        throw new parse.EvaluationError(
          'A conversation repeats a tool call ID.',
        );
      }

      conversation.callIds.add(call.call_id);
      requestedTools.push({ turn, call });
    }
  }

  if (
    tools.length !== requestedTools.length ||
    deliveredTools.size !== tools.length
  ) {
    throw new parse.EvaluationError(
      'A completed investigation contains missing, extra or undelivered tools.',
    );
  }

  const requests = new Map(
    requestedTools.map((requested) => [
      `${String(requested.turn.number)}:${requested.call.call_id}`,
      requested,
    ]),
  );
  const matched = new Set<string>();

  for (const [index, tool] of tools.entries()) {
    const call = parse.object(tool.call, 'tool.call');
    const key = `${String(tool.turnNumber)}:${parse.text(call.call_id, 'tool call ID')}`;
    const requested = requests.get(key);

    if (
      !requested ||
      matched.has(key) ||
      tool.number !== index + 1 ||
      !isDeepStrictEqual(call, requested.call)
    ) {
      throw new parse.EvaluationError(
        'Tool records differ from the requesting provider calls.',
      );
    }

    matched.add(key);
  }

  return { turns, searches };
}

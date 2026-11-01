import { isDeepStrictEqual } from 'node:util';
import { decodeModelReply } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import type { RetainedSource } from '@daphne/context-engine';
import type { ReviewIdentity } from '@daphne/review-evidence/contracts';
import * as parse from '../parse.js';

export interface IntentionDeliveryContext {
  provider?: ModelProvider;
  identity: ReviewIdentity;
  sources: readonly RetainedSource[];
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
    turn.generationNumber !== number ||
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
 * Verify a tool's serialized source bytes against both its raw result and the
 * retained snapshot. A saved delivered flag alone cannot authorize citations.
 * Navigation observations remain outside the judge packet.
 */
function toolEvidence(
  tool: Record<string, unknown>,
  context: IntentionDeliveryContext,
): string[] {
  const result = parse.object(tool.result, 'tool.result');
  const request = parse.object(tool.request, 'tool.request');
  const call = parse.object(tool.call, 'tool.call');
  const args: unknown = JSON.parse(
    parse.text(call.arguments, 'tool.call.arguments'),
  );
  const expectedRequest = {
    ...parse.object(args, 'tool arguments'),
    name: call.name,
  };
  const returnedRequest = parse.object(result.request, 'tool.result.request');
  const output: unknown = JSON.parse(parse.text(tool.output, 'tool.output'));
  const serialized = parse.object(output, 'tool output');
  const packet: unknown = JSON.parse(
    parse.text(serialized.context, 'tool output.context'),
  );
  const rendered = parse.object(packet, 'tool context');
  const sources = parse
    .array(result.entries, 'tool.result.entries')
    .flatMap((value) => {
      const entry = parse.object(value, 'tool entry');
      if (entry.kind !== 'source') {
        return [];
      }

      const retained = context.sources.find((source) =>
        isDeepStrictEqual(source.source, entry.source),
      );

      if (!retained) {
        throw new parse.EvaluationError(
          'Tool source bytes differ from retained evidence.',
        );
      }

      return [retained];
    });
  const distinct = [
    ...new Map(sources.map((source) => [source.evidenceId, source])).values(),
  ];
  const ids = distinct.map((source) => source.evidenceId);

  if (
    !isDeepStrictEqual(request, expectedRequest) ||
    Object.entries(request).some(
      ([key, value]) => !isDeepStrictEqual(value, returnedRequest[key]),
    ) ||
    !isDeepStrictEqual(result.identity, context.identity) ||
    !isDeepStrictEqual(serialized.request, result.request) ||
    !isDeepStrictEqual(serialized.completeness, result.completeness) ||
    !isDeepStrictEqual(serialized.nextCursor, result.nextCursor) ||
    !isDeepStrictEqual(serialized.notices, result.notices) ||
    rendered.format !== 'daphne-context-v1' ||
    !isDeepStrictEqual(rendered.identity, context.identity) ||
    !isDeepStrictEqual(rendered.sources, distinct) ||
    !isDeepStrictEqual(rendered.omittedEvidenceIds, []) ||
    rendered.omittedObservationCount !== 0 ||
    !isDeepStrictEqual(tool.includedEvidenceIds, ids)
  ) {
    throw new parse.EvaluationError(
      'Tool request, result, serialized output or evidence receipt disagree.',
    );
  }

  return ids;
}

/*
 * Reconstruct delivery from completed requests, separately for each conversation.
 * Initial reviewer context comes from its writer, tools stay in their origin,
 * and feedback transfers only a previous reviewer's delivered source content.
 * Throw on inconsistent receipts before any saved citation can reach the judge.
 */
export function parseDeliveredTurns(
  investigation: Record<string, unknown>,
  context: IntentionDeliveryContext,
): DeliveredIntentionTurn[] {
  const turns = parse
    .array(investigation.turns, 'investigation.turns')
    .map((value, index) =>
      parseTurn(value, index, context.provider ?? 'openai'),
    );
  const tools = parse
    .array(investigation.tools, 'investigation.tools')
    .map((value) => parse.object(value, 'tool'));
  const known = new Set(context.sources.map((source) => source.evidenceId));
  const conversations = new Map<
    string,
    {
      role: DeliveredIntentionTurn['role'];
      delivered: Set<string>;
      callIds: Set<string>;
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
      };
      conversations.set(turn.conversationId, conversation);
    }

    if (
      conversation.role !== turn.role ||
      turn.conversationId !==
        (turn.role === 'writer'
          ? 'writer'
          : `reviewer-${String(turn.candidateNumber)}`)
    ) {
      throw new parse.EvaluationError(
        'Turn has an inconsistent conversation origin.',
      );
    }

    let initials = 0;
    let feedbacks = 0;

    for (const value of turn.deliveries) {
      const receipt = parse.object(value, 'delivery');
      const kind = parse.choice(
        receipt.kind,
        ['initial', 'tool', 'review_feedback'],
        'delivery.kind',
      );
      let ids: string[];

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
        const review =
          turns[
            parse.integer(receipt.reviewTurnNumber, 'reviewTurnNumber') - 1
          ];

        if (
          turn.role !== 'writer' ||
          !review ||
          review.role !== 'reviewer' ||
          review.number >= turn.number ||
          review.candidateNumber !== turn.candidateNumber - 1 ||
          review.reply.functionCalls.length > 0 ||
          ids.some((id) => !review.deliveredEvidenceIds.includes(id))
        ) {
          throw new parse.EvaluationError(
            'Review feedback must refer to the previous candidate’s completed reviewer delivery.',
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
          !tool ||
          tool.number !== number ||
          number !== deliveredTools.size + 1 ||
          deliveredTools.has(number) ||
          tool.status !== 'complete' ||
          tool.delivered !== true ||
          tool.role !== turn.role ||
          tool.candidateNumber !== turn.candidateNumber ||
          tool.conversationId !== turn.conversationId ||
          tool.turnNumber !== previous?.number
        ) {
          throw new parse.EvaluationError(
            'Tool delivery must follow its completed tool in the same conversation.',
          );
        }

        ids = toolEvidence(tool, context);
        deliveredTools.add(number);
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

  for (const [index, requested] of requestedTools.entries()) {
    const tool = tools[index];

    if (
      !tool ||
      tool.number !== index + 1 ||
      tool.turnNumber !== requested.turn.number ||
      !isDeepStrictEqual(tool.call, requested.call)
    ) {
      throw new parse.EvaluationError(
        'Tool records differ from the requesting provider calls.',
      );
    }
  }

  return turns;
}

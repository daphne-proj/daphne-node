import { isDeepStrictEqual } from 'node:util';
import { decodeModelReply } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import type { EvidenceSnapshot } from '@daphne/context-engine';
import { parseToolEvidence } from './artifact-tools.js';
import type { WriterSearchReceipt } from './artifact-tools.js';
import type { ReviewIdentity } from '@daphne/review-evidence/contracts';
import * as parse from './parse.js';

/* The trace reader supplies one validated ledger; query history never expands source citation eligibility. */
export interface WriterDeliveryContext {
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
  const instructions = parse.text(turn.instructions, 'turn.instructions');

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
    instructions,
    candidateNumber,
    generationNumber: parse.integer(
      turn.generationNumber,
      'turn.generationNumber',
    ),
    role: parse.choice(turn.role, ['writer'], 'turn.role'),
    conversationId: parse.choice(
      turn.conversationId,
      ['writer'],
      'turn.conversationId',
    ),
    deliveries: parse.array(turn.deliveries, 'turn.deliveries'),
    deliveredEvidenceIds: parse
      .array(turn.deliveredEvidenceIds, 'turn.deliveredEvidenceIds')
      .map((id) => parse.text(id, 'evidence ID')),
    validation: turn.validation,
    reply: { text, response, functionCalls },
  };
}

type DeliveredWriterTurn = ReturnType<typeof parseTurn>;

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
 * Reconstruct the continuing writer's delivery before validating saved citations.
 * For example, a tool receipt must follow its requesting turn and refer to a
 * completed, delivered tool. Search receipts retain navigation separately from
 * citable source bytes. Complete runs require every tool to be delivered; failed
 * runs may end with pending or unexecuted calls. Inconsistent records throw before
 * either evaluator can trust the saved context.
 */
export function parseDeliveredTurns(
  investigation: Record<string, unknown>,
  context: WriterDeliveryContext,
) {
  const turns = parse
    .array(investigation.turns, 'investigation.turns')
    .map((value, index) =>
      parseTurn(value, index, context.provider ?? 'openai'),
    );
  const tools = parse
    .array(investigation.tools, 'investigation.tools')
    .map((value) => parse.object(value, 'tool'));
  const complete = investigation.status === 'complete';
  const completedTools = tools.filter(
    (tool) =>
      parse.choice(tool.status, ['complete', 'failed'], 'tool.status') ===
      'complete',
  );
  const packets = parseToolEvidence(completedTools, context);
  const toolEvidence = new Map(
    completedTools.map((tool, index) => [
      parse.integer(tool.number, 'tool.number'),
      packets[index],
    ]),
  );
  const searches: WriterSearchReceipt[] = [];
  const known = new Set(context.sources.map((source) => source.evidenceId));
  const delivered = new Set<string>();
  const callIds = new Set<string>();
  const deliveredTools = new Set<number>();
  const requestedTools: {
    turn: DeliveredWriterTurn;
    call: DeliveredWriterTurn['reply']['functionCalls'][number];
  }[] = [];

  for (const turn of turns) {
    const first = turn.number === 1;

    if (turn.generationNumber !== turn.number) {
      throw new parse.EvaluationError(
        'Writer generation numbers must follow the recorded turn order.',
      );
    }

    let initials = 0;

    for (const value of turn.deliveries) {
      const receipt = parse.object(value, 'delivery');
      const kind = parse.choice(
        receipt.kind,
        ['initial', 'tool'],
        'delivery.kind',
      );
      let ids: readonly string[];

      if (kind === 'initial') {
        initials += 1;
        ids = evidenceIds(receipt.evidenceIds, known);

        if (!first || !isDeepStrictEqual(ids, context.initialEvidenceIds)) {
          throw new parse.EvaluationError(
            'Initial evidence differs from the original diff.',
          );
        }
      } else {
        const number = parse.integer(receipt.toolNumber, 'delivery.toolNumber');
        const tool = tools[number - 1];
        const previous = turns[turn.number - 2];

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

        const evidence = toolEvidence.get(number);

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
        delivered.add(id);
      }
    }

    if (
      initials !== (first ? 1 : 0) ||
      !isDeepStrictEqual(turn.deliveredEvidenceIds, [...delivered])
    ) {
      throw new parse.EvaluationError(
        'Turn evidence snapshot disagrees with cumulative delivery receipts.',
      );
    }

    for (const call of turn.reply.functionCalls) {
      if (callIds.has(call.call_id)) {
        throw new parse.EvaluationError(
          'A conversation repeats a tool call ID.',
        );
      }

      callIds.add(call.call_id);
      requestedTools.push({ turn, call });
    }
  }

  if (
    tools.length > requestedTools.length ||
    (complete &&
      (tools.length !== requestedTools.length ||
        deliveredTools.size !== tools.length)) ||
    completedTools.some(
      (tool) =>
        tool.delivered !==
        deliveredTools.has(parse.integer(tool.number, 'tool.number')),
    )
  ) {
    throw new parse.EvaluationError(
      'Tool completion or delivery disagrees with recorded replies.',
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
      requested !== requestedTools[index] ||
      matched.has(key) ||
      (tool.status === 'failed' &&
        (complete ||
          index !== tools.length - 1 ||
          deliveredTools.has(index + 1))) ||
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

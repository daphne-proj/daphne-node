import { setImmediate } from 'node:timers/promises';
import type { ContextEngine } from '@daphne/context-engine';
import type { RunBudget } from '@daphne/evaluator-optimizer';
import { ModelError } from '@daphne/llm';
import type { createOpenAI, ModelRequest } from '@daphne/llm';
import type {
  IntentionEvidenceDelivery,
  IntentionsOptions,
  IntentionsResult,
  IntentionToolRecord,
  IntentionTurn,
} from './contracts.js';
import { intentionsLimits } from './limits.js';
import { executeIntentionTool, intentionsTools } from './tools.js';

/*
 * A writer candidate references its retained terminal reply instead of copying
 * the provider payload. The workflow validates using this completed delivery
 * snapshot, so later conversations cannot make earlier citations eligible.
 */
export interface IntentionCandidate {
  writerTurnNumber: number;
  deliveredEvidenceIds: readonly string[];
}

/*
 * Keep replay, call IDs and unconfirmed delivery local to one conversation.
 * A continuing writer updates candidateNumber before each proposal attempt;
 * a reviewer uses a separate instance even when both borrow the same runtime.
 */
export interface IntentionConversation {
  role: 'writer' | 'reviewer';
  conversationId: string;
  candidateNumber: number;
  instructions: string;
  schema: { name: string; schema: object };
  history: Record<string, unknown>[];
  deliveredEvidenceIds: Set<string>;
  pendingDeliveries: IntentionEvidenceDelivery[];
  pendingTools: Extract<IntentionToolRecord, { status: 'complete' }>[];
  callIds: Set<string>;
}

/* Borrow one client, evidence store and budget; shared runtimes execute conversations sequentially. */
export interface IntentionConversationRuntime {
  model: ReturnType<typeof createOpenAI>;
  engine: ContextEngine;
  executeTool: IntentionsOptions['executeTool'];
  budget: RunBudget;
  maxInputTokens: number;
  progress: Pick<IntentionsResult, 'turns' | 'tools' | 'calls'>;
}

export interface IntentionConversationReply {
  turnNumber: number;
  deliveredEvidenceIds: readonly string[];
}

/* Seed a conversation with the exact source IDs included in its initial history, not all retained sources. */
export function createIntentionConversation(
  input: Pick<
    IntentionConversation,
    | 'role'
    | 'conversationId'
    | 'candidateNumber'
    | 'instructions'
    | 'schema'
    | 'history'
  >,
  initialEvidenceIds: readonly string[],
): IntentionConversation {
  return {
    ...input,
    deliveredEvidenceIds: new Set(),
    pendingDeliveries: [
      { kind: 'initial', evidenceIds: [...initialEvidenceIds] },
    ],
    pendingTools: [],
    callIds: new Set(),
  };
}

export function checkIntentionCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelError(
      'The intentions investigation was cancelled or timed out.',
      { cause: signal.reason },
    );
  }
}

function modelRequest(conversation: IntentionConversation): ModelRequest {
  return {
    instructions: conversation.instructions,
    input: conversation.history,
    tools: intentionsTools,
    parallel_tool_calls: false,
    max_output_tokens: intentionsLimits.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: conversation.schema.name,
        strict: true,
        schema: conversation.schema.schema,
      },
    },
  };
}

/*
 * Continue one conversation through sequential tool calls until a terminal reply.
 * Tool continuations help produce one candidate; they are not proposal revisions.
 * The workflow's evaluator-optimizer loop owns validation and candidate counting.
 * For example, a source-read result becomes citable only after the next successful
 * generation receives it. Failed requests leave receipts pending; completed turns
 * and tools remain in progress on failure. A terminal reply is returned even when
 * cancellation arrives with it, allowing the runner to retain the candidate before
 * rejecting acceptance. An aborted tool-request reply never starts more tools.
 */
export async function runIntentionConversation(
  conversation: IntentionConversation,
  runtime: IntentionConversationRuntime,
): Promise<IntentionConversationReply> {
  const { model, engine, executeTool, budget, maxInputTokens, progress } =
    runtime;

  for (;;) {
    checkIntentionCancellation(budget.signal);
    const request = modelRequest(conversation);

    if (
      Buffer.byteLength(JSON.stringify(request)) >
      intentionsLimits.maxRequestBytes
    ) {
      throw new ModelError(
        'The complete intentions request exceeds the 8 MiB byte budget.',
      );
    }

    /* Count the instructions, schema, tools and entire replay history on every turn. */
    const inputTokens = await model.count(request);
    checkIntentionCancellation(budget.signal);

    if (inputTokens > maxInputTokens) {
      throw new ModelError(
        'The intentions request exceeds the input token budget.',
      );
    }

    const reply = await model.generate(request);

    for (const receipt of conversation.pendingDeliveries) {
      if (receipt.kind === 'initial') {
        for (const id of receipt.evidenceIds) {
          conversation.deliveredEvidenceIds.add(id);
        }
      }
    }

    for (const tool of conversation.pendingTools) {
      tool.delivered = true;

      for (const id of tool.includedEvidenceIds) {
        conversation.deliveredEvidenceIds.add(id);
      }
    }

    const recorded = {
      number: progress.turns.length + 1,
      candidateNumber: conversation.candidateNumber,
      conversationId: conversation.conversationId,
      generationNumber: model.calls.generate,
      deliveries: conversation.pendingDeliveries,
      deliveredEvidenceIds: [...conversation.deliveredEvidenceIds],
      inputTokens,
      reply,
    };

    const turn: IntentionTurn =
      conversation.role === 'writer'
        ? { ...recorded, role: 'writer', validation: null }
        : { ...recorded, role: 'reviewer' };

    progress.turns.push(turn);

    conversation.pendingDeliveries = [];
    conversation.pendingTools = [];

    conversation.history.push(...reply.output);

    const calls = reply.functionCalls ?? [];

    if (calls.length === 0) {
      return {
        turnNumber: turn.number,
        deliveredEvidenceIds: turn.deliveredEvidenceIds,
      };
    }

    checkIntentionCancellation(budget.signal);

    for (const call of calls) {
      if (conversation.callIds.has(call.call_id)) {
        throw new ModelError(
          'The model reused a function call ID in this conversation.',
        );
      }

      conversation.callIds.add(call.call_id);
    }

    for (const call of calls) {
      checkIntentionCancellation(budget.signal);

      progress.calls.tools += 1;

      const tool = await executeIntentionTool(call, engine, executeTool, {
        number: progress.tools.length + 1,
        role: conversation.role,
        candidateNumber: conversation.candidateNumber,
        conversationId: conversation.conversationId,
        turnNumber: turn.number,
      });

      progress.tools.push(tool);

      if (tool.status === 'failed') {
        throw tool.error;
      }

      conversation.history.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: tool.output,
      });

      conversation.pendingTools.push(tool);
      conversation.pendingDeliveries.push({
        kind: 'tool',
        toolNumber: tool.number,
      });
    }

    /* Let cancellation timers run even when borrowed tools and model callbacks resolve immediately. */
    await setImmediate();
  }
}

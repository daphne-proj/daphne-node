import type { ContextEngine } from '@daphne/context-engine';
import type { RunBudget } from '@daphne/evaluator-optimizer';
import { ModelError, runModelConversation } from '@daphne/llm';
import type { createOpenAI, ModelConversation } from '@daphne/llm';
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
 * Keep replay and unconfirmed delivery local to one conversation.
 * A continuing writer updates candidateNumber before each proposal attempt;
 * a reviewer uses a separate instance even when both borrow the same runtime.
 */
export interface IntentionConversation extends ModelConversation {
  role: 'writer' | 'reviewer';
  conversationId: string;
  candidateNumber: number;
  instructions: string;
  schema: { name: string; schema: object };

  /* A successful reply confirmed these sources reached this conversation. */
  deliveredEvidenceIds: Set<string>;
  /* Delivery receipts await this conversation's next successful reply. */
  pendingDeliveries: IntentionEvidenceDelivery[];
  /* Completed tools await confirmation that their outputs were delivered. */
  pendingTools: Extract<IntentionToolRecord, { status: 'complete' }>[];
}

/* Borrow one client, evidence store and budget; shared runtimes execute conversations sequentially. */
export interface IntentionConversationRuntime {
  model: ReturnType<typeof createOpenAI>;
  engine: ContextEngine;
  executeTool: IntentionsOptions['executeTool'];
  budget: RunBudget;
  maxInputTokens: number;
  progress: Pick<IntentionsResult, 'turns' | 'tools' | 'calls'>;
  /* Attribute the shared client's observations before counting or generating, including failures. */
  onConversation?: (conversation: IntentionConversation) => void;
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

/*
 * Continue one writer or reviewer conversation until the model replies without
 * requesting tools. runIntentions uses that reply as a writer candidate;
 * reviewIntentionCandidate uses it as a review report. Those callers validate
 * the content and decide whether it can be accepted.
 *
 * Delegate request counting, model calls, history replay and sequential tools to
 * runModelConversation. Its callbacks record each completed turn and tool outcome
 * in runtime.progress, with the role, conversation and candidate that produced it.
 *
 * A tool request is part of a model reply. Daphne runs the requested tool after
 * receiving that reply, then includes its result in the next request in the same
 * conversation. Reading a new source therefore stores it before the model sees it.
 * Treat a successful reply to that next request as confirmation of delivery, and
 * save the confirmed source IDs on the turn for later citation validation. Failed
 * requests leave delivery unconfirmed.
 *
 * Writer and reviewer histories are separate. A source sent only to the reviewer
 * cannot be cited by the writer until a writer request includes it and succeeds.
 *
 * Mutate the supplied conversation and shared progress in place. Reuse the writer
 * across revisions, but create a separate conversation for each review. Execute
 * conversations sequentially when sharing the client, evidence store and budget.
 *
 * Return the terminal turn's number and evidence snapshot; its full reply remains
 * in progress.turns. Errors propagate while completed work stays recorded, and
 * failed requests leave pending delivery unconfirmed. If cancellation arrives
 * with a terminal reply, still return it so the caller can retain it before
 * rejecting acceptance. Cancellation prevents starting further tools.
 */
export async function runIntentionConversation(
  conversation: IntentionConversation,
  runtime: IntentionConversationRuntime,
): Promise<IntentionConversationReply> {
  const { model, engine, executeTool, budget, maxInputTokens, progress } =
    runtime;

  /*
   * Identify the active conversation before counting or generating so model-call
   * records, including failures, carry its role, conversation ID and candidate number.
   */
  runtime.onConversation?.(conversation);

  const terminal = await runModelConversation(conversation, {
    model,
    signal: budget.signal,
    maxInputTokens,
    maxRequestBytes: intentionsLimits.maxRequestBytes,
    request: {
      instructions: conversation.instructions,
      tools: intentionsTools,
      /* Batch independent reads into one reply; the shared loop executes them sequentially. */
      parallel_tool_calls: true,
      max_output_tokens: intentionsLimits.maxOutputTokens,
      text: {
        format: {
          type: 'json_schema',
          name: conversation.schema.name,
          strict: true,
          schema: conversation.schema.schema,
        },
      },
    },
    recordTurn(reply, inputTokens): IntentionTurn {
      for (const receipt of conversation.pendingDeliveries) {
        if (receipt.kind !== 'tool') {
          for (const id of receipt.evidenceIds) {
            conversation.deliveredEvidenceIds.add(id);
          }
        }
      }

      /* These tools already ran; this successful
      reply confirms delivery of their outputs in its request. */
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
          : { ...recorded, role: 'reviewer', review: null };

      progress.turns.push(turn);

      conversation.pendingDeliveries = [];
      conversation.pendingTools = [];

      return turn;
    },
    async executeTool(call, turn) {
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

      conversation.pendingTools.push(tool);
      conversation.pendingDeliveries.push({
        kind: 'tool',
        toolNumber: tool.number,
      });

      return tool.output;
    },
  });

  return {
    turnNumber: terminal.number,
    deliveredEvidenceIds: terminal.deliveredEvidenceIds,
  };
}

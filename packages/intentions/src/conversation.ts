import type { RunBudget } from '@daphne/evaluator-optimizer';
import { ModelError, runModelConversation } from '@daphne/llm';
import type {
  ModelClient,
  ModelConversation,
  ModelFunctionCall,
  ModelRequest,
} from '@daphne/llm';
import type {
  IntentionEvidenceDelivery,
  IntentionsResult,
  IntentionToolRecord,
  IntentionTurn,
} from './contracts.js';
import { intentionsLimits } from './limits.js';
import { intentionsTools } from './tools.js';

/*
 * A writer candidate references its retained terminal reply instead of copying
 * the provider payload. The workflow validates using this completed delivery
 * snapshot, so later source reads cannot make earlier citations eligible.
 */
export interface IntentionCandidate {
  writerTurnNumber: number;
  deliveredEvidenceIds: readonly string[];
}

/*
 * Keep replay and unconfirmed delivery local to one conversation.
 * The continuing writer updates candidateNumber before each proposal attempt.
 */
export interface IntentionConversation extends ModelConversation {
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

/*
 * Supply runIntentionConversation with its client, limits and shared recording.
 * The tool runner retains evidence internally; conversations only need its
 * results to track delivery. Reuse this runtime for the same writer's revisions.
 */
export interface IntentionConversationRuntime {
  model: ModelClient;
  reasoning: ModelRequest['reasoning'];
  runTool: (
    call: ModelFunctionCall,
    turn: IntentionTurn,
  ) => Promise<IntentionToolRecord>;
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
    'candidateNumber' | 'instructions' | 'schema' | 'history'
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
 * Continue the writer until it replies without requesting tools; runIntentions
 * validates that terminal draft. Reuse this conversation/runtime for repairs,
 * for example after appending citation diagnostics to its history.
 *
 * runModelConversation counts complete requests, replays provider output and
 * executes tools sequentially. These callbacks retain replies and tool outcomes,
 * marking source delivery only when a completed reply confirms the containing
 * request. Reading or counting source alone never makes it citable.
 *
 * Mutate the supplied history and progress in place. Errors propagate with
 * completed work retained. A terminal reply arriving with cancellation is still
 * returned for retention; the caller must reject acceptance. Cancellation prevents
 * starting further tools, and failed requests leave delivery unconfirmed.
 */
export async function runIntentionConversation(
  conversation: IntentionConversation,
  runtime: IntentionConversationRuntime,
): Promise<IntentionConversationReply> {
  const { model, budget, maxInputTokens, progress } = runtime;

  const terminal = await runModelConversation(conversation, {
    model,
    signal: budget.signal,
    maxInputTokens,
    maxRequestBytes: intentionsLimits.maxRequestBytes,
    request: {
      ...(runtime.reasoning === undefined
        ? {}
        : { reasoning: runtime.reasoning }),
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
        if (receipt.kind === 'initial') {
          for (const id of receipt.evidenceIds) {
            conversation.deliveredEvidenceIds.add(id);
          }
        }
      }

      /* This completed reply confirms that the request delivered these tool outputs. */
      for (const tool of conversation.pendingTools) {
        tool.delivered = true;

        for (const id of tool.includedEvidenceIds) {
          conversation.deliveredEvidenceIds.add(id);
        }
      }

      const turn: IntentionTurn = {
        role: 'writer',
        validation: null,
        /* Preserve the actual prompt even when the provider does not echo it. */
        instructions: conversation.instructions,
        number: progress.turns.length + 1,
        candidateNumber: conversation.candidateNumber,
        conversationId: 'writer',
        generationNumber: model.calls.generate,
        deliveries: conversation.pendingDeliveries,
        deliveredEvidenceIds: [...conversation.deliveredEvidenceIds],
        inputTokens,
        reply,
      };

      progress.turns.push(turn);

      conversation.pendingDeliveries = [];
      conversation.pendingTools = [];

      return turn;
    },
    async executeTool(call, turn) {
      const tool = await runtime.runTool(call, turn);

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

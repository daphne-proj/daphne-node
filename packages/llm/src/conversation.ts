import { setImmediate } from 'node:timers/promises';
import { ModelError } from './openai.js';
import type {
  createOpenAI,
  ModelFunctionCall,
  ModelReply,
  ModelRequest,
} from './openai.js';

/*
 * One caller-owned conversation, continued in place across terminal replies.
 * For example, append repair feedback to history before calling again; keep the
 * same call-ID set so later replies cannot reuse an earlier tool invocation.
 */
export interface ModelConversation {
  history: Record<string, unknown>[];
  callIds: Set<string>;
}

/*
 * Borrow an existing client and tools bound to the same signal. The caller owns
 * request settings and validated capacity limits; no run policy is created here.
 * recordTurn synchronously retains a completed reply and returns its reference,
 * which executeTool can use for diagnostic records. Both callbacks are required
 * work, not optional observers, and their original failures propagate.
 */
export interface ModelConversationOptions<Turn> {
  model: ReturnType<typeof createOpenAI>;
  request: Omit<ModelRequest, 'input'>;
  maxInputTokens: number;
  maxRequestBytes: number;
  signal: AbortSignal;
  recordTurn: (reply: ModelReply, inputTokens: number) => Turn;
  executeTool: (call: ModelFunctionCall, turn: Turn) => Promise<string>;
}

/*
 * Count each complete request, record its reply, replay every provider output
 * item and execute tool calls sequentially until a terminal reply. Return the
 * exact caller-retained turn, even if cancellation arrived with that reply, so an
 * outer evaluator can retain its candidate before rejecting acceptance. Aborted
 * tool-request replies are recorded but never start tools. Completed outputs stay
 * in the supplied history on later failure; errors propagate without retries.
 */
export async function runModelConversation<Turn>(
  conversation: ModelConversation,
  options: ModelConversationOptions<Turn>,
): Promise<Turn> {
  const {
    model,
    request: settings,
    maxInputTokens,
    maxRequestBytes,
    signal,
    recordTurn,
    executeTool,
  } = options;

  for (;;) {
    signal.throwIfAborted();

    const request: ModelRequest = { ...settings, input: conversation.history };

    if (Buffer.byteLength(JSON.stringify(request)) > maxRequestBytes) {
      throw new ModelError(
        'The complete model request exceeds its byte capacity.',
      );
    }

    const inputTokens = await model.count(request);
    signal.throwIfAborted();

    if (inputTokens > maxInputTokens) {
      throw new ModelError(
        'The model request exceeds its input token capacity.',
      );
    }

    const reply = await model.generate(request);
    const turn = recordTurn(reply, inputTokens);
    conversation.history.push(...reply.output);

    const calls = reply.functionCalls ?? [];

    if (calls.length === 0) {
      return turn;
    }

    signal.throwIfAborted();

    for (const call of calls) {
      if (conversation.callIds.has(call.call_id)) {
        throw new ModelError(
          'The model reused a function call ID in this conversation.',
        );
      }

      conversation.callIds.add(call.call_id);
    }

    for (const call of calls) {
      signal.throwIfAborted();

      const output = await executeTool(call, turn);
      conversation.history.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output,
      });
    }

    /* Allow cancellation timers to run even when model and tool callbacks resolve immediately. */
    await setImmediate();
  }
}

import { setImmediate } from 'node:timers/promises';
import { ModelError } from './response.js';
import type {
  ModelClient,
  ModelFunctionCall,
  ModelReply,
  ModelRequest,
} from './contracts.js';

/*
 * One caller-owned conversation, continued in place across terminal replies.
 * For example, append repair feedback to history before calling again.
 */
export interface ModelConversation {
  history: Record<string, unknown>[];
}

/*
 * Borrow an existing client and tools bound to the same signal. The caller owns
 * request settings and validated capacity limits; no run policy is created here.
 * recordTurn synchronously retains a completed reply and returns its reference,
 * which executeTool can use for diagnostic records. Both callbacks are required
 * work, not optional observers, and their original failures propagate.
 */
export interface ModelConversationOptions<Turn> {
  model: ModelClient;
  request: Omit<ModelRequest, 'input'>;
  maxInputTokens: number;
  maxRequestBytes: number;
  signal: AbortSignal;
  recordTurn: (reply: ModelReply, inputTokens: number) => Turn;
  executeTool: (call: ModelFunctionCall, turn: Turn) => Promise<string>;
}

/*
 * Ask the model for a reply, execute any requested tools one at a time, and send
 * their results back until a reply requests no tools. Check the full request's
 * byte and token limits before each generation.
 *
 * Inversion of control: this loop decides when the caller's callbacks run.
 * After each successful generation, call the caller's synchronous recordTurn
 * callback to save the reply and obtain its turn record. Pass that same record
 * to executeTool so tool activity can be linked to the reply that requested it.
 * When a reply requests no tools, return its record. The caller decides whether
 * the reply's content is acceptable.
 *
 * Append provider output and completed tool results to the caller's history.
 * Keep those entries if a later operation fails; propagate errors without retrying.
 *
 * If cancellation arrives with a completed reply, still record it. If it requests
 * no tools, return its record so the caller can preserve it for diagnostics, then
 * check cancellation before accepting it. If it requests tools, check cancellation
 * before starting them; recording a reply does not authorize further work.
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

    /* Messages and tool results sent back to the model */
    conversation.history.push(...reply.output);

    const calls = reply.functionCalls ?? [];

    if (calls.length === 0) {
      return turn;
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

    await setImmediate();
  }
}

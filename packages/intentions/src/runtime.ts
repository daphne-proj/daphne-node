import { createModel } from '@daphne/llm';
import type { ContextEngine } from '@daphne/context-engine';
import type { IntentionsOptions } from './contracts.js';
import type {
  IntentionConversation,
  IntentionConversationRuntime,
} from './conversation.js';
import { executeIntentionTool } from './tools.js';

/*
 * Create this factory once per investigation, then call the returned function
 * for each writer or reviewer conversation. Each gets its own model client, but
 * all share the evidence store, progress records and one tool queue. The queue
 * runs tools one at a time so reviewers cannot interleave evidence updates.
 * Reuse the writer's runtime when revising its proposal. Cancellation is checked
 * before a queued tool calls the host executor. Callers must wait for every
 * reviewer to finish, even after one fails, before returning.
 */
export function createIntentionRuntimeFactory(
  options: IntentionsOptions,
  engine: ContextEngine,
  progress: IntentionConversationRuntime['progress'],
) {
  /** Shared queue ensuring tools run sequentially across conversations. */
  let toolQueueTail = Promise.resolve();
  let toolNumber = 0;

  return function createConversationRuntime(
    conversation: IntentionConversation,
    signal = options.budget.signal,
  ): IntentionConversationRuntime {
    const model = createModel(
      options.provider ?? 'openai',
      options.apiKey,
      options.model,
      signal,
      (event) => {
        progress.calls[event.kind] += 1;
        options.onModelCall?.({
          ...event,
          role: conversation.role,
          candidateNumber: conversation.candidateNumber,
          conversationId: conversation.conversationId,
        });
      },
    );

    return {
      model,
      progress,
      budget: { ...options.budget, signal },
      maxInputTokens: options.maxInputTokens,
      async runTool(call, turn) {
        const number = ++toolNumber;
        progress.calls.tools += 1;

        /** Wait for the previous tool before executing this one */
        const pending = toolQueueTail.then(() =>
          executeIntentionTool(
            call,
            engine,
            async (request) => {
              signal.throwIfAborted();
              return options.executeTool(request);
            },
            {
              number,
              role: turn.role,
              candidateNumber: turn.candidateNumber,
              conversationId: turn.conversationId,
              turnNumber: turn.number,
            },
          ),
        );

        /** Advance the queue, allowing future tools to run even if this one fails */
        toolQueueTail = pending.then(
          () => undefined,
          () => undefined,
        );
        const tool = await pending;
        progress.tools[number - 1] = tool;

        return tool;
      },
    };
  };
}

export type IntentionRuntimeFactory = ReturnType<
  typeof createIntentionRuntimeFactory
>;

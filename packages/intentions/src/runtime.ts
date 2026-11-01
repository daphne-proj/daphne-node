import { createModel } from '@daphne/llm';
import type { ContextEngine } from '@daphne/context-engine';
import type { IntentionsOptions } from './contracts.js';
import type {
  IntentionConversation,
  IntentionConversationRuntime,
} from './conversation.js';
import { executeIntentionTool } from './tools.js';

/* Create once per investigation. Each conversation gets a bound model client;
 * the writer reuses its runtime across repairs. Shared tool work is queued so
 * source identities, retained limits and diagnostic records remain consistent.
 * Callers settle all reviewers before returning, including after failure. */
export function createIntentionRuntime(
  options: IntentionsOptions,
  engine: ContextEngine,
  progress: IntentionConversationRuntime['progress'],
) {
  let tools = Promise.resolve();
  let toolNumber = 0;

  return {
    engine,
    progress,
    budget: options.budget,
    forConversation(
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
        engine,
        progress,
        budget: { ...options.budget, signal },
        maxInputTokens: options.maxInputTokens,
        async runTool(call, turn) {
          const number = ++toolNumber;
          progress.calls.tools += 1;
          const pending = tools.then(() =>
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
          tools = pending.then(
            () => undefined,
            () => undefined,
          );
          const tool = await pending;
          progress.tools[number - 1] = tool;

          return tool;
        },
      };
    },
  };
}

export type IntentionRuntime = ReturnType<typeof createIntentionRuntime>;

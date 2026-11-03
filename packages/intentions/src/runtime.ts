import { createModel } from '@daphne/llm';
import type { ContextEngine } from '@daphne/context-engine';
import type { IntentionsOptions } from './contracts.js';
import type {
  IntentionConversation,
  IntentionConversationRuntime,
} from './conversation.js';
import { executeIntentionTool } from './tools.js';

/*
 * Create one run runtime for runIntentions and pass it to semantic review so
 * evidence, progress, budget and the tool queue belong to the same investigation.
 * For example, runtime.createConversationRuntime(writer) creates the writer's
 * client; reuse that conversation runtime for revisions. Reviewers each get a
 * separate client and their batch's cancellation signal, while tools share one
 * queue. Cancellation is checked before a queued tool calls the host executor.
 * Callers must wait for every reviewer to settle before returning.
 */
export function createIntentionRunRuntime(
  options: IntentionsOptions,
  engine: ContextEngine,
  progress: IntentionConversationRuntime['progress'],
) {
  /** Shared queue ensuring tools run sequentially across conversations. */
  let toolQueueTail = Promise.resolve();
  let toolNumber = 0;

  function createConversationRuntime(
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
  }

  return {
    engine,
    progress,
    budget: options.budget,
    createConversationRuntime,
  } as const;
}

/* Shared investigation resources; create a separate conversation runtime for each reviewer. */
export type IntentionRunRuntime = ReturnType<typeof createIntentionRunRuntime>;

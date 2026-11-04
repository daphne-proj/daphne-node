import { createModel, ModelError } from '@daphne/llm';
import type { ContextEngine } from '@daphne/context-engine';
import type { IntentionsOptions } from './contracts.js';
import type {
  IntentionConversation,
  IntentionConversationRuntime,
} from './conversation.js';
import { executeIntentionTool } from './tools.js';

/*
 * Bind one writer to its model, retained evidence and the host's original budget.
 * runIntentions reuses this runtime across repairs, so observed calls retain the
 * current candidate number and reasoning effort stays fixed (medium for OpenAI, high for Codex).
 * runModelConversation already executes tools in order;
 * each tool checks cancellation before host I/O and retains its outcome on failure.
 */
export function createIntentionRunRuntime(
  options: IntentionsOptions,
  engine: ContextEngine,
  progress: IntentionConversationRuntime['progress'],
  conversation: IntentionConversation,
): IntentionConversationRuntime {
  const { signal } = options.budget;
  const provider = options.provider ?? 'openai';
  const defaultEffort = provider === 'codex' ? 'high' : 'medium';

  if (provider === 'anthropic' && options.reasoningEffort !== undefined) {
    throw new ModelError(
      'Reasoning effort is only supported for OpenAI and Codex.',
    );
  }

  const model = createModel(
    provider,
    options.apiKey,
    options.model,
    signal,
    (event) => {
      progress.calls[event.kind] += 1;
      options.onModelCall?.({
        ...event,
        role: 'writer',
        candidateNumber: conversation.candidateNumber,
        conversationId: 'writer',
      });
    },
  );

  return {
    model,
    reasoning:
      provider !== 'anthropic'
        ? { effort: options.reasoningEffort ?? defaultEffort }
        : undefined,
    progress,
    budget: options.budget,
    maxInputTokens: options.maxInputTokens,
    async runTool(call, turn) {
      const number = ++progress.calls.tools;
      const tool = await executeIntentionTool(
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
      );
      progress.tools[number - 1] = tool;

      return tool;
    },
  };
}

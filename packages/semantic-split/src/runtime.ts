import { createModel, ModelError } from '@daphne/llm';
import type { ContextEngine } from '@daphne/context-engine';
import type { SemanticSplitOptions } from './contracts.js';
import type {
  SplitConversation,
  SplitConversationRuntime,
} from './conversation.js';
import { executeSplitTool } from './tools.js';

/*
 * Bind one writer to its model, retained evidence and the host's original budget.
 * runSemanticSplit reuses this runtime across repairs, so observed calls retain the
 * current candidate number and reasoning effort stays fixed (medium for OpenAI, high for Codex).
 * runModelConversation already executes tools in order;
 * each tool checks cancellation before host I/O and retains its outcome on failure.
 */
export function createSplitRunRuntime(
  options: SemanticSplitOptions,
  engine: ContextEngine,
  progress: SplitConversationRuntime['progress'],
  conversation: SplitConversation,
): SplitConversationRuntime {
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
      const tool = await executeSplitTool(
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

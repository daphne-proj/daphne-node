import { vi } from 'vitest';
import type {
  createOpenAI,
  ModelConversation,
  ModelConversationOptions,
  ModelReply,
  ModelRequest,
} from '@daphne/llm';

export function replyWithCalls(...ids: string[]): ModelReply {
  const functionCalls = ids.map((id) => ({
    id: `item-${id}`,
    call_id: id,
    name: 'read',
    arguments: '{}',
  }));

  return {
    text: ids.length === 0 ? 'Finished.' : '',
    functionCalls,
    output: [
      { type: 'reasoning', encrypted_content: 'opaque' },
      ...functionCalls.map((call) => ({ type: 'function_call', ...call })),
      {
        type: 'message',
        content: [{ type: 'output_text', text: 'Finished.' }],
      },
    ],
    response: { id: 'response' },
  };
}

interface RecordedTurn {
  reply: ModelReply;
  inputTokens: number;
}

/* Replace only model I/O; the real conversation helper owns all protocol decisions. */
export function conversationHarness(replies: ModelReply[]) {
  const controller = new AbortController();
  const counted: ModelRequest[] = [];
  const generated: ModelRequest[] = [];
  const turns: RecordedTurn[] = [];
  const calls = { count: 0, generate: 0 };
  const remaining = [...replies];

  const model = {
    calls,
    count: vi.fn((request: ModelRequest) => {
      calls.count += 1;
      counted.push(structuredClone(request));
      return Promise.resolve(42);
    }),
    generate: vi.fn((request: ModelRequest) => {
      calls.generate += 1;
      generated.push(structuredClone(request));
      const reply = remaining.shift();

      if (!reply) {
        throw new Error('Unexpected generation in the conversation test.');
      }

      return Promise.resolve(reply);
    }),
  } satisfies ReturnType<typeof createOpenAI>;

  const conversation: ModelConversation = {
    history: [{ role: 'user', content: 'Investigate.' }],
    callIds: new Set(),
  };

  const recordTurn = vi.fn((reply: ModelReply, inputTokens: number) => {
    const turn = { reply, inputTokens };
    turns.push(turn);
    return turn;
  });
  const executeTool = vi.fn(() => Promise.resolve('source bytes'));

  const options: ModelConversationOptions<RecordedTurn> = {
    model,
    signal: controller.signal,
    request: {
      instructions: 'Inspect source.',
      tools: [
        {
          type: 'function',
          name: 'read',
          description: 'Read source',
          strict: true,
          parameters: { type: 'object' },
        },
      ],
      parallel_tool_calls: false,
      max_output_tokens: 100,
      text: {
        format: {
          type: 'json_schema',
          name: 'answer',
          strict: true,
          schema: { type: 'object' },
        },
      },
    },
    maxInputTokens: 1000,
    maxRequestBytes: 100_000,
    recordTurn,
    executeTool,
  };

  return {
    conversation,
    options,
    model,
    controller,
    counted,
    generated,
    turns,
    recordTurn,
    executeTool,
  };
}

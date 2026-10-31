import { expect, test } from 'vitest';
import { runModelConversation } from '@daphne/llm';
import { conversationHarness, replyWithCalls } from './conversation.helpers.js';

test('replays every output item and sequential tool result, returning the retained terminal turn', async () => {
  const first = replyWithCalls('a', 'b');
  const terminal = replyWithCalls();
  const harness = conversationHarness([first, terminal]);
  const events: string[] = [];

  harness.options.executeTool = async (call, turn) => {
    expect(turn).toBe(harness.turns[0]);
    events.push(`start ${call.call_id}`);
    await Promise.resolve();
    events.push(`end ${call.call_id}`);
    return `result ${call.call_id}`;
  };

  const result = await runModelConversation(
    harness.conversation,
    harness.options,
  );

  expect(result).toBe(harness.turns[1]);
  expect(result.reply).toBe(terminal);
  expect(events).toEqual(['start a', 'end a', 'start b', 'end b']);
  expect(harness.counted).toEqual(harness.generated);
  expect(harness.counted).toHaveLength(2);
  expect(harness.counted[1]).toEqual({
    ...harness.options.request,
    input: [
      { role: 'user', content: 'Investigate.' },
      ...first.output,
      { type: 'function_call_output', call_id: 'a', output: 'result a' },
      { type: 'function_call_output', call_id: 'b', output: 'result b' },
    ],
  });
  expect(harness.conversation.history.slice(-terminal.output.length)).toEqual(
    terminal.output,
  );
});

test('retains completed tools and replies when a later generation fails', async () => {
  const harness = conversationHarness([replyWithCalls('a')]);
  const failure = new Error('provider failed');
  harness.model.generate
    .mockImplementationOnce(() => Promise.resolve(replyWithCalls('a')))
    .mockRejectedValueOnce(failure);

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(failure);
  expect(harness.turns).toHaveLength(1);
  expect(harness.conversation.history.at(-1)).toEqual({
    type: 'function_call_output',
    call_id: 'a',
    output: 'source bytes',
  });
});

test('propagates a recording failure without executing tools', async () => {
  const harness = conversationHarness([replyWithCalls('a')]);
  const failure = new Error('record failed');
  harness.recordTurn.mockImplementation(() => {
    throw failure;
  });

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(failure);
  expect(harness.executeTool).not.toHaveBeenCalled();
});

test('preserves earlier tool outputs and the original error when a later tool fails', async () => {
  const harness = conversationHarness([replyWithCalls('a', 'b')]);
  const failure = new Error('tool failed');
  harness.executeTool
    .mockResolvedValueOnce('first source')
    .mockRejectedValueOnce(failure);

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(failure);
  expect(harness.turns).toHaveLength(1);
  expect(harness.conversation.history.at(-1)).toEqual({
    type: 'function_call_output',
    call_id: 'a',
    output: 'first source',
  });
  expect(harness.generated).toHaveLength(1);
});

test('returns a completed terminal turn even if its generation cancels the run', async () => {
  const terminal = replyWithCalls();
  const harness = conversationHarness([]);
  harness.model.generate.mockImplementation(() => {
    harness.controller.abort(new Error('cancelled'));
    return Promise.resolve(terminal);
  });

  const result = await runModelConversation(
    harness.conversation,
    harness.options,
  );

  expect(result).toBe(harness.turns[0]);
  expect(result.reply).toBe(terminal);
  expect(harness.conversation.history.slice(1)).toEqual(terminal.output);
});

test('records an aborted tool-request reply without starting its tools', async () => {
  const reply = replyWithCalls('a');
  const harness = conversationHarness([]);
  const reason = new Error('cancelled');
  harness.model.generate.mockImplementation(() => {
    harness.controller.abort(reason);
    return Promise.resolve(reply);
  });

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(reason);
  expect(harness.turns[0]?.reply).toBe(reply);
  expect(harness.executeTool).not.toHaveBeenCalled();
});

test('keeps a completed tool output after cancellation and starts no further tools', async () => {
  const harness = conversationHarness([replyWithCalls('a', 'b')]);
  const reason = new Error('cancelled during tool');
  harness.executeTool.mockImplementation(() => {
    harness.controller.abort(reason);
    return Promise.resolve('completed output');
  });

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(reason);
  expect(harness.executeTool).toHaveBeenCalledTimes(1);
  expect(harness.conversation.history.at(-1)).toEqual({
    type: 'function_call_output',
    call_id: 'a',
    output: 'completed output',
  });
  expect(harness.generated).toHaveLength(1);
});

test('cancellation during counting prevents generation', async () => {
  const harness = conversationHarness([]);
  const reason = new Error('cancelled during count');
  harness.model.count.mockImplementation(() => {
    harness.controller.abort(reason);
    return Promise.resolve(42);
  });

  await expect(
    runModelConversation(harness.conversation, harness.options),
  ).rejects.toBe(reason);
  expect(harness.model.generate).not.toHaveBeenCalled();
  expect(harness.turns).toEqual([]);
});

test.each(['bytes', 'tokens'] as const)(
  'rejects requests exceeding the %s capacity before generation',
  async (capacity) => {
    const harness = conversationHarness([]);

    if (capacity === 'bytes') {
      harness.options.maxRequestBytes = 1;
    } else {
      harness.options.maxInputTokens = 41;
    }

    await expect(
      runModelConversation(harness.conversation, harness.options),
    ).rejects.toThrow(/capacity/);
    expect(harness.model.generate).not.toHaveBeenCalled();
    expect(harness.model.count).toHaveBeenCalledTimes(
      capacity === 'bytes' ? 0 : 1,
    );
  },
);

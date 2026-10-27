import { afterEach, expect, test, vi } from 'vitest';
import { createOpenAI, ModelError } from '@daphne/llm';

afterEach(() => {
  vi.unstubAllGlobals();
});

const commentary = {
  id: 'commentary',
  type: 'message',
  role: 'assistant',
  status: 'completed',
  phase: 'commentary',
  content: [{ type: 'output_text', text: 'Let me inspect the changes.' }],
};

test('keeps complete output for replay while extracting only answer text', async () => {
  const output = [
    {
      id: 'reasoning',
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: 'Consider the dependencies.' }],
      encrypted_content: 'opaque',
    },
    commentary,
    {
      id: 'final',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer',
      content: [{ type: 'output_text', text: 'First part. ' }],
    },
    {
      id: 'phase-less',
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: 'Second part.' }],
    },
  ];

  const response = {
    id: 'response',
    status: 'completed',
    output,
    usage: { output_tokens: 40 },
  };

  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json(response));

  vi.stubGlobal('fetch', fetch);

  const model = createOpenAI(
    'test-key',
    'test-model',
    new AbortController().signal,
  );

  const result = await model.generate({
    instructions: 'Group the changes.',
    input: 'Changes',
  });

  expect(result).toEqual({
    text: 'First part. Second part.',
    output,
    response,
  });
  expect(model.calls).toEqual({ count: 0, generate: 1 });
});

test('commentary alone cannot be accepted as an answer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        status: 'completed',
        output: [commentary],
      }),
    ),
  );

  const model = createOpenAI(
    'test-key',
    'test-model',
    new AbortController().signal,
  );

  await expect(
    model.generate({ instructions: 'Group the changes.', input: 'Changes' }),
  ).rejects.toThrow(ModelError);
  expect(model.calls).toEqual({ count: 0, generate: 1 });
});

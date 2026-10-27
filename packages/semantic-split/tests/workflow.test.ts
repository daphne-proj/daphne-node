import { beforeEach, expect, test, vi } from 'vitest';
import { ContextInputError } from '@daphne/context-engine';
import { createOpenAI, ModelError } from '@daphne/llm';
import { runSemanticSplit } from '@daphne/semantic-split';
import {
  countOneUnitPerPage,
  modelReply,
  proposalText,
  setupWorkflow,
} from './workflow.helpers.js';

vi.mock(import('@daphne/llm'), async (importOriginal) => ({
  ...(await importOriginal()),
  createOpenAI: vi.fn<typeof createOpenAI>(),
}));

beforeEach(() => {
  vi.mocked(createOpenAI).mockReset();
});

test.each([
  {
    name: 'at the token limit',
    tokens: 128,
    status: 'complete',
    generations: 2,
  },
  {
    name: 'over the token limit',
    tokens: 129,
    status: 'failed',
    generations: 1,
  },
])(
  'a correction $name preserves its earlier draft',
  async ({ tokens, status, generations }) => {
    const { input, options, count, generate } = setupWorkflow();
    const draft = modelReply('{', 'draft');
    const accepted = modelReply(proposalText('a:metadata'), 'accepted');
    count.mockResolvedValueOnce(16).mockResolvedValueOnce(tokens);
    generate.mockResolvedValueOnce(draft).mockResolvedValueOnce(accepted);

    const result = await runSemanticSplit(input, options);

    expect(result.status).toBe(status);
    expect(result.calls).toEqual({ count: 2, generate: generations });
    expect(result.attempts).toHaveLength(generations);
    expect(result.attempts[0]).toMatchObject({
      number: 1,
      inputTokens: 16,
      text: draft.text,
      validation: { status: 'invalid_json' },
    });
    expect(result.attempts[0]?.response).toEqual(draft.response);

    if (result.status === 'failed') {
      expect(result).toMatchObject({ proposal: null, response: null });
      expect(result.error).toBeInstanceOf(ModelError);
      expect(result.error).toHaveProperty(
        'message',
        expect.stringContaining('--max-input-tokens'),
      );
    } else {
      expect(result.attempts[1]).toMatchObject({
        inputTokens: 128,
        validation: { status: 'valid' },
      });
      expect(result.response).toEqual(accepted.response);
    }
  },
);

test('oversized replay stops before another request and retains the draft', async () => {
  const { input, options, generate } = setupWorkflow();
  const draft = modelReply('{', 'draft');
  draft.output = [
    ...draft.output,
    {
      id: 'large-reasoning',
      type: 'reasoning',
      summary: [],
      encrypted_content: 'x'.repeat(65_536),
    },
  ];
  draft.response.output = draft.output;
  generate.mockResolvedValueOnce(draft);

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    calls: { count: 1, generate: 1 },
    attempts: [
      {
        number: 1,
        text: draft.text,
        response: draft.response,
        validation: { status: 'invalid_json' },
      },
    ],
  });
  expect(result.attempts).toHaveLength(1);

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ModelError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('byte budget'),
    );
  }
});

test.each(['count', 'generate'])(
  'a later %s failure retains analyses and completed attempts',
  async (operation) => {
    const { input, options, count, generate } = setupWorkflow(['a', 'b']);
    const failure = new ModelError('Provider unavailable.');

    const analyses = [
      modelReply('Notes A', 'analysis-a'),
      modelReply('Notes B', 'analysis-b'),
    ];

    const draft = modelReply('{', 'draft');
    count.mockImplementation(countOneUnitPerPage);

    for (const analysis of analyses) {
      generate.mockResolvedValueOnce(analysis);
    }

    generate
      .mockImplementationOnce(() => {
        if (operation === 'count') {
          count.mockRejectedValueOnce(failure);
        }
        return Promise.resolve(draft);
      })
      .mockRejectedValueOnce(failure);

    const result = await runSemanticSplit(input, options);

    expect(result).toMatchObject({
      status: 'failed',
      proposal: null,
      response: null,
    });
    expect(result.pages.map((page) => page.analysis)).toEqual(
      analyses.map(({ text, response }) => ({ text, response })),
    );
    expect(result.attempts).toMatchObject([
      {
        number: 1,
        inputTokens: 16,
        text: draft.text,
        validation: { status: 'invalid_json' },
      },
    ]);
    expect(result.attempts[0]?.response).toEqual(draft.response);
    expect(result.calls.generate).toBe(operation === 'count' ? 3 : 4);

    if (result.status === 'failed') {
      expect(result.error).toBe(failure);
    }
  },
);

test('a page callback failure preserves every page already prepared', async () => {
  const { input, options, count } = setupWorkflow(['a', 'b', 'c']);
  const failure = new Error('Progress display failed.');

  count.mockImplementation(countOneUnitPerPage);

  options.onPage = (_page, number) => {
    if (number === 2) {
      throw failure;
    }
  };

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    pages: [
      { unitIds: ['a:metadata'], analysis: null },
      { unitIds: ['b:metadata'], analysis: null },
    ],
    attempts: [],
    calls: { generate: 0 },
  });

  if (result.status === 'failed') {
    expect(result.error).toBe(failure);
  }
});

test('an already-cancelled empty run fails without model calls', async () => {
  const { input, options, controller } = setupWorkflow([]);
  controller.abort();

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    pages: [],
    attempts: [],
    calls: { count: 0, generate: 0 },
  });

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ModelError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('cancelled'),
    );
  }
});

test('cancellation after a valid reply keeps the draft without accepting success', async () => {
  const { input, options, controller, generate } = setupWorkflow();
  const answer = modelReply(proposalText('a:metadata'), 'valid');

  generate.mockImplementationOnce(() => {
    controller.abort();
    return Promise.resolve(answer);
  });

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    calls: { count: 1, generate: 1 },
    attempts: [
      {
        number: 1,
        text: answer.text,
        response: answer.response,
        validation: { status: 'valid' },
      },
    ],
  });
  expect(result.attempts).toHaveLength(1);

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ModelError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('cancelled'),
    );
  }
});

test('an empty inventory completes without model calls', async () => {
  const { input, options } = setupWorkflow([]);

  expect(await runSemanticSplit(input, options)).toEqual({
    status: 'complete',
    maxCorrections: 3,
    pages: [],
    attempts: [],
    calls: { count: 0, generate: 0 },
    proposal: { groups: [], warnings: [] },
    response: null,
  });
});

test('one page groups directly using the exact request already counted', async () => {
  const {
    input,
    options,
    generate,
    generatedRequests,
    countedBeforeGeneration,
  } = setupWorkflow();
  const answer = modelReply(proposalText('a:metadata'), 'valid');
  generate.mockResolvedValueOnce(answer);

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'complete',
    pages: [{ unitIds: ['a:metadata'], analysis: null }],
    calls: { count: 1, generate: 1 },
    proposal: { groups: [{ unitIds: ['a:metadata'] }] },
    response: answer.response,
    attempts: [
      {
        number: 1,
        inputTokens: 16,
        text: answer.text,
        response: answer.response,
        validation: { status: 'valid' },
      },
    ],
  });
  expect(result.attempts).toHaveLength(1);
  expect(generatedRequests).toEqual(countedBeforeGeneration);
});

test('missing evidence fails before generation and keeps prepared pages', async () => {
  const { input, options } = setupWorkflow(['a', 'b']);
  input.hunks = input.hunks.slice(0, 1);

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    pages: [{ unitIds: ['a:metadata'], analysis: null }],
    attempts: [],
    calls: { generate: 0 },
  });
  expect(result.status).toBe('failed');

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ContextInputError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('"missingIds":["b:metadata"]'),
    );
  }
});

test.each([
  {
    name: 'second reply is valid',
    replies: ['{', proposalText('a:metadata')],
    status: 'complete',
    validations: ['invalid_json', 'valid'],
  },
  {
    name: 'fourth reply is valid',
    replies: ['{', '{', '{', proposalText('a:metadata')],
    status: 'complete',
    validations: ['invalid_json', 'invalid_json', 'invalid_json', 'valid'],
  },
  {
    name: 'all four replies are invalid',
    replies: ['{', '{', '{', '{'],
    status: 'failed',
    validations: [
      'invalid_json',
      'invalid_json',
      'invalid_json',
      'invalid_json',
    ],
  },
])('$name', async ({ replies, status, validations }) => {
  const {
    input,
    options,
    generate,
    generatedRequests,
    countedBeforeGeneration,
  } = setupWorkflow();
  const answers = replies.map((text, index) =>
    modelReply(text, `draft-${String(index + 1)}`),
  );

  for (const answer of answers) {
    generate.mockResolvedValueOnce(answer);
  }

  const result = await runSemanticSplit(input, options);

  expect(result.status).toBe(status);
  expect(result.maxCorrections).toBe(3);
  expect(result.attempts.map((attempt) => attempt.number)).toEqual(
    replies.map((_, index) => index + 1),
  );
  expect(result.attempts.map((attempt) => attempt.validation.status)).toEqual(
    validations,
  );
  expect(result.attempts.map((attempt) => attempt.response)).toEqual(
    answers.map((answer) => answer.response),
  );
  expect(result.calls.generate).toBe(replies.length);
  expect(generatedRequests).toEqual(countedBeforeGeneration);

  if (status === 'failed') {
    expect(result).toMatchObject({ proposal: null, response: null });
  } else {
    expect(result).toMatchObject({
      proposal: { groups: [{ unitIds: ['a:metadata'] }] },
      response: answers.at(-1)?.response,
    });
  }
});

test.each([
  {
    name: 'missing and duplicated units',
    invalidIds: ['a:metadata', 'a:metadata', 'c:metadata'],
    neededPages: [0, 1],
  },
  {
    name: 'only an unknown unit',
    invalidIds: ['a:metadata', 'b:metadata', 'c:metadata', 'unknown'],
    neededPages: [],
  },
])(
  'corrections replay complete replies and supply evidence for $name',
  async ({ invalidIds, neededPages }) => {
    const {
      input,
      options,
      count,
      generate,
      generatedRequests,
      countedBeforeGeneration,
    } = setupWorkflow(['a', 'b', 'c']);

    count.mockImplementation(countOneUnitPerPage);

    const analyses = ['a', 'b', 'c'].map((id) =>
      modelReply(`Notes for ${id}`, `analysis-${id}`),
    );

    const first = modelReply(proposalText(...invalidIds), 'first');
    const second = modelReply(proposalText(...invalidIds), 'second');
    const accepted = modelReply(
      proposalText('a:metadata', 'b:metadata', 'c:metadata'),
      'accepted',
    );

    for (const answer of [...analyses, first, second, accepted]) {
      generate.mockResolvedValueOnce(answer);
    }

    const result = await runSemanticSplit(input, options);

    expect(result.status).toBe('complete');
    expect(result.pages.map((page) => page.unitIds)).toEqual([
      ['a:metadata'],
      ['b:metadata'],
      ['c:metadata'],
    ]);
    expect(result.pages.map((page) => page.analysis)).toEqual(
      analyses.map(({ text, response }) => ({ text, response })),
    );
    expect(result.attempts.map((attempt) => attempt.number)).toEqual([1, 2, 3]);
    expect(result.response).toEqual(accepted.response);
    expect(result.calls.generate).toBe(6);
    expect(generatedRequests).toEqual(countedBeforeGeneration);

    const initialHistory = generatedRequests[3]?.input;
    const firstCorrection = generatedRequests[4]?.input;
    const secondCorrection = generatedRequests[5]?.input;
    expect(Array.isArray(initialHistory)).toBe(true);
    expect(Array.isArray(firstCorrection)).toBe(true);
    expect(Array.isArray(secondCorrection)).toBe(true);

    if (
      typeof initialHistory !== 'object' ||
      typeof firstCorrection !== 'object' ||
      typeof secondCorrection !== 'object'
    ) {
      throw new Error('Expected conversation arrays.');
    }

    expect(firstCorrection.slice(0, -1)).toEqual([
      ...initialHistory,
      ...first.output,
    ]);
    expect(secondCorrection.slice(0, -1)).toEqual([
      ...firstCorrection,
      ...second.output,
    ]);

    for (const [history, indexes] of [
      [firstCorrection, neededPages],
      [secondCorrection, []],
    ] as const) {
      const content = history.at(-1)?.content;
      expect(typeof content).toBe('string');

      if (typeof content !== 'string') {
        throw new Error('Expected a correction message.');
      }

      const correction: unknown = JSON.parse(content);
      expect(correction).toMatchObject({
        validation: { status: 'invalid_coverage' },
        pages: indexes.map((pageIndex) => ({
          pageIndex,
          unitIds: result.pages[pageIndex]?.unitIds,
          context: result.pages[pageIndex]?.context,
        })),
      });
    }
  },
);

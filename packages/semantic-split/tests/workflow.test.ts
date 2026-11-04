import { beforeEach, expect, test, vi } from 'vitest';
import { ContextInputError } from '@daphne/context-engine';
import { createModel, ModelError } from '@daphne/llm';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import { runSemanticSplit } from '@daphne/semantic-split';
import { modelReply, proposalText, setupWorkflow } from './workflow.helpers.js';

vi.mock(import('@daphne/llm'), async (importOriginal) => ({
  ...(await importOriginal()),
  createModel: vi.fn<typeof createModel>(),
}));

beforeEach(() => {
  vi.mocked(createModel).mockReset();
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
    expect(result.calls).toEqual({ count: 2, generate: generations, tools: 0 });
    expect(result.attempts).toHaveLength(generations);
    expect(result.attempts[0]).toMatchObject({
      number: 1,
      writerTurnNumber: 1,
      validation: { status: 'invalid_json' },
    });
    expect(result.turns[0]).toMatchObject({ inputTokens: 16, reply: draft });

    if (result.status === 'failed') {
      expect(result).toMatchObject({
        proposal: null,
        response: null,
        acceptedCandidate: null,
      });
      expect(result.error).toBeInstanceOf(ModelError);
      expect(result.error).toHaveProperty(
        'message',
        expect.stringContaining('input token capacity'),
      );
    } else {
      expect(result.attempts[1]).toMatchObject({
        writerTurnNumber: 2,
        validation: { status: 'valid' },
      });
      expect(result.turns[1]?.inputTokens).toBe(128);
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
      encrypted_content: 'x'.repeat(8_388_608),
    },
  ];
  draft.response.output = draft.output;
  generate.mockResolvedValueOnce(draft);

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    acceptedCandidate: null,
    calls: { count: 1, generate: 1, tools: 0 },
    attempts: [
      {
        number: 1,
        writerTurnNumber: 1,
        validation: { status: 'invalid_json' },
      },
    ],
  });
  expect(result.turns[0]?.reply).toEqual(draft);
  expect(result.attempts).toHaveLength(1);

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ModelError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('byte capacity'),
    );
  }
});

test.each(['count', 'generate'])(
  'a later %s failure retains completed turns and attempts',
  async (operation) => {
    const { input, options, count, generate } = setupWorkflow(['a', 'b']);
    const failure = new ModelError('Provider unavailable.');
    const draft = modelReply('{', 'draft');
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
      acceptedCandidate: null,
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      number: 1,
      writerTurnNumber: 1,
      validation: { status: 'invalid_json' },
    });
    expect(result.turns[0]).toMatchObject({ inputTokens: 16, reply: draft });
    expect(result.calls.generate).toBe(operation === 'count' ? 1 : 2);

    if (result.status === 'failed') {
      expect(result.error).toBe(failure);
    }
  },
);

test('an already-cancelled empty run fails without model calls', async () => {
  const { input, options, controller } = setupWorkflow([]);
  controller.abort();

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    acceptedCandidate: null,
    turns: [],
    attempts: [],
    calls: { count: 0, generate: 0, tools: 0 },
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
    acceptedCandidate: null,
    calls: { count: 1, generate: 1, tools: 0 },
  });
  expect(result.attempts).toEqual([
    { number: 1, writerTurnNumber: 1, validation: null },
  ]);
  expect(result.turns[0]?.reply).toEqual(answer);

  if (result.status === 'failed') {
    expect(result.error).toBe(controller.signal.reason);
  }
});

test('an empty inventory completes without model calls', async () => {
  const { input, options, generate } = setupWorkflow([]);
  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'complete',
    comparison: { identity: input.identity, changes: [] },
    budget: { maxCandidates: null, deadlineAt: null },
    hunks: [],
    tools: [],
    turns: [],
    attempts: [],
    calls: { count: 0, generate: 0, tools: 0 },
    proposal: { groups: [], warnings: [] },
    response: null,
    acceptedCandidate: null,
  });
  expect(generate).not.toHaveBeenCalled();
});

test('the complete diff groups directly using the exact request already counted', async () => {
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
    calls: { count: 1, generate: 1, tools: 0 },
    proposal: { groups: [{ unitIds: ['a:metadata'] }] },
    response: answer.response,
    acceptedCandidate: { candidateNumber: 1, writerTurnNumber: 1 },
    attempts: [
      { number: 1, writerTurnNumber: 1, validation: { status: 'valid' } },
    ],
  });
  expect(result.turns[0]).toMatchObject({ inputTokens: 16, reply: answer });
  expect(result.attempts).toHaveLength(1);
  expect(generatedRequests).toEqual(countedBeforeGeneration);
});

test('missing evidence fails before generation and keeps retained hunks', async () => {
  const { input, options } = setupWorkflow(['a', 'b']);
  input.hunks = input.hunks.slice(0, 1);

  const result = await runSemanticSplit(input, options);

  expect(result).toMatchObject({
    status: 'failed',
    proposal: null,
    response: null,
    acceptedCandidate: null,
    hunks: [{ changeId: 'a', hunkIndex: null, evidenceIds: [] }],
    attempts: [],
    calls: { count: 0, generate: 0, tools: 0 },
  });

  if (result.status === 'failed') {
    expect(result.error).toBeInstanceOf(ContextInputError);
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('Missing 1 required diff entries'),
    );
  }
});

test.each([
  {
    name: 'second reply is valid',
    maxCandidates: null,
    replies: ['{', proposalText('a:metadata')],
    status: 'complete',
    validations: ['invalid_json', 'valid'],
  },
  {
    name: 'last allowed reply is valid with a four-candidate ceiling',
    maxCandidates: 4,
    replies: ['{', '{', '{', proposalText('a:metadata')],
    status: 'complete',
    validations: ['invalid_json', 'invalid_json', 'invalid_json', 'valid'],
  },
  {
    name: 'all four allowed replies are invalid',
    maxCandidates: 4,
    replies: ['{', '{', '{', '{'],
    status: 'failed',
    validations: [
      'invalid_json',
      'invalid_json',
      'invalid_json',
      'invalid_json',
    ],
  },
  {
    name: 'the only allowed reply is valid',
    maxCandidates: 1,
    replies: [proposalText('a:metadata')],
    status: 'complete',
    validations: ['valid'],
  },
  {
    name: 'the only allowed reply is invalid',
    maxCandidates: 1,
    replies: ['{'],
    status: 'failed',
    validations: ['invalid_json'],
  },
  {
    name: 'sixth reply succeeds without a candidate ceiling',
    maxCandidates: null,
    replies: ['{', '{', '{', '{', '{', proposalText('a:metadata')],
    status: 'complete',
    validations: [
      'invalid_json',
      'invalid_json',
      'invalid_json',
      'invalid_json',
      'invalid_json',
      'valid',
    ],
  },
])('$name', async ({ maxCandidates, replies, status, validations }) => {
  const {
    input,
    options,
    controller,
    generate,
    generatedRequests,
    countedBeforeGeneration,
  } = setupWorkflow();
  const answers = replies.map((text, index) =>
    modelReply(text, `draft-${String(index + 1)}`),
  );
  options.budget = createRunBudget(
    maxCandidates === null ? {} : { maxCandidates },
    controller.signal,
  );

  for (const answer of answers) {
    generate.mockResolvedValueOnce(answer);
  }

  const result = await runSemanticSplit(input, options);

  expect(result.status).toBe(status);
  expect(result.budget).toEqual({ maxCandidates, deadlineAt: null });
  expect(result.attempts.map((attempt) => attempt.number)).toEqual(
    replies.map((_, index) => index + 1),
  );
  expect(result.attempts.map((attempt) => attempt.validation?.status)).toEqual(
    validations,
  );
  expect(result.turns.map((turn) => turn.reply.response)).toEqual(
    answers.map((answer) => answer.response),
  );
  expect(result.calls.generate).toBe(replies.length);
  expect(generatedRequests).toEqual(countedBeforeGeneration);

  if (result.status === 'failed') {
    expect(result).toMatchObject({
      proposal: null,
      response: null,
      acceptedCandidate: null,
    });
    expect(result.error).toHaveProperty(
      'message',
      expect.stringContaining('configured run ceiling'),
    );
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
  },
  {
    name: 'only an unknown unit',
    invalidIds: ['a:metadata', 'b:metadata', 'c:metadata', 'unknown'],
  },
])(
  'corrections replay complete replies and original evidence for $name',
  async ({ invalidIds }) => {
    const {
      input,
      options,
      generate,
      generatedRequests,
      countedBeforeGeneration,
    } = setupWorkflow(['a', 'b', 'c']);
    const first = modelReply(proposalText(...invalidIds), 'first');
    const second = modelReply(proposalText(...invalidIds), 'second');
    const accepted = modelReply(
      proposalText('a:metadata', 'b:metadata', 'c:metadata'),
      'accepted',
    );

    for (const answer of [first, second, accepted]) {
      generate.mockResolvedValueOnce(answer);
    }

    const result = await runSemanticSplit(input, options);

    expect(result.status).toBe('complete');
    expect(result.hunks.map((hunk) => hunk.changeId)).toEqual(['a', 'b', 'c']);
    expect(result.attempts.map((attempt) => attempt.number)).toEqual([1, 2, 3]);
    expect(result.response).toEqual(accepted.response);
    expect(result.calls.generate).toBe(3);
    expect(generatedRequests).toEqual(countedBeforeGeneration);

    const initialHistory = generatedRequests[0]?.input;
    const firstCorrection = generatedRequests[1]?.input;
    const secondCorrection = generatedRequests[2]?.input;

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
    const original = initialHistory[0]?.content;

    if (typeof original !== 'string') {
      throw new Error('Expected original diff context.');
    }

    expect(JSON.parse(original)).toMatchObject({
      units: ['a', 'b', 'c'].map((id) => ({ unitId: `${id}:metadata` })),
    });

    for (const history of [firstCorrection, secondCorrection]) {
      const content = history.at(-1)?.content;

      if (typeof content !== 'string') {
        throw new Error('Expected a correction message.');
      }

      const correction: unknown = JSON.parse(content);
      expect(correction).toMatchObject({
        validation: { status: 'invalid_coverage' },
      });
      expect(correction).not.toHaveProperty('pages');
    }
  },
);

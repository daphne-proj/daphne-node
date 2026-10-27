import { vi } from 'vitest';
import { createOpenAI } from '@daphne/llm';
import type { ModelReply, ModelRequest } from '@daphne/llm';
import type {
  SemanticSplitInput,
  SemanticSplitOptions,
} from '@daphne/semantic-split';
import type { Change } from '@daphne/review-evidence/contracts';

export function proposalText(...unitIds: string[]): string {
  return JSON.stringify({
    groups: [{ title: 'Update parser', reason: 'Related changes.', unitIds }],
    warnings: [],
  });
}

export function modelReply(text: string, id: string): ModelReply {
  const output = [
    {
      id: `${id}-reasoning`,
      type: 'reasoning',
      summary: [],
      encrypted_content: 'opaque',
    },
    {
      id: `${id}-message`,
      type: 'message',
      role: 'assistant',
      status: 'completed',
      phase: 'final_answer',
      content: [{ type: 'output_text', text }],
    },
  ];

  return { text, output, response: { id, status: 'completed', output } };
}

export function setupWorkflow(ids: string[] = ['a']) {
  const changes: Change[] = ids.map((id) => ({
    id,
    beforePath: `${id}.png`,
    afterPath: `${id}.png`,
    beforeMode: '100644',
    afterMode: '100644',
    status: 'modified',
    kind: 'binary',
    hunks: [],
  }));

  const input: SemanticSplitInput = {
    identity: {
      sessionId: 'session',
      repositoryUrl: 'https://github.com/example/project.git',
      targetCommit: 'a'.repeat(40),
      baseCommit: 'a'.repeat(40),
      headCommit: 'b'.repeat(40),
    },
    changes,
    hunks: changes.map((change) => ({ change, hunkIndex: null, sources: [] })),
  };

  const controller = new AbortController();

  const options: SemanticSplitOptions = {
    apiKey: 'test-key',
    model: 'test-model',
    maxInputTokens: 128,
    signal: controller.signal,
  };

  const count = vi
    .fn<ReturnType<typeof createOpenAI>['count']>()
    .mockResolvedValue(16);

  const generate = vi
    .fn<ReturnType<typeof createOpenAI>['generate']>()
    .mockRejectedValue(new Error('Unexpected generation.'));

  const countedRequests: ModelRequest[] = [];
  const generatedRequests: ModelRequest[] = [];
  const countedBeforeGeneration: (ModelRequest | undefined)[] = [];

  const model: ReturnType<typeof createOpenAI> = {
    calls: { count: 0, generate: 0 },
    count(request) {
      model.calls.count += 1;
      countedRequests.push(structuredClone(request));

      return count(request);
    },
    generate(request) {
      model.calls.generate += 1;
      generatedRequests.push(structuredClone(request));
      countedBeforeGeneration.push(structuredClone(countedRequests.at(-1)));

      return generate(request);
    },
  };

  vi.mocked(createOpenAI).mockReturnValue(model);

  return {
    input,
    options,
    controller,
    count,
    generate,
    generatedRequests,
    countedBeforeGeneration,
  };
}

/* Force the real pager to deliver one unit per page; summaries and repairs still fit. */
export function countOneUnitPerPage(request: ModelRequest): Promise<number> {
  if (typeof request.input !== 'string' && request.input.length === 1) {
    const content = request.input[0]?.content;

    if (typeof content === 'string' && content.startsWith('unitId:')) {
      const units = content.match(/^unitId: /gm)?.length ?? 0;

      return Promise.resolve(units === 1 ? 16 : 129);
    }
  }

  return Promise.resolve(16);
}

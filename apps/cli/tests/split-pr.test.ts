import type { PathLike } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { splitPullRequest } from '@daphne/pr-review/split';
import type { SplitPullRequestResult } from '@daphne/pr-review/split';
import { ModelError } from '@daphne/llm';
import { runSplitPr } from '../src/split-pr.js';
import { completedResult, setupSplitPr } from './split-pr.helpers.js';

vi.mock(import('@daphne/pr-review/split'), () => ({
  splitPullRequest: vi.fn<typeof splitPullRequest>(),
}));

vi.mock(import('node:fs'), async (importOriginal) => {
  const actual = await importOriginal();

  return {
    ...actual,
    existsSync: (path: PathLike) =>
      path === '.env' ? false : actual.existsSync(path),
  };
});

beforeEach(() => {
  vi.mocked(splitPullRequest).mockReset();
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('GITHUB_TOKEN', undefined);
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  vi.spyOn(process.stderr, 'write').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

test.each([
  { status: 'complete', exitCode: 0 },
  { status: 'failed', exitCode: 1 },
])(
  'saves a $status workflow result and returns exit code $exitCode',
  async ({ status, exitCode }) => {
    const { options, controller } = await setupSplitPr();
    const complete = completedResult();
    const failure = new ModelError('Provider unavailable.');
    const result: SplitPullRequestResult =
      status === 'complete'
        ? complete
        : {
            ...complete,
            status: 'failed',
            investigation: {
              ...complete.investigation,
              status: 'failed',
              proposal: null,
              response: null,
              acceptedCandidate: null,
              error: failure,
              attempts: complete.investigation.attempts.slice(0, 1),
              turns: complete.investigation.turns.slice(0, 1),
            },
            proposal: null,
            response: null,
            errors: [{ stage: 'investigation', error: failure }],
          };
    vi.mocked(splitPullRequest).mockResolvedValueOnce(result);

    const code = await runSplitPr(options, controller.signal);
    const artifact: unknown = JSON.parse(
      await readFile(join(options.output, 'run.json'), 'utf8'),
    );

    expect(code).toBe(exitCode);
    expect(artifact).toEqual({
      status,
      pr: options.pr,
      provider: 'openai',
      model: options.model,
      maxInputTokens: 128,
      reasoningEffort: 'medium',
      budget: complete.investigation.budget,
      metadata: result.metadata,
      identity: result.identity,
      changes: result.changes,
      hunks: [{ changeId: 'a', hunkIndex: null, sources: [] }],
      limitations: result.limitations,
      investigation:
        result.investigation?.status === 'failed'
          ? {
              ...result.investigation,
              error: {
                stage: 'investigation',
                code: 'model',
                message: 'Provider unavailable.',
              },
            }
          : result.investigation,
      proposal: result.proposal,
      response: result.response,
      errors:
        status === 'complete'
          ? []
          : [
              {
                stage: 'investigation',
                code: 'model',
                message: 'Provider unavailable.',
              },
            ],
    });
    expect(await readdir(options.output)).toEqual(['run.json']);
  },
);

test('cancelled publication saves completed work as a failed run', async () => {
  const { options, controller } = await setupSplitPr();
  const result = completedResult();
  vi.mocked(splitPullRequest).mockImplementationOnce(() => {
    controller.abort();

    return Promise.resolve(result);
  });

  const code = await runSplitPr(options, controller.signal);
  const artifact: unknown = JSON.parse(
    await readFile(join(options.output, 'run.json'), 'utf8'),
  );

  expect(code).toBe(1);
  expect(artifact).toMatchObject({
    status: 'failed',
    budget: result.investigation.budget,
    investigation: {
      status: 'failed',
      turns: result.investigation.turns,
      attempts: result.investigation.attempts,
      calls: result.investigation.calls,
      proposal: null,
      response: null,
      acceptedCandidate: null,
      error: { stage: 'run_output', code: 'cancelled' },
    },
    proposal: null,
    response: null,
    errors: [{ stage: 'run_output', code: 'cancelled' }],
  });
  expect(await readdir(options.output)).toEqual(['run.json']);
});

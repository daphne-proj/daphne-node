import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import type { SplitPullRequestResult } from '@daphne/pr-review/split';

export async function setupSplitPr() {
  const parent = await mkdtemp(join(tmpdir(), 'daphne-split-test-'));
  onTestFinished(() => rm(parent, { recursive: true, force: true }));

  return {
    options: {
      pr: 'https://github.com/example/project/pull/1',
      output: join(parent, 'run'),
      model: 'test-model',
      maxInputTokens: 128,
    },
    controller: new AbortController(),
  };
}

export function completedResult(): Extract<
  SplitPullRequestResult,
  { status: 'complete' }
> {
  const proposal = {
    groups: [
      {
        title: 'Update image',
        reason: 'One related change.',
        unitIds: ['a:metadata'],
      },
    ],
    warnings: [],
  };
  const response = {
    id: 'accepted',
    status: 'completed',
    output: [
      {
        id: 'answer',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
      },
    ],
  };
  const draft = {
    id: 'draft',
    status: 'completed',
    output: [
      {
        id: 'draft-answer',
        type: 'message',
        role: 'assistant',
        status: 'completed',
        content: [{ type: 'output_text', text: '{' }],
      },
    ],
  };
  const change: SplitPullRequestResult['changes'][number] = {
    id: 'a',
    beforePath: 'image.png',
    afterPath: 'image.png',
    beforeMode: '100644',
    afterMode: '100644',
    status: 'modified',
    kind: 'binary',
    hunks: [],
  };

  return {
    status: 'complete',
    identity: {
      sessionId: 'session',
      repositoryUrl: 'https://github.com/example/project.git',
      targetCommit: 'a'.repeat(40),
      baseCommit: 'a'.repeat(40),
      headCommit: 'b'.repeat(40),
    },
    changes: [change],
    hunks: [{ change, hunkIndex: null, sources: [] }],
    pages: [
      {
        unitIds: ['a:metadata'],
        context: 'Binary image change.',
        inputTokens: 16,
        analysis: null,
      },
    ],
    maxCorrections: 3,
    attempts: [
      {
        number: 1,
        inputTokens: 16,
        text: '{',
        response: draft,
        validation: { status: 'invalid_json', message: 'Invalid JSON.' },
      },
      {
        number: 2,
        inputTokens: 32,
        text: JSON.stringify(proposal),
        response,
        validation: { status: 'valid', proposal },
      },
    ],
    calls: { count: 2, generate: 2 },
    proposal,
    response,
    errors: [],
  };
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished } from 'vitest';
import type { SplitPullRequestResult } from '@daphne/pr-review/split';
import type { SemanticSplitResult, SplitTurn } from '@daphne/semantic-split';

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
> & { investigation: Extract<SemanticSplitResult, { status: 'complete' }> } {
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

  const identity = {
    sessionId: 'session',
    repositoryUrl: 'https://github.com/example/project.git',
    targetCommit: 'a'.repeat(40),
    baseCommit: 'a'.repeat(40),
    headCommit: 'b'.repeat(40),
  };
  const pr = {
    url: 'https://github.com/example/project/pull/1',
    title: 'Update image',
    body: null,
  };
  const turns = [draft, response].map<SplitTurn>((reply, index) => ({
    number: index + 1,
    role: 'writer',
    candidateNumber: index + 1,
    conversationId: 'writer',
    generationNumber: index + 1,
    instructions: 'Group original units.',
    deliveries: index === 0 ? [{ kind: 'initial', evidenceIds: [] }] : [],
    deliveredEvidenceIds: [],
    inputTokens: index === 0 ? 16 : 32,
    reply: {
      text: index === 0 ? '{' : JSON.stringify(proposal),
      output: reply.output,
      response: reply,
    },
  }));

  return {
    status: 'complete',
    metadata: {
      ref: { url: pr.url, owner: 'example', repository: 'project', number: 1 },
      title: pr.title,
      body: pr.body,
      targetRepositoryUrl: identity.repositoryUrl,
      headRepositoryUrl: identity.repositoryUrl,
      targetCommit: identity.targetCommit,
      headCommit: identity.headCommit,
    },
    identity,
    changes: [change],
    hunks: [{ change, hunkIndex: null, sources: [] }],
    limitations: [],
    investigation: {
      status: 'complete',
      comparison: { identity, changes: [change], pr },
      budget: { maxCandidates: null, deadlineAt: null },
      limits: {
        maxInputTokens: 128,
        maxOutputTokens: 16_384,
        maxContextBytes: 8_388_608,
        maxRetainedBytes: 33_554_432,
        maxRequestBytes: 8_388_608,
      },
      evidence: { identity, sources: [], queries: [] },
      hunks: [{ changeId: 'a', hunkIndex: null, evidenceIds: [] }],
      turns,
      tools: [],
      attempts: [
        {
          number: 1,
          writerTurnNumber: 1,
          validation: { status: 'invalid_json', message: 'Invalid JSON.' },
        },
        {
          number: 2,
          writerTurnNumber: 2,
          validation: { status: 'valid', proposal },
        },
      ],
      calls: { count: 2, generate: 2, tools: 0 },
      limitations: [],
      diagnostics: [],
      proposal,
      response,
      acceptedCandidate: { candidateNumber: 2, writerTurnNumber: 2 },
    },
    proposal,
    response,
    errors: [],
  };
}

import { vi } from 'vitest';
import {
  createContextEngine,
  defaultContextLimits,
} from '@daphne/context-engine';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import type { ModelReply } from '@daphne/llm';
import type {
  SourceEvidence,
  ToolResult,
} from '@daphne/review-evidence/contracts';
import { createIntentionConversation } from '../src/conversation.js';
import { assembleEvidence } from '../src/context.js';
import { createIntentionRuntimeFactory } from '../src/runtime.js';
import type { IntentionConversationRuntime } from '../src/conversation.js';

const identity = {
  sessionId: 'conversation-test',
  repositoryUrl: 'https://github.com/example/repository',
  targetCommit: 'a'.repeat(40),
  baseCommit: 'a'.repeat(40),
  headCommit: 'b'.repeat(40),
};

const request: ToolResult['request'] = {
  name: 'read_source_lines',
  side: 'head',
  path: 'b.ts',
  startLine: 1,
  lineCount: 1,
  cursor: null,
  maxBytes: 16_384,
};

export function intentionReply(tool = false): ModelReply {
  const call = {
    id: 'lookup-item',
    call_id: 'lookup',
    name: 'read_source_lines',
    arguments: JSON.stringify({
      side: 'head',
      path: 'b.ts',
      startLine: 1,
      lineCount: 1,
      cursor: null,
    }),
  };

  return {
    text: tool ? '' : '{"intentions":[],"warnings":[]}',
    output: tool
      ? [{ type: 'function_call', ...call }]
      : [{ type: 'message', content: [] }],
    functionCalls: tool ? [call] : [],
    response: { id: 'reply' },
  };
}

/* Script provider replies and repository reads; evidence retention and tool records stay real. */
export function intentionConversationHarness() {
  const controller = new AbortController();
  const budget = createRunBudget({}, controller.signal);
  const engine = createContextEngine(identity, defaultContextLimits);

  const initial: SourceEvidence = {
    ref: {
      sessionId: identity.sessionId,
      side: 'head',
      commit: identity.headCommit,
      path: 'a.ts',
      blobId: 'c'.repeat(40),
      range: { startByte: 0, endByte: 2 },
    },
    text: 'a\n',
  };
  const discovered: SourceEvidence = {
    ref: { ...initial.ref, path: 'b.ts', blobId: 'd'.repeat(40) },
    text: 'b\n',
  };
  const initialId = engine.addSource(initial);
  const executeTool = vi.fn((): Promise<ToolResult> =>
    Promise.resolve({
      identity,
      request,
      entries: [
        {
          kind: 'source_window',
          side: 'head',
          path: 'b.ts',
          range: { startByte: 0, endByte: 2 },
          startLine: 1,
          endLine: 1,
          totalLines: 1,
          eofClamped: false,
        },
        { kind: 'source', source: discovered },
      ],
      completeness: 'complete',
      nextCursor: null,
      notices: [],
    }),
  );

  const progress: IntentionConversationRuntime['progress'] = {
    turns: [],
    tools: [],
    calls: { count: 0, generate: 0, tools: 0 },
  };

  const createConversationRuntime = createIntentionRuntimeFactory(
    {
      apiKey: 'unused-key',
      model: 'test-model',
      budget,
      maxInputTokens: 100_000,
      executeTool,
    },
    engine,
    progress,
  );

  const runtime = createConversationRuntime(conversation('writer'));
  const model = runtime.model;
  const count = vi.spyOn(model, 'count').mockResolvedValue(42);
  const generate = vi.fn(() => Promise.resolve(intentionReply()));

  vi.spyOn(model, 'generate').mockImplementation(() => {
    model.calls.generate += 1;
    return generate();
  });

  function conversation(role: 'writer' | 'reviewer') {
    return createIntentionConversation(
      {
        role,
        conversationId: role,
        candidateNumber: 1,
        instructions: 'Investigate.',
        schema: { name: 'proposal', schema: { type: 'object' } },
        history: [
          {
            role: 'user',
            content: assembleEvidence(engine, [initialId]).renderedContext,
          },
        ],
      },
      [initialId],
    );
  }

  return {
    engine,
    runtime,
    conversation,
    initialId,
    discovered,
    controller,
    count,
    generate,
    executeTool,
  };
}

import { expect, test } from 'vitest';
import { runIntentionConversation } from '../src/conversation.js';
import {
  intentionConversationHarness,
  intentionReply,
} from './conversation.helpers.js';

test('retained tool evidence stays undelivered until a writer continuation succeeds', async () => {
  const harness = intentionConversationHarness();
  const writer = harness.conversation;
  const failure = new Error('writer continuation failed');

  harness.generate
    .mockResolvedValueOnce(intentionReply(true))
    .mockRejectedValueOnce(failure);

  await expect(runIntentionConversation(writer, harness.runtime)).rejects.toBe(
    failure,
  );

  const writerTool = harness.runtime.progress.tools[0];
  expect(writerTool?.status).toBe('complete');

  if (writerTool?.status !== 'complete') {
    throw new Error('Expected a retained writer tool.');
  }

  expect(writerTool.delivered).toBe(false);
  expect([...writer.deliveredEvidenceIds]).toEqual([harness.initialId]);
  expect(
    harness.engine.getEvidenceSnapshot().sources.map((source) => source.source),
  ).toContainEqual(harness.discovered);

  const written = await runIntentionConversation(writer, harness.runtime);

  expect(written.turnNumber).toBe(2);
  expect(written.deliveredEvidenceIds).toEqual([
    harness.initialId,
    ...writerTool.includedEvidenceIds,
  ]);
  expect(harness.runtime.progress.turns[1]?.deliveries).toEqual([
    { kind: 'tool', toolNumber: 1 },
  ]);
  expect(writerTool.delivered).toBe(true);
  expect(harness.runtime.progress.turns[0]?.deliveredEvidenceIds).toEqual([
    harness.initialId,
  ]);
});

test('counting and a failed first generation leave initial delivery unconfirmed', async () => {
  const harness = intentionConversationHarness();
  const writer = harness.conversation;
  const failure = new Error('generation failed');
  harness.generate.mockRejectedValueOnce(failure);

  await expect(runIntentionConversation(writer, harness.runtime)).rejects.toBe(
    failure,
  );

  expect(harness.count).toHaveBeenCalledOnce();
  expect(writer.deliveredEvidenceIds.size).toBe(0);
  expect(writer.pendingDeliveries).toEqual([
    { kind: 'initial', evidenceIds: [harness.initialId] },
  ]);
  expect(harness.runtime.progress.turns).toEqual([]);
});

test('a failed executor leaves its diagnostic record and original error intact', async () => {
  const harness = intentionConversationHarness();
  const failure = new Error('read failed');
  harness.generate.mockResolvedValueOnce(intentionReply(true));
  harness.executeTool.mockRejectedValueOnce(failure);

  await expect(
    runIntentionConversation(harness.conversation, harness.runtime),
  ).rejects.toBe(failure);

  expect(harness.runtime.progress.turns).toHaveLength(1);
  expect(harness.runtime.progress.tools).toHaveLength(1);
  expect(harness.runtime.progress.tools[0]).toMatchObject({
    status: 'failed',
    number: 1,
    role: 'writer',
    candidateNumber: 1,
    conversationId: 'writer',
    turnNumber: 1,
    error: failure,
  });
});

test('terminal generation confirms delivery and remains retained when cancellation arrives with it', async () => {
  const harness = intentionConversationHarness();
  harness.generate.mockImplementationOnce(() => {
    harness.controller.abort(new Error('cancelled'));
    return Promise.resolve(intentionReply());
  });

  const reply = await runIntentionConversation(
    harness.conversation,
    harness.runtime,
  );

  expect(reply).toEqual({
    turnNumber: 1,
    deliveredEvidenceIds: [harness.initialId],
  });
  expect(harness.runtime.progress.turns[0]).toMatchObject({
    role: 'writer',
    validation: null,
  });
  expect(harness.executeTool).not.toHaveBeenCalled();
});

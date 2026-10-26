import { createContextEngine } from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import { createOpenAI, ModelError } from '@daphne/llm';
import type { ModelRequest } from '@daphne/llm';
import type {
  IntentionsInput,
  IntentionsOptions,
  IntentionsResult,
  IntentionTurn,
} from './contracts.js';
import {
  assembleEvidence,
  captureInput,
  initialLimitations,
  retainDiff,
  retrievalLimitations,
} from './context.js';
import { intentionsLimits } from './limits.js';
import { correctionInstructions, intentionsInstructions } from './prompts.js';
import { validateIntentions } from './proposal.js';
import { intentionsSchema } from './schema.js';
import { executeIntentionTool, intentionsTools } from './tools.js';

type IntentionsProgress = Omit<
  IntentionsResult,
  'status' | 'proposal' | 'response' | 'error'
>;

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelError(
      'The intentions investigation was cancelled or timed out.',
    );
  }
}

function modelRequest(history: Record<string, unknown>[]): ModelRequest {
  return {
    instructions: intentionsInstructions,
    input: history,
    tools: intentionsTools,
    parallel_tool_calls: false,
    max_output_tokens: intentionsLimits.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: 'intentions_proposal',
        strict: true,
        schema: intentionsSchema,
      },
    },
  };
}

/* The host lends retrieval for this call and owns its lifetime, cancellation and persistence. */
export async function runIntentions(
  input: IntentionsInput,
  options: IntentionsOptions,
): Promise<IntentionsResult> {
  const {
    apiKey,
    model: modelName,
    signal,
    maxInputTokens,
    executeTool,
    onModelCall,
  } = options;

  const model = createOpenAI(apiKey, modelName, signal, onModelCall);

  let engine: ContextEngine | null = null;

  const progress: IntentionsProgress = {
    comparison: null,
    limits: { ...intentionsLimits, maxInputTokens },
    evidence: null,
    hunks: [],
    deliveredEvidenceIds: [],
    tools: [],
    turns: [],
    limitations: [],
    diagnostics: [],
    calls: { count: 0, generate: 0, tools: 0 },
  };

  function collected(): IntentionsProgress {
    const evidence = engine?.getEvidenceSnapshot() ?? null;

    return {
      ...progress,
      evidence,
      calls: { ...model.calls, tools: progress.calls.tools },
      limitations: [
        ...progress.limitations,
        ...(evidence ? retrievalLimitations(evidence) : []),
      ],
    };
  }

  try {
    checkCancellation(signal);

    if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 1) {
      throw new ModelError(
        'The input token limit must be a positive safe integer.',
      );
    }

    const captured = captureInput(input);
    progress.comparison = {
      identity: captured.identity,
      changes: captured.changes,
      pr: captured.pr,
    };

    engine = createContextEngine(captured.identity, {
      maxContextBytes: intentionsLimits.maxContextBytes,
      maxRetainedBytes: intentionsLimits.maxRetainedBytes,
    });

    progress.limitations = initialLimitations(captured.changes);
    retainDiff(captured, engine, progress.hunks);

    if (captured.changes.length === 0) {
      return {
        ...collected(),
        status: 'complete',
        proposal: { intentions: [], warnings: [] },
        response: null,
      };
    }

    const initial = assembleEvidence(
      engine,
      progress.hunks.flatMap((hunk) => hunk.evidenceIds),
    );

    const history: Record<string, unknown>[] = [
      {
        role: 'user',
        content: JSON.stringify({
          pr: captured.pr,
          identity: engine.identity,
          changes: captured.changes,
          hunks: progress.hunks,
          limitations: progress.limitations,
          context: initial.renderedContext,
        }),
      },
    ];

    const delivered = new Set<string>();
    const pendingEvidenceIds = new Set(initial.includedEvidenceIds);

    const callIds = new Set<string>();
    let corrections = 0;

    while (model.calls.generate < intentionsLimits.maxGenerations) {
      checkCancellation(signal);
      const request = modelRequest(history);

      if (
        Buffer.byteLength(JSON.stringify(request)) >
        intentionsLimits.maxRequestBytes
      ) {
        throw new ModelError(
          'The complete intentions request exceeds the 8 MiB byte budget.',
        );
      }

      /* Count the instructions, schema, tools and entire replay history on every turn. */
      const inputTokens = await model.count(request);
      checkCancellation(signal);

      if (inputTokens > maxInputTokens) {
        throw new ModelError(
          'The intentions request exceeds the input token budget.',
        );
      }

      const reply = await model.generate(request);
      const turn: IntentionTurn = {
        number: progress.turns.length + 1,
        inputTokens,
        reply,
        validation: null,
      };
      progress.turns.push(turn);

      /* A completed model turn confirms delivery; assembled or token-counted bytes alone do not. */
      for (const id of pendingEvidenceIds) {
        delivered.add(id);
      }

      pendingEvidenceIds.clear();
      progress.deliveredEvidenceIds = [...delivered];

      for (const tool of progress.tools) {
        if (tool.status === 'complete') {
          tool.delivered = true;
        }
      }

      checkCancellation(signal);

      history.push(...reply.output);
      const calls = reply.functionCalls ?? [];

      if (calls.length > 0) {
        for (const call of calls) {
          if (callIds.has(call.call_id)) {
            throw new ModelError(
              'The model reused a function call ID from an earlier turn.',
            );
          }

          callIds.add(call.call_id);
        }

        for (const call of calls) {
          checkCancellation(signal);

          if (progress.calls.tools >= intentionsLimits.maxToolCalls) {
            throw new ModelError(
              'The intentions investigation exhausted its tool-call budget.',
            );
          }

          progress.calls.tools += 1;
          const record = await executeIntentionTool(call, engine, executeTool);
          progress.tools.push(record);

          if (record.status === 'failed') {
            throw record.error;
          }

          history.push({
            type: 'function_call_output',
            call_id: call.call_id,
            output: record.output,
          });

          for (const id of record.includedEvidenceIds) {
            pendingEvidenceIds.add(id);
          }
        }

        /* Text accompanying pending calls is not a final proposal. */
        continue;
      }

      const validation = validateIntentions(reply.text, {
        identity: engine.identity,
        changes: captured.changes,
        pr: captured.pr,
        sources: engine.getEvidenceSnapshot().sources,
        deliveredEvidenceIds: progress.deliveredEvidenceIds,
      });
      turn.validation = validation;

      if (validation.status === 'valid') {
        return {
          ...collected(),
          status: 'complete',
          proposal: validation.proposal,
          response: reply.response,
        };
      }

      progress.diagnostics.push(...validation.diagnostics);

      if (corrections >= intentionsLimits.maxCorrections) {
        throw new ModelError(
          'The intentions proposal remained invalid after one correction.',
        );
      }

      corrections += 1;
      history.push({
        role: 'user',
        content: JSON.stringify({
          instruction: correctionInstructions,
          diagnostics: validation.diagnostics,
        }),
      });
    }

    throw new ModelError(
      'The intentions investigation exhausted its generation budget.',
    );
  } catch (error) {
    /* Keep completed replies, tool results and evidence even when no output can be accepted. */
    progress.diagnostics.push(
      error instanceof Error
        ? error.message
        : 'The intentions investigation failed.',
    );

    return {
      ...collected(),
      status: 'failed',
      proposal: null,
      response: null,
      error,
    };
  }
}

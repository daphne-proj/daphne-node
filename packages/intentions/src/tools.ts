import { retainToolEvidence } from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import type { ModelFunctionCall } from '@daphne/llm';
import type { ToolResult } from '@daphne/review-evidence/contracts';
import type { IntentionToolRecord, IntentionsOptions } from './contracts.js';
import { intentionsLimits } from './limits.js';
import { parseModelToolRequest } from '@daphne/review-evidence/tool-definitions';

/*
 * Execute a model lookup through the pinned, budget-bound executor and retain its
 * evidence. Origin links the result to its requesting conversation and turn; for
 * example, a writer read stays undelivered until that writer receives its output.
 * Return execution or validation failures as records so completed work survives.
 */
export async function executeIntentionTool(
  call: ModelFunctionCall,
  engine: ContextEngine,
  executeTool: IntentionsOptions['executeTool'],
  origin: Pick<
    IntentionToolRecord,
    'number' | 'role' | 'candidateNumber' | 'conversationId' | 'turnNumber'
  >,
): Promise<IntentionToolRecord> {
  let request: Record<string, unknown> | null = null;
  let result: ToolResult | null = null;

  try {
    request = parseModelToolRequest(call);
    result = structuredClone(await executeTool(request));
    const packet = retainToolEvidence(
      engine,
      request,
      result,
      intentionsLimits.maxContextBytes,
    );

    return {
      ...origin,
      status: 'complete',
      call,
      request,
      result,
      output: packet.output,
      includedEvidenceIds: packet.includedEvidenceIds,
      delivered: false,
    };
  } catch (error) {
    return { ...origin, status: 'failed', call, request, result, error };
  }
}

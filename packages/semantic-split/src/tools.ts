import { retainToolEvidence } from '@daphne/context-engine';
import type { ContextEngine } from '@daphne/context-engine';
import type { ModelFunctionCall } from '@daphne/llm';
import type { ToolResult } from '@daphne/review-evidence/contracts';
import type { SplitToolRecord, SemanticSplitOptions } from './contracts.js';
import { splitLimits } from './limits.js';
import { parseModelToolRequest } from '@daphne/review-evidence/tool-definitions';

/*
 * Execute a model lookup through the pinned, budget-bound executor and retain its
 * evidence. Origin links the result to its requesting conversation and turn; for
 * example, a writer read stays undelivered until that writer receives its output.
 * Return execution or validation failures as records so completed work survives.
 */
export async function executeSplitTool(
  call: ModelFunctionCall,
  engine: ContextEngine,
  executeTool: SemanticSplitOptions['executeTool'],
  origin: Pick<
    SplitToolRecord,
    'number' | 'role' | 'candidateNumber' | 'conversationId' | 'turnNumber'
  >,
): Promise<SplitToolRecord> {
  let request: Record<string, unknown> | null = null;
  let result: ToolResult | null = null;

  try {
    request = parseModelToolRequest(call);
    result = structuredClone(await executeTool(request));
    const packet = retainToolEvidence(
      engine,
      request,
      result,
      splitLimits.maxContextBytes,
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

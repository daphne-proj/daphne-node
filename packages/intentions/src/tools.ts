import type { ContextEngine } from '@daphne/context-engine';
import type { ModelFunctionCall, ModelFunctionTool } from '@daphne/llm';
import type { ToolResult } from '@daphne/review-evidence/contracts';
import type { IntentionToolRecord, IntentionsOptions } from './contracts.js';
import { assembleEvidence } from './context.js';
import { strictObject } from './schema.js';

const cursor = {
  type: ['string', 'null'],
  description:
    'Use null for the first page. Continue with the returned nextCursor and identical arguments.',
};
const side = { type: 'string', enum: ['base', 'head'] };
const text = { type: 'string', minLength: 1 };

export const intentionsTools = [
  {
    type: 'function',
    name: 'list_changes',
    strict: true,
    description:
      'List the pinned comparison inventory. The initial input already includes the complete inventory.',
    parameters: strictObject({ cursor }),
  },
  {
    type: 'function',
    name: 'inspect_change',
    strict: true,
    description:
      'Read a known change with three surrounding lines, merging nearby windows. Follow every nextCursor to finish.',
    parameters: strictObject({ changeId: text, cursor }),
  },
  {
    type: 'function',
    name: 'search_code',
    strict: true,
    description:
      'Search literal, case-sensitive, single-line text across either pinned revision, including unchanged files. Results are navigation previews; read source before citing code. Use null pathPrefix for the whole repository.',
    parameters: strictObject({
      side,
      query: text,
      pathPrefix: { type: ['string', 'null'] },
      cursor,
    }),
  },
  {
    type: 'function',
    name: 'read_source_lines',
    strict: true,
    description:
      'Read surrounding code in any changed or unchanged file in BASE or HEAD. Lines start at 1. Endings beyond EOF are clamped; an out-of-range start returns bounds for a retry. Continue the same window with nextCursor or issue a new range to expand it.',
    parameters: strictObject({
      side,
      path: text,
      startLine: { type: 'integer', minimum: 1 },
      lineCount: { type: 'integer', minimum: 1 },
      cursor,
    }),
  },
] satisfies ModelFunctionTool[];

function toolRequest(call: ModelFunctionCall): Record<string, unknown> {
  const tool = intentionsTools.find((tool) => tool.name === call.name);
  const args: unknown = JSON.parse(call.arguments);

  if (
    !tool ||
    typeof args !== 'object' ||
    args === null ||
    Array.isArray(args)
  ) {
    throw new Error(
      'The intentions agent requested an unsupported tool or invalid arguments.',
    );
  }

  const fields = Object.keys(tool.parameters.properties);

  if (
    Object.keys(args).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(args, field))
  ) {
    throw new Error(
      `Tool ${call.name} requires exactly these arguments: ${fields.join(', ')}.`,
    );
  }

  /* The borrowed evidence executor validates domain arguments before repository I/O. */
  return Object.freeze({ ...args, name: call.name });
}

export async function executeIntentionTool(
  call: ModelFunctionCall,
  engine: ContextEngine,
  executeTool: IntentionsOptions['executeTool'],
): Promise<IntentionToolRecord> {
  let request: Record<string, unknown> | null = null;
  let result: ToolResult | null = null;

  try {
    request = toolRequest(call);
    result = structuredClone(await executeTool(request));
    const returnedRequest = Object.fromEntries(Object.entries(result.request));

    if (
      Object.entries(request).some(
        ([key, value]) => returnedRequest[key] !== value,
      )
    ) {
      throw new Error('The tool result does not answer the requested query.');
    }

    engine.addToolResult(result);
    const evidenceIds = result.entries.flatMap((entry) =>
      entry.kind === 'source' ? [engine.addSource(entry.source)] : [],
    );
    const packet = assembleEvidence(engine, evidenceIds);
    const output = JSON.stringify({
      request: result.request,
      completeness: result.completeness,
      nextCursor: result.nextCursor,
      notices: result.notices,
      context: packet.renderedContext,
    });

    return {
      status: 'complete',
      call,
      request,
      result,
      output,
      includedEvidenceIds: packet.includedEvidenceIds,
      delivered: false,
    };
  } catch (error) {
    return { status: 'failed', call, request, result, error };
  }
}

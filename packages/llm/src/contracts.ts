/* The provider selects transport and replay rules; workflows keep the same request. */
export type ModelProvider = 'openai' | 'anthropic' | 'codex';

/* OpenAI request values; the selected model determines which levels it supports. */
export type OpenAIReasoningEffort =
  'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ModelFunctionTool {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: object;
}

export interface ModelFunctionCall {
  id: string;
  call_id: string;
  name: string;
  arguments: string;
}

/* Adapters translate these existing field names without changing workflow schemas. */
export interface ModelRequest {
  /* OpenAI and Codex, for example { effort: 'high' }; omit for Anthropic. */
  reasoning?: { effort: OpenAIReasoningEffort };
  tools?: readonly ModelFunctionTool[];
  parallel_tool_calls?: boolean;
  max_output_tokens?: number;
  instructions: string;
  input: string | readonly Record<string, unknown>[];
  text?: {
    format: { type: 'json_schema'; name: string; strict: true; schema: object };
  };
}

/* Append output unchanged to the same provider's history, including opaque reasoning. */
export interface ModelReply {
  functionCalls?: readonly ModelFunctionCall[];
  text: string;
  output: readonly Record<string, unknown>[];
  response: Record<string, unknown>;
}

/* Observations exclude credentials and request data; provider is optional for saved older events. */
export interface ModelCallObservation {
  provider?: ModelProvider;
  kind: 'count' | 'generate';
  number: number;
  /* Prefer the provider's resolved model name, falling back to the requested model. */
  model: string;
  startedAt: Date;
  endedAt: Date;
  elapsedMs: number;
  status: 'complete' | 'failed';
  response: Record<string, unknown> | null;
}

/*
 * Conversation runners borrow this client, for example model.count(request)
 * before model.generate(request). Codex counts are visible-input byte estimates.
 * Requests fail without retry; the factory's signal and deadlines bound I/O. Counters include failed attempts
 * and are caller-readable only. Reply output belongs to this provider's history.
 */
export interface ModelClient {
  calls: { count: number; generate: number };
  count(request: ModelRequest): Promise<number>;
  generate(request: ModelRequest): Promise<ModelReply>;
}

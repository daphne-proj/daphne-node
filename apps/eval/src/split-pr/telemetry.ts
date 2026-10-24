import { startObservation } from '@langfuse/tracing';
import type { ModelCallObservation } from '@daphne/review-agent';
import type { RecordedModelCall, TokenUsage } from './contracts.js';
import { integer, object } from './parse.js';

function detail(value: unknown, key: string, total: number): number | null {
  if (value === undefined || value === null) {
    return null;
  }

  const count = object(value, 'usage detail')[key];

  if (count === undefined || count === null) {
    return null;
  }

  const tokens = integer(count, key);

  if (tokens > total) {
    throw new Error('Provider token detail exceeds its total.');
  }

  return tokens;
}

export function normalizeModelUsage(
  response: Record<string, unknown> | null,
): TokenUsage | null {
  if (response?.usage === undefined || response.usage === null) {
    return null;
  }

  const usage = object(response.usage, 'usage');
  const inputTokens = integer(usage.input_tokens, 'input_tokens');
  const outputTokens = integer(usage.output_tokens, 'output_tokens');
  const total = integer(inputTokens + outputTokens, 'total_tokens');

  if (
    usage.total_tokens !== undefined &&
    integer(usage.total_tokens, 'total_tokens') !== total
  ) {
    throw new Error('Provider token totals disagree.');
  }

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: detail(
      usage.input_tokens_details,
      'cached_tokens',
      inputTokens,
    ),
    reasoningOutputTokens: detail(
      usage.output_tokens_details,
      'reasoning_tokens',
      outputTokens,
    ),
  };
}

function usageDetails(usage: TokenUsage): Record<string, number> {
  const details: Record<string, number> = {
    input: usage.inputTokens - (usage.cachedInputTokens ?? 0),
    output: usage.outputTokens - (usage.reasoningOutputTokens ?? 0),
    total: usage.inputTokens + usage.outputTokens,
  };

  if (usage.cachedInputTokens !== null) {
    details.input_cached_tokens = usage.cachedInputTokens;
  }

  if (usage.reasoningOutputTokens !== null) {
    details.output_reasoning_tokens = usage.reasoningOutputTokens;
  }

  return details;
}

/* Each recorder belongs to one trial; the active OTel context supplies its parent. */
export function createModelCallRecorder(): {
  onModelCall: (event: ModelCallObservation) => void;
  calls: RecordedModelCall[];
  issues: string[];
} {
  const calls: RecordedModelCall[] = [];
  const issues: string[] = [];

  return {
    calls,
    issues,
    onModelCall(event) {
      let usage: TokenUsage | null = null;

      try {
        if (event.kind === 'generate') {
          usage = normalizeModelUsage(event.response);
        }
      } catch {
        issues.push(
          `${event.kind} ${String(event.number)}: invalid provider usage.`,
        );
      }

      try {
        const responseModel = event.response?.model;
        const model =
          typeof responseModel === 'string' && responseModel.trim()
            ? responseModel
            : event.model;

        calls.push({
          kind: event.kind,
          number: event.number,
          model,
          startedAt: event.startedAt.toISOString(),
          endedAt: event.endedAt.toISOString(),
          elapsedMs: event.elapsedMs,
          status: event.status,
          usage,
        });

        const attributes =
          event.status === 'failed'
            ? { level: 'ERROR' as const, statusMessage: 'Model call failed.' }
            : {};
        const name = `openai.${event.kind}`;
        const observation =
          event.kind === 'generate'
            ? startObservation(
                name,
                {
                  ...attributes,
                  model,
                  ...(usage ? { usageDetails: usageDetails(usage) } : {}),
                },
                { asType: 'generation', startTime: event.startedAt },
              )
            : startObservation(name, attributes, {
                startTime: event.startedAt,
              });

        observation.end(event.endedAt);
      } catch {
        issues.push(
          `${event.kind} ${String(event.number)}: model-call recording failed.`,
        );
      }
    },
  };
}

export function collectModelCallIssues(
  calls: RecordedModelCall[],
  expected: { count: number; generate: number },
): string[] {
  const issues: string[] = [];

  for (const kind of ['count', 'generate'] as const) {
    const selected = calls.filter((call) => call.kind === kind);

    if (
      selected.length !== expected[kind] ||
      selected.some((call, index) => call.number !== index + 1)
    ) {
      issues.push(`${kind}: recorded calls do not match workflow counters.`);
    }
  }

  return issues;
}

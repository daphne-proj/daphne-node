import { startObservation } from '@langfuse/tracing';
import { normalizeModelUsage } from '@daphne/llm';
import type { ModelCallObservation, TokenUsage } from '@daphne/llm';

export interface RecordedModelCall {
  kind: 'count' | 'generate';
  number: number;
  model: string;
  startedAt: string;
  endedAt: string;
  elapsedMs: number;
  status: 'complete' | 'failed';
  usage: TokenUsage | null;
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
        const { model } = event;

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

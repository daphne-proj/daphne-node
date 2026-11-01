import { z } from 'zod';
import { normalizeModelUsage } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import type {
  IntentionModelCallObservation,
  IntentionsResult,
} from '@daphne/intentions';
import { formatCommandOutput, formatCommandTable } from './command-output.js';
import type { CommandOutputRow } from './command-output.js';
import { estimateModelCost, modelPricing } from './model-cost.js';

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const amount = z.number().nonnegative();
const text = z
  .string()
  .refine(
    (value) =>
      value.trim().length > 0 &&
      !value.includes('\0') &&
      Buffer.from(value).toString('utf8') === value,
  );
const usageSchema = z.object({
  generations: count,
  counts: count,
  failed: count,
  inputTokens: count,
  outputTokens: count,
  missingUsage: count,
  costUsd: amount,
  unpricedCalls: count,
  apiElapsedMs: amount,
});
const summarySchema = z.object({
  provider: z.enum(['openai', 'anthropic']),
  model: text,
  elapsedMs: amount,
  pricingAsOf: text,
  pricingSource: text,
  total: usageSchema,
  agents: z.array(
    z.object({
      conversationId: text,
      name: text,
      candidateNumber: count.nullable(),
      complete: z.boolean(),
      tools: count,
      usage: usageSchema,
    }),
  ),
});

type UsageSummary = z.infer<typeof usageSchema>;

/* Share one accounting shape between generation and evaluation without exposing it to the judge. */
export type IntentionRunSummary = z.infer<typeof summarySchema>;

/* Missing or invalid saved accounting is unavailable; it never changes explanation acceptance. */
export function parseIntentionRunSummary(
  value: unknown,
): IntentionRunSummary | null {
  const result = summarySchema.safeParse(value);
  return result.success ? result.data : null;
}

function summarizeCalls(
  calls: IntentionModelCallObservation[],
  provider: ModelProvider,
  model: string,
): UsageSummary {
  const summary = {
    generations: 0,
    counts: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    missingUsage: 0,
    costUsd: 0,
    unpricedCalls: 0,
    apiElapsedMs: 0,
  };

  for (const call of calls) {
    summary.apiElapsedMs += call.elapsedMs;
    summary.failed += Number(call.status === 'failed');

    if (call.kind === 'count') {
      summary.counts += 1;
      continue;
    }

    summary.generations += 1;
    let usage;

    try {
      usage = normalizeModelUsage(call.response, provider);
    } catch {
      usage = null;
    }

    if (usage === null) {
      summary.missingUsage += 1;
      summary.unpricedCalls += 1;
      continue;
    }

    summary.inputTokens += usage.inputTokens;
    summary.outputTokens += usage.outputTokens;
    const cost = estimateModelCost(call, provider, model, usage);

    if (cost === null) {
      summary.unpricedCalls += 1;
    } else {
      summary.costUsd += cost;
    }
  }

  return summary;
}

/*
 * Build once from this run's observations, for example after investigation ends.
 * Per-agent time sums count/generation HTTP durations; elapsedMs is the whole
 * workflow's wall time, so parallel agent times must not be added to it.
 * Failed generations with returned usage are included in the cost estimate.
 */
export function summarizeIntentionRun(
  calls: IntentionModelCallObservation[],
  investigation: IntentionsResult | null,
  provider: ModelProvider,
  model: string,
  elapsedMs: number,
): IntentionRunSummary {
  const conversations = new Map<string, IntentionModelCallObservation[]>();

  for (const call of calls) {
    const group = conversations.get(call.conversationId) ?? [];
    group.push(call);
    conversations.set(call.conversationId, group);
  }

  const agents = [...conversations].map(([conversationId, group]) => {
    const first = group[0];
    const writer = first?.role === 'writer';
    const reviewer = conversationId.split('-')[1];
    const names: Record<string, string> = {
      accuracy: 'Accuracy + evidence',
      issues: 'Issues',
      completeness: 'Completeness + coherence',
    };
    const turns =
      investigation?.turns.filter(
        (turn) => turn.conversationId === conversationId,
      ) ?? [];
    const complete = turns.some((turn) =>
      turn.role === 'writer'
        ? turn.validation?.status === 'valid'
        : turn.review !== null,
    );

    return {
      conversationId,
      name: writer ? 'Producer' : (names[reviewer ?? ''] ?? conversationId),
      candidateNumber: writer ? null : (first?.candidateNumber ?? null),
      complete,
      tools:
        investigation?.tools.filter(
          (tool) => tool.conversationId === conversationId,
        ).length ?? 0,
      usage: summarizeCalls(group, provider, model),
    };
  });
  agents.sort((left, right) => {
    const order = [
      'Producer',
      'Accuracy + evidence',
      'Issues',
      'Completeness + coherence',
    ];
    return (
      (left.candidateNumber ?? 0) - (right.candidateNumber ?? 0) ||
      order.indexOf(left.name) - order.indexOf(right.name)
    );
  });

  return {
    provider,
    model,
    elapsedMs,
    pricingAsOf: modelPricing.asOf,
    pricingSource: modelPricing[provider],
    total: summarizeCalls(calls, provider, model),
    agents,
  };
}

export function formatElapsedTime(ms: number): string {
  return ms < 60_000
    ? `${(ms / 1000).toFixed(1)}s`
    : `${String(Math.floor(ms / 60_000))}m ${((ms % 60_000) / 1000).toFixed(1)}s`;
}

function costLabel(usage: UsageSummary): string {
  if (usage.unpricedCalls === 0) {
    return `$${usage.costUsd.toFixed(4)}`;
  }

  return usage.unpricedCalls === usage.generations
    ? 'Unavailable'
    : `$${usage.costUsd.toFixed(4)} + unknown`;
}

/* Render saved generation accounting in both CLI commands, independently of evaluation scores. */
export function formatIntentionRunSummary(
  summary: IntentionRunSummary,
): string {
  const { total } = summary;
  const number = (value: number) => value.toLocaleString('en-US');
  const sections = [
    formatCommandOutput('Generation', [
      { label: 'Model', value: `${summary.provider} / ${summary.model}` },
      { label: 'Elapsed', value: formatElapsedTime(summary.elapsedMs) },
      {
        label: 'Generation cost (USD estimate)',
        value: costLabel(total),
        tone: total.unpricedCalls > 0 ? 'warning' : 'success',
      },
      {
        label: 'Input / output tokens',
        value: `${number(total.inputTokens)} / ${number(total.outputTokens)}${total.missingUsage > 0 ? ' (partial)' : ''}`,
      },
    ]),
  ];

  if (summary.agents.length > 0) {
    sections.push(
      formatCommandTable(
        'Producer and parallel reviewers',
        [
          'Agent',
          'Round',
          'Result',
          'LLM / count',
          'Tools',
          'In / out',
          'API time',
          'Est. USD',
        ],
        summary.agents.map((agent) => {
          let result = 'Incomplete';
          let tone: CommandOutputRow['tone'] = 'warning';

          if (agent.usage.failed > 0) {
            result = 'Failed';
            tone = 'error';
          } else if (agent.complete) {
            result = 'Complete';
            tone = 'success';
          }

          return {
            values: [
              agent.name,
              agent.candidateNumber === null
                ? 'All'
                : String(agent.candidateNumber),
              result,
              `${String(agent.usage.generations)} / ${String(agent.usage.counts)}`,
              String(agent.tools),
              `${number(agent.usage.inputTokens)} / ${number(agent.usage.outputTokens)}${agent.usage.missingUsage > 0 ? '*' : ''}`,
              formatElapsedTime(agent.usage.apiElapsedMs),
              costLabel(agent.usage),
            ],
            tone,
          };
        }),
      ),
    );
  }

  sections.push(
    'API time includes token-count and generation calls; parallel times overlap.',
  );

  if (total.unpricedCalls > 0) {
    sections.push(
      `${String(total.unpricedCalls)} generation call(s) lack complete usage or verified pricing; the full cost is unavailable.`,
    );
  }

  if (total.missingUsage > 0) {
    sections.push(
      '* Token totals exclude calls with missing or malformed usage.',
    );
  }

  sections.push(
    `List-price estimate, rates checked ${summary.pricingAsOf}; excludes independent judge billing, taxes and account discounts.`,
    '',
  );
  return sections.join('\n');
}

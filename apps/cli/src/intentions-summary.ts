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
 * API time sums count/generation HTTP durations; elapsedMs also includes
 * repository acquisition, tool execution and cleanup.
 * Failed generations with returned usage are included in the cost estimate.
 */
export function summarizeIntentionRun(
  calls: IntentionModelCallObservation[],
  investigation: IntentionsResult | null,
  provider: ModelProvider,
  model: string,
  elapsedMs: number,
): IntentionRunSummary {
  const total = summarizeCalls(calls, provider, model);
  const agents: IntentionRunSummary['agents'] = [];

  if (calls.length > 0) {
    agents.push({
      conversationId: 'writer',
      name: 'Producer',
      complete:
        investigation?.turns.some(
          (turn) => turn.validation?.status === 'valid',
        ) ?? false,
      tools: investigation?.tools.length ?? 0,
      usage: total,
    });
  }

  return {
    provider,
    model,
    elapsedMs,
    pricingAsOf: modelPricing.asOf,
    pricingSource: modelPricing[provider],
    total,
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
        'Investigation',
        [
          'Agent',
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

  sections.push('API time includes token-count and generation calls.');

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

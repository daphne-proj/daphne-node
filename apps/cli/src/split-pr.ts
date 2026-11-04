import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  defaultModels,
  parseModelProvider,
  parseOpenAIReasoningEffort,
} from '@daphne/llm';
import type { ModelProvider, OpenAIReasoningEffort } from '@daphne/llm';
import { parsePullRequestUrl } from '@daphne/pr-review';
import { splitPullRequest } from '@daphne/pr-review/split';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import type { RunBudgetPolicy } from '@daphne/evaluator-optimizer';
import { formatCommandOutput } from './command-output.js';
import type { CommandOutputRow } from './command-output.js';
import { CliInputError, describeFailure } from './errors.js';
import { createRunDirectory, writeArtifact } from './output.js';
import { serializeSplitInvestigation } from './split-pr-report.js';

interface SplitOptions extends RunBudgetPolicy {
  pr: string;
  output: string;
  provider?: ModelProvider;
  model: string;
  reasoningEffort?: OpenAIReasoningEffort;
  maxInputTokens: number;
}

export function parseSplitArgs(args: string[]): SplitOptions {
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        pr: { type: 'string' },
        output: { type: 'string' },
        provider: { type: 'string', default: 'openai' },
        model: { type: 'string' },
        'reasoning-effort': { type: 'string' },
        'max-input-tokens': { type: 'string', default: '256000' },
        'max-candidates': { type: 'string' },
        'run-timeout-ms': { type: 'string' },
      },
    });
    const provider = parseModelProvider(values.provider);
    const defaultEffort = provider === 'codex' ? 'high' : 'medium';
    const reasoningEffort =
      provider !== 'anthropic'
        ? parseOpenAIReasoningEffort(
            values['reasoning-effort'] ?? defaultEffort,
          )
        : undefined;
    const model = values.model ?? defaultModels[provider];
    const maxInputTokens = Number(values['max-input-tokens']);

    if (
      !values.pr ||
      !values.output?.trim() ||
      values.output.includes('\0') ||
      !model.trim() ||
      (provider === 'anthropic' && values['reasoning-effort'] !== undefined) ||
      !Number.isSafeInteger(maxInputTokens) ||
      maxInputTokens < 1
    ) {
      throw new CliInputError();
    }

    return {
      pr: values.pr,
      output: values.output,
      provider,
      model,
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      maxInputTokens,
      ...(values['max-candidates'] === undefined
        ? {}
        : { maxCandidates: Number(values['max-candidates']) }),
      ...(values['run-timeout-ms'] === undefined
        ? {}
        : { timeoutMs: Number(values['run-timeout-ms']) }),
    };
  } catch {
    throw new CliInputError(
      'Usage: split-pr --pr URL --output DIRECTORY [--provider openai|anthropic|codex] [--model MODEL] [--reasoning-effort none|minimal|low|medium|high|xhigh|max (OpenAI/Codex; defaults medium/high)] [--max-input-tokens NUMBER] [--max-candidates NUMBER] [--run-timeout-ms NUMBER]',
    );
  }
}

/* Start the global budget before preparation and keep its signal through accepted artifact publication. */
export async function runSplitPr(
  options: SplitOptions,
  signal: AbortSignal,
): Promise<number> {
  let budget;

  try {
    budget = createRunBudget(options, signal);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new CliInputError(error.message);
    }

    throw error;
  }

  budget.signal.throwIfAborted();

  const ref = parsePullRequestUrl(options.pr);

  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const provider = options.provider ?? 'openai';
  const defaultEffort = provider === 'codex' ? 'high' : 'medium';
  const reasoningEffort =
    provider !== 'anthropic'
      ? (options.reasoningEffort ?? defaultEffort)
      : undefined;
  const apiKeyVariable = `${provider.toUpperCase()}_API_KEY`;
  const apiKey = provider === 'codex' ? '' : process.env[apiKeyVariable];

  if (provider !== 'codex' && !apiKey?.trim()) {
    throw new CliInputError(
      `Set ${apiKeyVariable} in .env or the environment.`,
    );
  }

  const directory = await createRunDirectory(options.output, { reuse: true });
  const githubToken = process.env.GITHUB_TOKEN;

  if (process.stderr.isTTY) {
    process.stderr.write(
      formatCommandOutput(`Split PR #${String(ref.number)}`, [
        { label: 'Pull request', value: ref.url },
        { label: 'Provider', value: provider },
        { label: 'Model', value: options.model },
        { label: 'Run artifact', value: join(directory, 'run.json') },
      ]) + '\n',
    );
  }

  const result = await splitPullRequest(ref, {
    apiKey: apiKey ?? '',
    provider,
    model: options.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    maxInputTokens: options.maxInputTokens,
    budget,
    ...(githubToken === undefined ? {} : { githubToken }),
  });
  const errors = result.errors.map(({ stage, error }) =>
    describeFailure(stage, error),
  );

  /* Persist original evidence and the current investigation, with no legacy artifact branch. */
  const report = {
    status: result.status,
    pr: ref.url,
    provider,
    model: options.model,
    reasoningEffort: reasoningEffort ?? null,
    maxInputTokens: options.maxInputTokens,
    budget: {
      maxCandidates: budget.maxCandidates,
      deadlineAt: budget.deadlineAt,
    },
    metadata: result.metadata,
    identity: result.identity,
    changes: result.changes,
    hunks: result.hunks.map(({ change, hunkIndex, sources }) => ({
      changeId: change.id,
      hunkIndex,
      sources,
    })),
    limitations: result.limitations,
    investigation: serializeSplitInvestigation(result.investigation),
    proposal: result.proposal,
    response: result.response,
    errors,
  };

  let output: string | null = join(directory, 'run.json');

  try {
    await writeArtifact(
      directory,
      'run.json',
      report,
      report.status === 'complete' ? budget.signal : undefined,
      { overwrite: true },
    );
  } catch (error) {
    /* Preserve completed work without accepted output when publication fails or is cancelled. */
    report.status = 'failed';
    report.proposal = null;
    report.response = null;
    const failure = describeFailure('run_output', error);
    errors.push(failure);

    if (report.investigation !== null) {
      report.investigation = {
        ...report.investigation,
        status: 'failed',
        proposal: null,
        response: null,
        acceptedCandidate: null,
        error: failure,
      };
    }

    try {
      await writeArtifact(directory, 'run.json', report, undefined, {
        overwrite: true,
      });
    } catch (publicationError) {
      errors.push(describeFailure('run_output', publicationError));
      output = null;
    }
  }

  const summary = {
    status: report.status,
    turns: result.investigation?.turns.length ?? 0,
    tools: result.investigation?.tools.length ?? 0,
    attempts: result.investigation?.attempts.length ?? 0,
    groups: report.proposal?.groups.length ?? 0,
    output,
    errors,
  };

  if (process.stdout.isTTY) {
    const rows: CommandOutputRow[] = [
      {
        label: 'Status',
        value: summary.status,
        tone: summary.status === 'complete' ? 'success' : 'error',
      },
      { label: 'Turns', value: String(summary.turns) },
      { label: 'Tools', value: String(summary.tools) },
      { label: 'Attempts', value: String(summary.attempts) },
      { label: 'Groups', value: String(summary.groups) },
      {
        label: 'Run artifact',
        value: summary.output ?? 'Could not save run.json',
      },
    ];

    for (const error of errors) {
      rows.push({ label: 'Error', value: error.message, tone: 'error' });
    }

    process.stdout.write(
      '\n' + formatCommandOutput('Split result', rows) + '\n',
    );
  } else {
    process.stdout.write(JSON.stringify(summary) + '\n');
  }

  return report.status === 'complete' ? 0 : 1;
}

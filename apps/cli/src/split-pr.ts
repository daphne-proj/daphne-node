import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { defaultModels, parseModelProvider } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import { parsePullRequestUrl } from '@daphne/pr-review';
import { splitPullRequest } from '@daphne/pr-review/split';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import type { RunBudgetPolicy } from '@daphne/evaluator-optimizer';
import { formatCommandOutput } from './command-output.js';
import type { CommandOutputRow } from './command-output.js';
import { CliInputError, describeFailure } from './errors.js';
import { ArtifactError, createRunDirectory, writeArtifact } from './output.js';

interface SplitOptions extends RunBudgetPolicy {
  pr: string;
  output: string;
  provider?: ModelProvider;
  model: string;
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
        'max-input-tokens': { type: 'string', default: '16384' },
        'max-candidates': { type: 'string' },
        'run-timeout-ms': { type: 'string' },
      },
    });
    const provider = parseModelProvider(values.provider);
    const model = values.model ?? defaultModels[provider];
    const maxInputTokens = Number(values['max-input-tokens']);

    if (
      !values.pr ||
      !values.output?.trim() ||
      values.output.includes('\0') ||
      !model.trim() ||
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
      'Usage: split-pr --pr URL --output DIRECTORY [--provider openai|anthropic] [--model MODEL] [--max-input-tokens NUMBER] [--max-candidates NUMBER] [--run-timeout-ms NUMBER]',
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
  const apiKeyVariable = `${provider.toUpperCase()}_API_KEY`;
  const apiKey = process.env[apiKeyVariable];

  if (!apiKey?.trim()) {
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
    apiKey,
    provider,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    budget,
    ...(githubToken === undefined ? {} : { githubToken }),
    onPage: (page, pageNumber) => {
      process.stderr.write(
        `  Page ${String(pageNumber)} ready · ${String(page.unitIds.length)} units\n`,
      );
    },
  });
  const errors = result.errors.map((error) => describeFailure('split', error));

  /* The command owns the versioned file format; the workflow returns typed results. */
  const report = {
    format: 'daphne-split-pr-v3',
    status: result.status,
    pr: ref.url,
    provider,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    budget: result.budget,
    identity: result.identity,
    changes: result.changes,
    hunks: result.hunks.map(({ change, hunkIndex, sources }) => ({
      changeId: change.id,
      hunkIndex,
      sources,
    })),
    pages: result.pages,
    proposal: result.proposal,
    response: result.response,
    attempts: result.attempts,
    calls: result.calls,
    errors,
  };

  try {
    await writeArtifact(
      directory,
      'run.json',
      report,
      report.status === 'complete' ? budget.signal : undefined,
      { overwrite: true },
    );
  } catch (error) {
    if (!(error instanceof ArtifactError) || error.code !== 'cancelled') {
      throw error;
    }

    /* Preserve completed work in a failed report after cancelled publication. */
    report.status = 'failed';
    report.proposal = null;
    report.response = null;
    errors.push(describeFailure('run_output', error));
    await writeArtifact(directory, 'run.json', report, undefined, {
      overwrite: true,
    });
  }

  const summary = {
    status: report.status,
    pages: result.pages.length,
    groups: report.proposal?.groups.length ?? 0,
    output: join(directory, 'run.json'),
    errors,
  };

  if (process.stdout.isTTY) {
    const rows: CommandOutputRow[] = [
      {
        label: 'Status',
        value: summary.status,
        tone: summary.status === 'complete' ? 'success' : 'error',
      },
      { label: 'Pages', value: String(summary.pages) },
      { label: 'Groups', value: String(summary.groups) },
      { label: 'Run artifact', value: summary.output },
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

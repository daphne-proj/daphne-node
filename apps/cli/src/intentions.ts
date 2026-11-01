import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { defaultModels, parseModelProvider } from '@daphne/llm';
import type { ModelProvider } from '@daphne/llm';
import { parsePullRequestUrl } from '@daphne/pr-review';
import { analyzePullRequestIntentions } from '@daphne/pr-review/intentions';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import type { RunBudgetPolicy } from '@daphne/evaluator-optimizer';
import type { IntentionModelCallObservation } from '@daphne/intentions';
import { formatCommandOutput } from './command-output.js';
import type { CommandOutputRow } from './command-output.js';
import { CliInputError, describeFailure } from './errors.js';
import { serializeInvestigation } from './intentions-report.js';
import { createRunDirectory, writeArtifact } from './output.js';

interface IntentionsOptions extends RunBudgetPolicy {
  pr: string;
  output: string;
  provider?: ModelProvider;
  model: string;
  maxInputTokens: number;
}

/* Validates the intentions command's flags before environment loading or I/O. */
export function parseIntentionsArgs(args: string[]): IntentionsOptions {
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
        'max-input-tokens': { type: 'string', default: '256000' },
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
      'Usage: intentions --pr URL --output NEW_DIRECTORY [--provider openai|anthropic] [--model MODEL] [--max-input-tokens NUMBER] [--max-candidates NUMBER] [--run-timeout-ms NUMBER]',
    );
  }
}

/*
 * Runs the PR workflow for the CLI, for example after parseIntentionsArgs(args).
 * The output directory must be new. Cancellation or the optional run deadline
 * stops the workflow, which closes Git before returning its collected work.
 * Save that work even on failure and print indented JSON; exit 0 requires both
 * a complete workflow and successful artifact publication. Setup errors throw
 * to main.ts; publication errors return exit 1 after a best-effort failed report.
 */
export async function runIntentionsPr(
  options: IntentionsOptions,
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

  const directory = await createRunDirectory(options.output);
  const artifactPath = join(directory, 'run.json');
  const githubToken = process.env.GITHUB_TOKEN;
  const modelCalls: IntentionModelCallObservation[] = [];
  const startedAt = new Date();
  const startedMs = performance.now();

  if (process.stderr.isTTY) {
    process.stderr.write(
      formatCommandOutput(`Intentions for PR #${String(ref.number)}`, [
        { label: 'Pull request', value: ref.url },
        { label: 'Provider', value: provider },
        { label: 'Model', value: options.model },
        { label: 'Run artifact', value: artifactPath },
      ]) + '\n',
    );
  }

  const result = await analyzePullRequestIntentions(ref, {
    apiKey,
    provider,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    budget,
    ...(githubToken === undefined ? {} : { githubToken }),
    onModelCall: (call) => {
      modelCalls.push(call);
    },
  });
  const errors = result.errors.map(({ stage, error }) =>
    describeFailure(stage, error),
  );
  const report = {
    status: result.status,
    pr: ref.url,
    provider,
    model: options.model,
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
    investigation: serializeInvestigation(result.investigation),
    proposal: result.proposal,
    response: result.response,
    modelCalls: modelCalls.map((call) => ({
      kind: call.kind,
      role: call.role,
      candidateNumber: call.candidateNumber,
      conversationId: call.conversationId,
      number: call.number,
      provider: call.provider ?? provider,
      model: call.model,
      status: call.status,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      elapsedMs: call.elapsedMs,
      usage: call.response?.usage ?? null,
      inputTokens: call.response?.input_tokens ?? null,
    })),
    timing: {
      startedAt,
      finishedAt: new Date(),
      elapsedMs: performance.now() - startedMs,
    },
    errors,
  };
  let output: string | null = artifactPath;

  try {
    await writeArtifact(
      directory,
      'run.json',
      report,
      report.status === 'complete' ? budget.signal : undefined,
    );
  } catch (error) {
    /*
     * A cancelled or failed publication cannot leave accepted output. Keep the
     * investigation for diagnosis and replace only this run's own report if
     * publication succeeded before temporary-file cleanup failed.
     */
    report.status = 'failed';
    report.proposal = null;
    report.response = null;
    errors.push(describeFailure('run_output', error));

    try {
      await writeArtifact(directory, 'run.json', report, undefined, {
        overwrite: true,
      });
    } catch (publicationError) {
      errors.push(describeFailure('run_output', publicationError));
      output = null;
    }
  }

  if (process.stderr.isTTY) {
    const rows: CommandOutputRow[] = [
      {
        label: 'Status',
        value: report.status,
        tone: report.status === 'complete' ? 'success' : 'error',
      },
      {
        label: 'Intentions',
        value: String(report.proposal?.intentions.length ?? 0),
      },
      { label: 'Run artifact', value: output ?? 'Could not save run.json' },
    ];

    for (const error of errors) {
      rows.push({ label: 'Error', value: error.message, tone: 'error' });
    }

    process.stderr.write(formatCommandOutput('Intentions result', rows) + '\n');
  }

  process.stdout.write(
    JSON.stringify(
      { status: report.status, proposal: report.proposal, output, errors },
      null,
      2,
    ) + '\n',
  );

  return report.status === 'complete' ? 0 : 1;
}

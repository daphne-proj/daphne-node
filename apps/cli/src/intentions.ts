import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { parsePullRequestUrl } from '@daphne/pr-review';
import { analyzePullRequestIntentions } from '@daphne/pr-review/intentions';
import type { ModelCallObservation } from '@daphne/llm';
import { formatCommandOutput } from './command-output.js';
import type { CommandOutputRow } from './command-output.js';
import { CliInputError, describeFailure } from './errors.js';
import { serializeInvestigation } from './intentions-report.js';
import { createRunDirectory, writeArtifact } from './output.js';

interface IntentionsOptions {
  pr: string;
  output: string;
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
        model: { type: 'string', default: 'gpt-6-sol' },
        'max-input-tokens': { type: 'string', default: '256000' },
      },
    });
    const maxInputTokens = Number(values['max-input-tokens']);

    if (
      !values.pr ||
      !values.output?.trim() ||
      values.output.includes('\0') ||
      !values.model.trim() ||
      !Number.isSafeInteger(maxInputTokens) ||
      maxInputTokens < 1
    ) {
      throw new CliInputError();
    }

    return {
      pr: values.pr,
      output: values.output,
      model: values.model,
      maxInputTokens,
    };
  } catch {
    throw new CliInputError(
      'Usage: intentions --pr URL --output NEW_DIRECTORY [--model MODEL] [--max-input-tokens NUMBER]',
    );
  }
}

/*
 * Runs the PR workflow for the CLI, for example after parseIntentionsArgs(args).
 * The output directory must be new. Cancellation or the ten-minute deadline
 * stops the workflow, which closes Git before returning its collected work.
 * Save that work even on failure and print indented JSON; exit 0 requires both
 * a complete workflow and successful artifact publication. Setup errors throw
 * to main.ts; publication errors return exit 1 after a best-effort failed report.
 */
export async function runIntentionsPr(
  options: IntentionsOptions,
  signal: AbortSignal,
): Promise<number> {
  const ref = parsePullRequestUrl(options.pr);

  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey?.trim()) {
    throw new CliInputError('Set OPENAI_API_KEY in .env or the environment.');
  }

  const directory = await createRunDirectory(options.output);
  const artifactPath = join(directory, 'run.json');
  const githubToken = process.env.GITHUB_TOKEN;
  const hostDeadlineMs = 600_000;
  const runSignal = AbortSignal.any([
    signal,
    AbortSignal.timeout(hostDeadlineMs),
  ]);
  const modelCalls: ModelCallObservation[] = [];
  const startedAt = new Date();
  const startedMs = performance.now();

  if (process.stderr.isTTY) {
    process.stderr.write(
      formatCommandOutput(`Intentions for PR #${String(ref.number)}`, [
        { label: 'Pull request', value: ref.url },
        { label: 'Model', value: options.model },
        { label: 'Run artifact', value: artifactPath },
      ]) + '\n',
    );
  }

  const result = await analyzePullRequestIntentions(ref, {
    apiKey,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    signal: runSignal,
    ...(githubToken === undefined ? {} : { githubToken }),
    onModelCall: (call) => {
      modelCalls.push(call);
    },
  });
  const errors = result.errors.map(({ stage, error }) =>
    describeFailure(stage, error),
  );
  const report = {
    format: 'daphne-intentions-v1',
    status: result.status,
    pr: ref.url,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    hostDeadlineMs,
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
      number: call.number,
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
      report.status === 'complete' ? runSignal : undefined,
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

import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import { createRunBudget } from '@daphne/evaluator-optimizer';
import type { RunBudgetPolicy } from '@daphne/evaluator-optimizer';
import type { SplitTrial } from './contracts.js';
import { loadSplitCase } from './dataset.js';
import { runSplitCase } from './repository.js';
import { toSplitTrial } from './trial.js';
import { createModelCallRecorder } from '../model-calls.js';
import { writeJsonArtifact } from '../artifacts.js';
import { EvaluationError } from '../parse.js';

/* Local replay uses the same pinned runner as experiments and never opens telemetry. */
export async function runFrozenSplit(
  options: SplitTrial['modelConfig'] &
    RunBudgetPolicy & {
      casePath: string;
      referencePath?: string;
      outputDirectory: string;
    },
  signal: AbortSignal,
): Promise<number> {
  const budget = createRunBudget(options, signal);
  const prepared = await loadSplitCase(options.casePath, options.referencePath);
  const directory = resolve(options.outputDirectory);

  if (
    !Number.isSafeInteger(options.maxInputTokens) ||
    options.maxInputTokens < 1 ||
    (await isGoldenDatasetPath(directory))
  ) {
    throw new EvaluationError(
      'Use a positive input limit and an output outside the golden dataset.',
    );
  }

  budget.signal.throwIfAborted();
  await mkdir(directory, { mode: 0o700 });

  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const provider = options.provider ?? 'openai';
  const variable = `${provider.toUpperCase()}_API_KEY`;
  const apiKey = provider === 'codex' ? '' : process.env[variable]?.trim();

  if (apiKey === undefined || (provider !== 'codex' && !apiKey)) {
    throw new EvaluationError(
      `${variable} is required for frozen split replay.`,
    );
  }

  const modelConfig = {
    provider,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    ...(options.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: options.reasoningEffort }),
  };
  const recorder = createModelCallRecorder();
  const started = performance.now();
  const result = await runSplitCase(prepared, {
    ...modelConfig,
    apiKey,
    budget,
    onModelCall: recorder.onModelCall,
  });
  const trial = toSplitTrial(
    prepared,
    result,
    { trialNumber: 1, elapsedMs: performance.now() - started },
    modelConfig,
    recorder.calls,
  );
  const frozen = prepared.definition.evidence;
  const identity = result.comparison?.identity ?? frozen.identity;
  const report = {
    status: trial.result.status,
    pr: frozen.pr.url,
    ...modelConfig,
    reasoningEffort: modelConfig.reasoningEffort ?? null,
    budget: result.budget,
    metadata: {
      ref: { url: frozen.pr.url },
      title: frozen.pr.title,
      body: frozen.pr.body,
      ...frozen.source,
    },
    identity,
    changes: frozen.changes,
    hunks: frozen.hunks.map((hunk) => ({
      ...hunk,
      sources: hunk.sources.map((source) => ({
        ...source,
        ref: { ...source.ref, sessionId: identity.sessionId },
      })),
    })),
    limitations: result.limitations,
    investigation: trial.result,
    proposal: trial.result.proposal,
    response: trial.result.response,
    errors: trial.result.status === 'failed' ? [trial.result.error] : [],
    elapsedMs: trial.elapsedMs,
    modelCalls: trial.modelCalls,
  };

  try {
    await writeJsonArtifact(
      join(directory, 'run.json'),
      report,
      report.status === 'complete' ? budget.signal : undefined,
    );
  } catch (error) {
    if (!budget.signal.aborted || error !== budget.signal.reason) {
      throw error;
    }

    const failure = {
      name: 'SplitError',
      message: 'Frozen split publication was cancelled.',
    };
    report.status = 'failed';
    report.proposal = null;
    report.response = null;
    report.errors.push(failure);
    report.investigation = {
      ...report.investigation,
      status: 'failed',
      proposal: null,
      response: null,
      acceptedCandidate: null,
      error: failure,
    };
    await writeJsonArtifact(join(directory, 'run.json'), report);
  }

  process.stdout.write(
    JSON.stringify({
      status: report.status,
      output: join(directory, 'run.json'),
      calls: result.calls,
    }) + '\n',
  );
  return report.status === 'complete' ? 0 : 1;
}

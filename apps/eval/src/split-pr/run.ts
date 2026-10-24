import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { promisify } from 'node:util';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import {
  correctionInstructions,
  groupingInstructions,
  pageInstructions,
  proposalSchema,
} from '@daphne/semantic-split';
import {
  LangfuseConfigurationError,
  readLangfuseConnection,
  withLangfuse,
} from '../langfuse.js';
import type { SplitRunManifest, SplitRunOptions } from './contracts.js';
import { loadSplitSuite } from './dataset.js';
import { runSplitExperiment } from './experiment.js';
import { sha256, SplitDatasetError } from './parse.js';
import { writeJsonArtifact } from './report.js';
import { splitScorerVersion } from './score.js';

function positiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new SplitDatasetError(`${field}: expected a positive safe integer.`);
  }
}

async function gitState(): Promise<SplitRunManifest['git']> {
  const git = promisify(execFile);
  const [{ stdout: commit }, { stdout: changes }] = await Promise.all([
    git('git', ['rev-parse', 'HEAD']),
    git('git', ['status', '--porcelain']),
  ]);

  return { commit: commit.trim(), dirty: changes.length > 0 };
}

/* Validate and reserve output before reading credentials or opening telemetry. */
export async function runSplitEvaluation(
  options: SplitRunOptions,
  signal: AbortSignal,
): Promise<number> {
  positiveInteger(options.trials, '--trials');
  positiveInteger(options.concurrency, '--concurrency');
  positiveInteger(options.maxInputTokens, '--max-input-tokens');
  const outputDirectory = resolve(options.outputDirectory);

  if (await isGoldenDatasetPath(outputDirectory)) {
    throw new SplitDatasetError(
      'The golden dataset is read-only; choose an output outside its cases directory.',
    );
  }

  const suite = await loadSplitSuite(options.suitePath);
  const cases = suite.cases.filter(
    ({ definition }) => definition.partition === options.partition,
  );

  if (
    cases.length === 0 ||
    cases.some(({ definition }) => definition.review.status !== 'reviewed')
  ) {
    throw new SplitDatasetError(
      'The selected partition must contain cases and every selected case must be reviewed.',
    );
  }

  signal.throwIfAborted();
  const git = await gitState();

  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch {
    throw new SplitDatasetError(
      '--output must be a new directory in an existing parent.',
    );
  }

  const manifest: SplitRunManifest = {
    format: 'daphne-split-eval-run-v1',
    suiteId: suite.id,
    datasetHash: suite.datasetHash,
    partition: options.partition,
    modelConfig: {
      model: options.model,
      maxInputTokens: options.maxInputTokens,
    },
    scorerVersion: splitScorerVersion,
    promptHash: sha256(
      JSON.stringify([
        pageInstructions,
        groupingInstructions,
        correctionInstructions,
        proposalSchema,
      ]),
    ),
    sdkVersion: '6.0.2',
    git,
    startedAt: new Date().toISOString(),
    trials: options.trials,
    concurrency: options.concurrency,
    status: 'incomplete',
    cases: Array.from({ length: options.trials }, (_, index) =>
      cases.map(({ definition, inputHash, caseHash }) => ({
        caseId: definition.id,
        inputHash,
        caseHash,
        trialNumber: index + 1,
        trialFile: null,
        scores: null,
        issues: [],
      })),
    ).flat(),
    experiments: [],
    issues: [],
  };

  try {
    /* A separate initial schedule survives interruption without overwriting any artifact. */
    await writeJsonArtifact(join(outputDirectory, 'scheduled.json'), manifest);

    if (existsSync('.env')) {
      loadEnvFile('.env');
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();

    if (!apiKey) {
      throw new LangfuseConfigurationError(
        'OPENAI_API_KEY is required for split-pr run.',
      );
    }

    const connection = readLangfuseConnection(process.env);
    signal.throwIfAborted();

    await withLangfuse(connection, async (client) => {
      for (let trialNumber = 1; trialNumber <= options.trials; trialNumber++) {
        if (signal.aborted) {
          break;
        }

        await runSplitExperiment(
          client,
          cases,
          manifest,
          trialNumber,
          outputDirectory,
          apiKey,
          signal,
        );
      }
    });
  } catch (error) {
    manifest.issues.push(
      error instanceof LangfuseConfigurationError
        ? error.message
        : 'Evaluation setup, persistence or telemetry finalization failed.',
    );
  }

  if (signal.aborted) {
    manifest.issues.push('Command cancelled.');
  }

  for (const entry of manifest.cases) {
    if (!entry.trialFile || !entry.scores) {
      entry.issues.push(
        signal.aborted
          ? 'Scheduled case cancelled or incomplete.'
          : 'Scheduled case is missing its local trial or scores.',
      );
    }
  }

  if (manifest.experiments.length !== options.trials) {
    manifest.issues.push('Not all scheduled experiments ran.');
  }

  const incomplete =
    manifest.issues.length > 0 ||
    manifest.cases.some((entry) => entry.issues.length > 0) ||
    manifest.experiments.some((experiment) => experiment.issues.length > 0);
  manifest.status = incomplete ? 'incomplete' : 'complete';
  const manifestFile = join(outputDirectory, 'manifest.json');

  try {
    await writeJsonArtifact(manifestFile, manifest);

    if (signal.aborted && !manifest.issues.includes('Command cancelled.')) {
      manifest.status = 'incomplete';
      manifest.issues.push('Command cancelled.');
      const cancelledFile = join(outputDirectory, '.cancelled-manifest.json');

      /* Replace only this run's own manifest if cancellation arrived during its save. */
      await writeJsonArtifact(cancelledFile, manifest);
      await rename(cancelledFile, manifestFile);
    }
  } catch {
    manifest.status = 'incomplete';
    manifest.issues.push(
      'Could not publish the final manifest. See the initial schedule and saved trial files.',
    );
  }

  const accepted = manifest.cases.filter(
    (entry) => entry.scores?.accepted,
  ).length;
  const constraintFailures = manifest.cases.filter(
    (entry) => entry.scores && !entry.scores.constraintsPassed,
  ).length;

  process.stdout.write(
    JSON.stringify({
      ...manifest,
      manifestFile,
      summary: {
        scheduled: manifest.cases.length,
        accepted,
        acceptedRate: accepted / manifest.cases.length,
        unaccepted: manifest.cases.length - accepted,
        constraintFailures,
        unscored: manifest.cases.filter((entry) => !entry.scores).length,
      },
    }) + '\n',
  );

  return manifest.status === 'complete' ? 0 : 1;
}

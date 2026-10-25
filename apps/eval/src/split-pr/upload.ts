import { existsSync } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import type { Evaluation } from '@langfuse/client';
import {
  collectExperimentIssues,
  getExperimentCaseId,
} from '../../tests/smoke/experiment-completeness.js';
import { readLangfuseConnection, withLangfuse } from '../langfuse.js';
import type { PreparedSplitCase } from './contracts.js';
import { loadSplitSuite, splitCaseRunPath } from './dataset.js';
import { evaluateSplitCaseArtifact } from './evaluate.js';
import * as parse from './parse.js';
import { writeJsonArtifact } from './report.js';

type SavedCase = {
  prepared: PreparedSplitCase;
  report: Awaited<ReturnType<typeof evaluateSplitCaseArtifact>>;
  model: string;
  maxInputTokens: number;
  calls: { count: number; generate: number };
  output: {
    status: 'complete' | 'failed_run' | 'invalid_output';
    groups: string[][];
  };
};

function savedCase(items: Map<string, SavedCase>, input: unknown): SavedCase {
  const caseId = getExperimentCaseId(input);
  const item = caseId === null ? undefined : items.get(caseId);

  if (!item) {
    throw new Error('Experiment case identity mismatch.');
  }

  return item;
}

/* Validate the entire saved batch before opening a Langfuse connection. */
async function loadSavedCases(runDirectory: string, signal: AbortSignal) {
  const packagePath = findPackageJSON(import.meta.url);

  if (!packagePath) {
    throw new parse.SplitDatasetError('Could not locate the eval workspace.');
  }

  const suitePath = resolve(
    dirname(packagePath),
    'datasets/split-pr/suite.json',
  );
  const suite = await loadSplitSuite(suitePath);
  const folders = await readdir(runDirectory, { withFileTypes: true });
  const caseIds = new Set(suite.cases.map(({ definition }) => definition.id));
  const foundIds = new Set(
    folders.filter((entry) => entry.isDirectory()).map((entry) => entry.name),
  );

  if (
    foundIds.size !== caseIds.size ||
    [...caseIds].some((id) => !foundIds.has(id))
  ) {
    throw new parse.SplitDatasetError(
      'run-dir: expected one directory for every registered gold case.',
    );
  }

  if (
    folders.some(
      (entry) =>
        entry.isSymbolicLink() ||
        (entry.isDirectory() && !caseIds.has(entry.name)),
    )
  ) {
    throw new parse.SplitDatasetError(
      'run-dir: unexpected directory or symbolic link.',
    );
  }

  const items = new Map<string, SavedCase>();

  for (const prepared of suite.cases) {
    signal.throwIfAborted();

    const caseId = prepared.definition.id;
    const casePath = resolve(dirname(suitePath), 'cases', `${caseId}.json`);
    const artifactPath = join(runDirectory, caseId, 'run.json');
    const reportPath = join(runDirectory, caseId, 'eval.json');

    for (const path of [artifactPath, reportPath]) {
      const file = await lstat(path).catch(() => undefined);

      if (!file?.isFile()) {
        throw new parse.SplitDatasetError(`${path}: expected a regular file.`);
      }
    }

    const referencePath = splitCaseRunPath(casePath);
    const report = await evaluateSplitCaseArtifact(
      casePath,
      artifactPath,
      referencePath,
    );
    const savedReport = await parse.readJson(reportPath, (value) => value);

    if (JSON.stringify(savedReport.value) !== JSON.stringify(report)) {
      throw new parse.SplitDatasetError(
        `${reportPath}: score report differs from current gold, artifact or scorer.`,
      );
    }

    const artifact = await parse.readJson(artifactPath, (value) =>
      parse.object(value, 'artifact'),
    );
    const model = parse.text(artifact.value.model, 'artifact.model');
    const maxInputTokens = parse.integer(
      artifact.value.maxInputTokens,
      'artifact.maxInputTokens',
    );
    const calls = parse.object(artifact.value.calls, 'artifact.calls');
    const groups =
      report.status === 'complete'
        ? parse
            .array(
              parse.object(artifact.value.proposal, 'artifact.proposal').groups,
              'artifact.proposal.groups',
            )
            .map((group, index) =>
              parse
                .array(
                  parse.object(
                    group,
                    `artifact.proposal.groups[${String(index)}]`,
                  ).unitIds,
                  'group.unitIds',
                )
                .map((unitId) => parse.text(unitId, 'group.unitIds[]')),
            )
        : [];

    items.set(caseId, {
      prepared,
      report,
      model,
      maxInputTokens,
      calls: {
        count: parse.integer(calls.count, 'artifact.calls.count'),
        generate: parse.integer(calls.generate, 'artifact.calls.generate'),
      },
      output: { status: report.status, groups },
    });
  }

  return { suite, items };
}

export async function uploadSplitEvaluation(
  runDir: string,
  signal: AbortSignal,
) {
  const runDirectory = await realpath(runDir).catch(() => {
    throw new parse.SplitDatasetError('run-dir: could not resolve directory.');
  });
  const { suite, items } = await loadSavedCases(runDirectory, signal);
  signal.throwIfAborted();

  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const connection = readLangfuseConnection(process.env);
  const runName = `saved-${basename(runDirectory)}`;
  const attemptPath = join(runDirectory, 'langfuse-upload-attempt.json');
  const receiptPath = join(runDirectory, 'langfuse-upload.json');
  const cases = [...items.values()];

  if (existsSync(attemptPath) || existsSync(receiptPath)) {
    throw new parse.SplitDatasetError(
      'run-dir: this batch already has a Langfuse upload attempt; inspect its receipt or remote experiment before retrying.',
    );
  }

  /* The marker makes uncertain network failures an explicit manual retry decision. */
  await writeJsonArtifact(attemptPath, {
    format: 'daphne-split-langfuse-attempt-v1',
    runName,
    startedAt: new Date().toISOString(),
    cases: cases.map(({ prepared, report }) => ({
      caseId: prepared.definition.id,
      artifactSha256: report.artifactSha256,
    })),
  });
  signal.throwIfAborted();

  const result = await withLangfuse(connection, (client) =>
    client.experiment.run({
      name: 'daphne-split-pr-saved',
      runName,
      maxConcurrency: 2,
      metadata: {
        source: 'saved-split-pr-eval-all',
        suiteId: suite.id,
        datasetHash: suite.datasetHash,
        scorerVersion: cases[0]?.report.scorerVersion,
        timing: 'upload-time-only',
      },
      data: cases.map(({ prepared, report, model, maxInputTokens }) => ({
        input: {
          caseId: prepared.definition.id,
          inputHash: prepared.inputHash,
        },
        expectedOutput: prepared.definition.labels,
        metadata: {
          caseId: prepared.definition.id,
          caseHash: prepared.caseHash,
          artifactSha256: report.artifactSha256,
          model,
          maxInputTokens,
          reviewStatus: prepared.definition.review.status,
          provisional: report.provisional,
        },
      })),
      task: (item) => {
        signal.throwIfAborted();
        return Promise.resolve(savedCase(items, item.input).output);
      },
      evaluators: [
        ({ input }): Promise<Evaluation[]> => {
          const { report, calls } = savedCase(items, input);
          const scores = report.scores;

          return Promise.resolve([
            { name: 'completed', value: Number(scores.completed) },
            { name: 'accepted', value: Number(scores.accepted) },
            {
              name: 'constraints_passed',
              value: Number(scores.constraintsPassed),
            },
            {
              name: 'together_rate',
              value: scores.together.rate ?? 'not_applicable',
            },
            {
              name: 'separate_rate',
              value: scores.separate.rate ?? 'not_applicable',
            },
            { name: 'corrections', value: scores.corrections },
            { name: 'count_calls', value: calls.count },
            { name: 'generate_calls', value: calls.generate },
          ]);
        },
      ],
      runEvaluators: [
        () =>
          Promise.resolve({
            name: 'accepted_rate',
            value:
              cases.filter(({ report }) => report.scores.accepted).length /
              cases.length,
          }),
      ],
    }),
  );

  const issues = collectExperimentIssues(result, {
    caseIds: cases.map(({ prepared }) => prepared.definition.id),
    itemScoreNames: [
      'completed',
      'accepted',
      'constraints_passed',
      'together_rate',
      'separate_rate',
      'corrections',
      'count_calls',
      'generate_calls',
    ],
    runScoreNames: ['accepted_rate'],
  });

  if (issues.length > 0 || !result.experimentUrl) {
    throw new parse.SplitDatasetError(
      `Langfuse experiment incomplete: ${issues.join(' ') || 'missing experiment URL.'}`,
    );
  }

  const receipt = {
    format: 'daphne-split-langfuse-upload-v1',
    runName,
    experimentId: result.experimentId,
    experimentUrl: result.experimentUrl,
    caseCount: cases.length,
    provisionalCount: cases.filter(({ report }) => report.provisional).length,
  };
  await writeJsonArtifact(receiptPath, receipt);

  return receipt;
}

import { existsSync } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import type { ModelProvider } from '@daphne/llm';
import type { Evaluation } from '@langfuse/client';
import type { RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
import {
  collectExperimentIssues,
  getExperimentCaseId,
} from '../experiment-completeness.js';
import { readLangfuseConnection, withLangfuse } from '../langfuse.js';
import type { PreparedSplitCase } from './contracts.js';
import { loadSplitSuite, splitCaseRunPath } from './dataset.js';
import { evaluateSplitCaseArtifact } from './evaluate.js';
import { itemScoreNames, toSplitEvaluations } from './langfuse-scores.js';
import * as parse from '../parse.js';
import { writeJsonArtifact } from '../artifacts.js';
import { parseSplitArtifact } from './artifact.js';

type SavedCase = {
  prepared: PreparedSplitCase;
  report: Awaited<ReturnType<typeof evaluateSplitCaseArtifact>>;
  provider: ModelProvider;
  model: string;
  maxInputTokens: number;
  budget: RunBudgetSnapshot;
  calls: { count: number; generate: number; tools: number };
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
    throw new parse.EvaluationError('Could not locate the eval workspace.');
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
    throw new parse.EvaluationError(
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
    throw new parse.EvaluationError(
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
        throw new parse.EvaluationError(`${path}: expected a regular file.`);
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
      throw new parse.EvaluationError(
        `${reportPath}: score report differs from current gold, artifact or scorer.`,
      );
    }

    const { value: artifact } = await parse.readJson(
      artifactPath,
      parseSplitArtifact,
    );
    const groups =
      artifact.result.status === 'complete'
        ? parse
            .array(
              parse.object(artifact.input.proposal, 'proposal').groups,
              'groups',
            )
            .map((group) =>
              parse
                .array(parse.object(group, 'group').unitIds, 'unitIds')
                .map((id) => parse.text(id, 'unitId')),
            )
        : [];

    items.set(caseId, {
      prepared,
      report,
      provider: artifact.provider,
      model: artifact.model,
      maxInputTokens: artifact.maxInputTokens,
      budget: artifact.budget,
      calls: artifact.calls,
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
    throw new parse.EvaluationError('run-dir: could not resolve directory.');
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
    throw new parse.EvaluationError(
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
      data: cases.map(
        ({ prepared, report, provider, model, maxInputTokens, budget }) => ({
          input: {
            caseId: prepared.definition.id,
            inputHash: prepared.inputHash,
          },
          expectedOutput: prepared.definition.labels,
          metadata: {
            caseId: prepared.definition.id,
            caseHash: prepared.caseHash,
            artifactSha256: report.artifactSha256,
            provider,
            model,
            maxInputTokens,
            budget,
            reviewStatus: prepared.definition.review.status,
            provisional: report.provisional,
          },
        }),
      ),
      task: (item) => {
        signal.throwIfAborted();
        return Promise.resolve(savedCase(items, item.input).output);
      },
      evaluators: [
        ({ input }): Promise<Evaluation[]> => {
          const { report, calls } = savedCase(items, input);
          return Promise.resolve(toSplitEvaluations(report.scores, calls));
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
    itemScoreNames,
    runScoreNames: ['accepted_rate'],
  });

  if (issues.length > 0 || !result.experimentUrl) {
    throw new parse.EvaluationError(
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

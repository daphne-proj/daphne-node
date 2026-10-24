/*
 * Runs a manual integration check against Langfuse, without calling an AI model.
 * Example: 2 + 3 should produce 5 and receive a passing score of 1.
 */

import type { Evaluation, LangfuseClient } from '@langfuse/client';
import {
  collectExperimentIssues,
  getExperimentCaseId,
} from './experiment-completeness.js';

export interface LangfuseSmokeResult {
  status: 'complete' | 'failed';
  experimentUrl: string | null;
  expectedCases: number;
  returnedCases: number;
  scores: {
    exactMatch: { caseId: string | null; value: number | null }[];
    allCasesPass: number | null;
  };
  issues: string[];
}

function numericScore(scores: Evaluation[], name: string): number | null {
  const value = scores.find((score) => score.name === name)?.value;

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function runLangfuseSmoke(
  client: LangfuseClient,
  signal: AbortSignal,
): Promise<LangfuseSmokeResult> {
  signal.throwIfAborted();

  const cases = [
    { input: { caseId: 'sum-2-3', left: 2, right: 3 }, expectedOutput: 5 },
    { input: { caseId: 'sum-4-7', left: 4, right: 7 }, expectedOutput: 11 },
  ];

  const result = await client.experiment.run({
    name: 'daphne-langfuse-smoke',
    data: cases,
    maxConcurrency: 2,
    metadata: { purpose: 'synthetic setup verification' },
    task: (item) => {
      signal.throwIfAborted();
      const input: unknown = item.input;

      if (
        typeof input !== 'object' ||
        input === null ||
        !('left' in input) ||
        typeof input.left !== 'number' ||
        !('right' in input) ||
        typeof input.right !== 'number'
      ) {
        throw new Error('Invalid smoke input.');
      }

      return Promise.resolve(input.left + input.right);
    },
    evaluators: [
      ({ output, expectedOutput }) => {
        const actual: unknown = output;

        return Promise.resolve({
          name: 'exact_match',
          value: actual === expectedOutput ? 1 : 0,
        });
      },
    ],
    runEvaluators: [
      ({ itemResults }) =>
        Promise.resolve({
          name: 'all_cases_pass',
          value:
            itemResults.length === cases.length &&
            itemResults.every((item) =>
              item.evaluations.some(
                (score) => score.name === 'exact_match' && score.value === 1,
              ),
            )
              ? 1
              : 0,
        }),
    ],
  });

  const issues = collectExperimentIssues(result, {
    caseIds: cases.map(({ input }) => input.caseId),
    itemScoreNames: ['exact_match'],
    runScoreNames: ['all_cases_pass'],
  });

  const exactMatch = result.itemResults.map((item) => ({
    caseId: getExperimentCaseId(item.item.input),
    value: numericScore(item.evaluations, 'exact_match'),
  }));

  const allCasesPass = numericScore(result.runEvaluations, 'all_cases_pass');

  if (!result.experimentUrl) {
    issues.push('Langfuse did not return an experiment URL.');
  }

  if (signal.aborted) {
    issues.push('Experiment cancelled.');
  }

  if (exactMatch.some((score) => score.value !== 1) || allCasesPass !== 1) {
    issues.push('Smoke scores did not all pass.');
  }

  return {
    status: issues.length === 0 ? 'complete' : 'failed',
    experimentUrl: result.experimentUrl ?? null,
    expectedCases: cases.length,
    returnedCases: result.itemResults.length,
    scores: { exactMatch, allCasesPass },
    issues,
  };
}

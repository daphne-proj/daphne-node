/*
 * Helps the smoke check detect missing or duplicate results and required scores.
 * Example: expecting cases A and B but receiving A twice reports a problem.
 */
import type { ExperimentResult } from '@langfuse/client';

export interface ExperimentExpectations {
  caseIds: readonly string[];
  itemScoreNames: readonly string[];
  runScoreNames: readonly string[];
}

export function getExperimentCaseId(input: unknown): string | null {
  if (
    typeof input === 'object' &&
    input !== null &&
    'caseId' in input &&
    typeof input.caseId === 'string' &&
    input.caseId.trim()
  ) {
    return input.caseId;
  }

  return null;
}

function collectScoreIssues(
  scores: readonly unknown[],
  required: readonly string[],
  scope: string,
): string[] {
  const issues: string[] = [];
  const counts = new Map<string, number>();

  for (const score of scores) {
    if (
      typeof score !== 'object' ||
      score === null ||
      !('name' in score) ||
      typeof score.name !== 'string' ||
      !score.name.trim() ||
      !('value' in score)
    ) {
      issues.push(`${scope}: malformed score.`);
      continue;
    }

    counts.set(score.name, (counts.get(score.name) ?? 0) + 1);

    if (
      typeof score.value !== 'string' &&
      !(typeof score.value === 'number' && Number.isFinite(score.value))
    ) {
      issues.push(
        `${scope}: score ${score.name} must be a finite number or string.`,
      );
    }
  }

  for (const name of required) {
    if (counts.get(name) !== 1) {
      issues.push(`${scope}: expected exactly one ${name} score.`);
    }
  }

  return issues;
}

/* SDK task/evaluator exceptions omit results, so counts alone cannot prove completeness. */
export function collectExperimentIssues(
  result: Pick<
    ExperimentResult<unknown, unknown, Record<string, unknown>>,
    'itemResults' | 'runEvaluations'
  >,
  expected: ExperimentExpectations,
): string[] {
  const issues: string[] = [];
  const expectedIds = new Set(expected.caseIds);
  const returnedIds = new Set<string>();

  if (
    expectedIds.size !== expected.caseIds.length ||
    expected.caseIds.some((id) => !id.trim())
  ) {
    issues.push('Expected case IDs must be nonblank and unique.');
  }

  for (const [index, itemResult] of result.itemResults.entries()) {
    const input: unknown = itemResult.item.input;
    const caseId = getExperimentCaseId(input);
    const scope = caseId ?? `Result ${String(index + 1)}`;

    if (caseId === null) {
      issues.push(`${scope}: missing or malformed case ID.`);
    } else {
      if (!expectedIds.has(caseId)) {
        issues.push(`Unexpected case: ${caseId}.`);
      }

      if (returnedIds.has(caseId)) {
        issues.push(`Duplicate case: ${caseId}.`);
      }

      returnedIds.add(caseId);
    }

    issues.push(
      ...collectScoreIssues(
        itemResult.evaluations,
        expected.itemScoreNames,
        scope,
      ),
    );
  }

  for (const caseId of expectedIds) {
    if (!returnedIds.has(caseId)) {
      issues.push(`Missing case: ${caseId}.`);
    }
  }

  issues.push(
    ...collectScoreIssues(result.runEvaluations, expected.runScoreNames, 'Run'),
  );
  return issues;
}

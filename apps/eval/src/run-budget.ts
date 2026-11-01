import type { RunBudgetSnapshot } from '@daphne/evaluator-optimizer';
import { EvaluationError, integer, object } from './parse.js';

/* Saved runs must declare their resolved limits explicitly; omitted fields are not unlimited budgets. */
export function parseRunBudget(value: unknown): RunBudgetSnapshot {
  const input = object(value, 'artifact.budget');
  const maxCandidates =
    input.maxCandidates === null
      ? null
      : integer(input.maxCandidates, 'artifact.budget.maxCandidates');
  const deadlineAt =
    input.deadlineAt === null
      ? null
      : integer(input.deadlineAt, 'artifact.budget.deadlineAt');

  if (
    maxCandidates === 0 ||
    Object.keys(input).some(
      (key) => !['maxCandidates', 'deadlineAt'].includes(key),
    )
  ) {
    throw new EvaluationError(
      'artifact.budget: expected a positive candidate ceiling or null, and an epoch-millisecond deadline or null.',
    );
  }

  return { maxCandidates, deadlineAt };
}

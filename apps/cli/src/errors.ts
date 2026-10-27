import { PullRequestError, PullRequestInputError } from '@daphne/pr-review';
import { GitInputError, GitOperationError } from '@daphne/git-source';
import {
  EvidenceInputError,
  EvidenceLimitError,
  SourceUnavailableError,
} from '@daphne/review-evidence';
import {
  ContextConflictError,
  ContextInputError,
  ContextLimitError,
} from '@daphne/context-engine';
import { ModelError } from '@daphne/llm';
import { ArtifactError } from './output.js';

export class CliInputError extends Error {
  override readonly name = 'CliInputError';
}

export class InspectionCancelledError extends Error {
  override readonly name = 'InspectionCancelledError';
}

export type Stage =
  | 'arguments'
  | 'metadata'
  | 'acquisition'
  | 'inspection'
  | 'investigation'
  | 'cleanup'
  | 'assembly'
  | 'context_output'
  | 'run_output'
  | 'split';

export interface Failure {
  readonly stage: Stage;
  readonly code: string;
  readonly message: string;
}

export function describeFailure(stage: Stage, error: unknown): Failure {
  if (error instanceof ModelError) {
    return { stage, code: 'model', message: error.message };
  }

  if (error instanceof SourceUnavailableError) {
    return { stage, code: error.reason, message: error.message };
  }

  if (
    error instanceof PullRequestError ||
    error instanceof GitOperationError ||
    error instanceof ArtifactError
  ) {
    return { stage, code: error.code, message: error.message };
  }

  if (
    error instanceof CliInputError ||
    error instanceof PullRequestInputError ||
    error instanceof GitInputError ||
    error instanceof EvidenceInputError ||
    error instanceof ContextInputError
  ) {
    return { stage, code: 'invalid_input', message: error.message };
  }

  if (
    error instanceof EvidenceLimitError ||
    error instanceof ContextLimitError
  ) {
    return { stage, code: 'limit', message: error.message };
  }

  if (error instanceof ContextConflictError) {
    return { stage, code: 'conflict', message: error.message };
  }

  if (error instanceof InspectionCancelledError) {
    return { stage, code: 'cancelled', message: 'Inspection was cancelled.' };
  }

  return {
    stage,
    code: 'internal',
    message: 'The command could not complete.',
  };
}

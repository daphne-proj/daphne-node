import { ModelError } from '@daphne/review-agent';
import type {
  SemanticSplitInput,
  SemanticSplitResult,
} from '@daphne/semantic-split';
import type { RecordedModelCall } from '../model-calls.js';
import type {
  FrozenSplitEvidence,
  PreparedSplitCase,
  SplitExperimentOutput,
  SplitTrial,
} from './contracts.js';

export function toSemanticSplitInput(
  evidence: FrozenSplitEvidence,
): SemanticSplitInput {
  const changes = new Map(
    evidence.changes.map((change) => [change.id, change]),
  );

  return {
    identity: evidence.identity,
    changes: evidence.changes,
    hunks: evidence.hunks.map(({ changeId, hunkIndex, sources }) => {
      const change = changes.get(changeId);

      if (!change) {
        throw new Error('Frozen hunk references a missing change.');
      }

      return { change, hunkIndex, sources };
    }),
  };
}

export function toSplitTrial(
  caseData: PreparedSplitCase,
  result: SemanticSplitResult,
  timing: { trialNumber: number; elapsedMs: number },
  modelConfig: SplitTrial['modelConfig'],
  modelCalls: RecordedModelCall[],
): SplitTrial {
  return {
    format: 'daphne-split-trial-v1',
    caseId: caseData.definition.id,
    inputHash: caseData.inputHash,
    caseHash: caseData.caseHash,
    ...timing,
    modelConfig,
    modelCalls,
    result:
      result.status === 'complete'
        ? result
        : {
            ...result,
            error: {
              name:
                result.error instanceof ModelError
                  ? 'ModelError'
                  : 'SplitError',
              /* ModelError messages are adapter-owned; arbitrary errors may contain secrets. */
              message:
                result.error instanceof ModelError
                  ? result.error.message
                  : 'Semantic split failed; inspect retained work locally.',
            },
          },
  };
}

/* Never return a full trial from an automatically captured experiment task. */
export function toSplitExperimentOutput(
  trial: SplitTrial,
): SplitExperimentOutput {
  const result = trial.result;

  if (result.status === 'failed') {
    return {
      status: 'failed',
      error: result.error,
    };
  }

  return {
    status: 'complete',
    proposal: result.proposal,
  };
}

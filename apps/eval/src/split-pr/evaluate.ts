import { resolve } from 'node:path';
import type {
  PreparedSplitCase,
  SplitArtifactEvaluation,
  SplitScoreInput,
} from './contracts.js';
import { loadSplitCase, loadSplitSuite } from './dataset.js';
import { rebindSplitEvidence } from './evidence.js';
import { parseSplitArtifact } from './artifact.js';
import { scoreSplitResult, splitScorerVersion } from './score.js';
import { summarizeSplitCase } from './validation.js';
import * as parse from '../parse.js';

function artifactResult(
  value: unknown,
  prepared: PreparedSplitCase,
): SplitScoreInput {
  const { evidence, result } = parseSplitArtifact(value);
  const comparisonEvidence = rebindSplitEvidence(
    evidence,
    prepared.definition.evidence.identity.sessionId,
  );

  if (parse.sha256(JSON.stringify(comparisonEvidence)) !== prepared.inputHash) {
    throw new parse.EvaluationError(
      'Artifact model input does not match the selected frozen case.',
    );
  }

  return result;
}

async function scoreArtifact(
  prepared: PreparedSplitCase,
  artifactPath: string,
  reviewPolicy: 'reviewed' | 'allow-draft',
) {
  const { bytes, value: scores } = await parse.readJson(
    artifactPath,
    (value) => {
      const result = artifactResult(value, prepared);
      const scores = scoreSplitResult(
        prepared.definition,
        result,
        reviewPolicy,
      );
      return scores;
    },
  );

  return { artifactSha256: parse.sha256(bytes), scores };
}

export async function evaluateSplitArtifact(
  suitePath: string,
  caseId: string,
  artifactPath: string,
): Promise<SplitArtifactEvaluation> {
  const suite = await loadSplitSuite(suitePath);
  const prepared = suite.cases.find(
    ({ definition }) => definition.id === caseId,
  );

  if (!prepared) {
    throw new parse.EvaluationError(`suite: unknown case ID ${caseId}.`);
  }

  const scored = await scoreArtifact(prepared, artifactPath, 'reviewed');

  return {
    format: 'daphne-split-score-v1',
    scorerVersion: splitScorerVersion,
    suiteId: suite.id,
    datasetHash: suite.datasetHash,
    caseId,
    caseHash: prepared.caseHash,
    inputHash: prepared.inputHash,
    ...scored,
  };
}

export async function evaluateSplitCaseArtifact(
  casePath: string,
  artifactPath: string,
  referencePath = artifactPath,
) {
  const prepared = await loadSplitCase(casePath, referencePath);
  const scored = await scoreArtifact(prepared, artifactPath, 'allow-draft');
  let status: 'complete' | 'failed_run' | 'invalid_output' = 'complete';

  if (!scored.scores.completed) {
    status = 'failed_run';
  } else if (!scored.scores.accepted) {
    status = 'invalid_output';
  }

  return {
    format: 'daphne-split-case-eval-v1',
    scorerVersion: splitScorerVersion,
    status,
    casePath: resolve(casePath),
    artifactPath: resolve(artifactPath),
    reference: summarizeSplitCase(prepared),
    review: prepared.definition.review,
    provisional: prepared.definition.review.status === 'draft',
    ...scored,
  };
}

import { resolve } from 'node:path';
import { getExpectedUnitIds, validateProposal } from '@daphne/semantic-split';
import type {
  PreparedSplitCase,
  SplitArtifactEvaluation,
  SplitScoreInput,
} from './contracts.js';
import { loadSplitCase, loadSplitSuite } from './dataset.js';
import { parseSplitEvidence } from './evidence.js';
import { scoreSplitResult, splitScorerVersion } from './score.js';
import { summarizeSplitCase } from './validation.js';
import * as parse from './parse.js';

function artifactResult(
  value: unknown,
  prepared: PreparedSplitCase,
): SplitScoreInput {
  const input = parse.object(value, 'artifact');
  parse.choice(input.format, ['daphne-split-pr-v3'], 'artifact.format');
  const status = parse.choice(
    input.status,
    ['complete', 'failed'],
    'artifact.status',
  );
  const evidence = parseSplitEvidence({
    identity: input.identity,
    changes: input.changes,
    hunks: input.hunks,
  });

  /* Fresh captures have new session IDs; compare validated evidence in the case's session. */
  const sessionId = prepared.definition.evidence.identity.sessionId;
  const comparisonEvidence = {
    ...evidence,
    identity: { ...evidence.identity, sessionId },
    hunks: evidence.hunks.map((hunk) => ({
      ...hunk,
      sources: hunk.sources.map((source) => ({
        ...source,
        ref: { ...source.ref, sessionId },
      })),
    })),
  };

  if (parse.sha256(JSON.stringify(comparisonEvidence)) !== prepared.inputHash) {
    throw new parse.SplitDatasetError(
      'artifact: evidence does not match the selected case input hash.',
    );
  }

  if (input.maxCorrections !== 3) {
    throw new parse.SplitDatasetError(
      'artifact.maxCorrections: v3 requires three corrections.',
    );
  }

  const attemptTexts = parse
    .array(input.attempts, 'artifact.attempts')
    .map((value, index) => {
      const field = `artifact.attempts[${String(index)}]`;
      const attempt = parse.object(value, field);

      if (attempt.number !== index + 1) {
        throw new parse.SplitDatasetError(
          `${field}.number: require consecutive attempts starting at one.`,
        );
      }

      return parse.text(attempt.text, `${field}.text`, true);
    });
  const calls = parse.object(input.calls, 'artifact.calls');
  parse.integer(calls.count, 'artifact.calls.count');
  const generate = parse.integer(calls.generate, 'artifact.calls.generate');

  if (attemptTexts.length > 4 || generate < attemptTexts.length) {
    throw new parse.SplitDatasetError(
      'artifact: attempt count exceeds the v3 correction or generation count.',
    );
  }

  if (status === 'failed') {
    if (input.proposal !== null) {
      throw new parse.SplitDatasetError(
        'artifact: a failed run must not contain an accepted proposal.',
      );
    }

    return { status, attemptTexts };
  }

  if (
    prepared.definition.evidence.changes.length > 0 &&
    attemptTexts.length === 0
  ) {
    throw new parse.SplitDatasetError(
      'artifact: a complete nonempty run requires a completed grouping attempt.',
    );
  }

  const proposalText = parse.text(
    JSON.stringify(input.proposal),
    'artifact.proposal',
  );

  return { status, attemptTexts, proposalText };
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
      const lastText = result.attemptTexts.at(-1);

      /* A valid top-level copy cannot conceal a different or invalid final reply. */
      if (lastText !== undefined && scores.validation?.status === 'valid') {
        const lastValidation = validateProposal(
          lastText,
          getExpectedUnitIds(prepared.definition.evidence.changes),
        );

        if (
          lastValidation.status !== 'valid' ||
          JSON.stringify(lastValidation.proposal) !==
            JSON.stringify(scores.validation.proposal)
        ) {
          throw new parse.SplitDatasetError(
            'artifact: accepted proposal disagrees with the final grouping attempt.',
          );
        }
      }

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
    throw new parse.SplitDatasetError(`suite: unknown case ID ${caseId}.`);
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
) {
  const prepared = await loadSplitCase(casePath, artifactPath);
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

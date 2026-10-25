import type {
  SourceEvidence,
  Change,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';
import type {
  Proposal,
  ProposalValidation,
  SemanticSplitResult,
} from '@daphne/semantic-split';
import type { RecordedModelCall } from '../model-calls.js';

export interface FrozenSplitEvidence {
  identity: ReviewIdentity;
  changes: Change[];
  hunks: {
    changeId: string;
    hunkIndex: number | null;
    sources: SourceEvidence[];
  }[];
}

export interface PairLabel {
  leftUnitId: string;
  rightUnitId: string;
  relation: 'together' | 'separate' | 'unknown';
}

export interface SplitCase {
  format: 'daphne-split-input-v1';
  id: string;
  partition: 'development' | 'holdout';
  tags: string[];
  provenance:
    | null
    | {
        kind: 'artifact';
        capturedAt: string;
        artifactSha256: string;
        sourcePrUrl: string | null;
      }
    | { kind: 'synthetic'; capturedAt: string; constructionSource: string };
  evidence: FrozenSplitEvidence;
  labels: PairLabel[];
  notes: string[];
  review:
    | { status: 'draft' }
    | { status: 'reviewed'; reviewer: string; reviewedAt: string };
}

export interface PreparedSplitCase {
  definition: SplitCase;
  caseHash: string;
  inputHash: string;
}

export type SplitScoreInput = {
  attemptTexts: string[];
} & ({ status: 'complete'; proposalText: string } | { status: 'failed' });

export interface PairScore {
  label: PairLabel;
  actualRelation: 'together' | 'separate' | null;
  score: 0 | 1 | null;
}

export interface PairRate {
  satisfied: number | null;
  total: number;
  rate: number | null;
}

export interface SplitScores {
  completed: boolean;
  accepted: boolean;
  constraintsPassed: boolean;
  firstReply: 'valid' | 'invalid' | 'no_reply' | 'not_required';
  recovered: boolean;
  attempts: number;
  corrections: number;
  together: PairRate;
  separate: PairRate;
  pairs: PairScore[];
  violatedPairs: PairLabel[];
  validation: ProposalValidation | null;
}

export interface SplitArtifactEvaluation {
  format: 'daphne-split-score-v1';
  scorerVersion: string;
  suiteId: string;
  datasetHash: string;
  caseId: string;
  caseHash: string;
  inputHash: string;
  artifactSha256: string;
  scores: SplitScores;
}

export interface SplitTrial {
  format: 'daphne-split-trial-v1';
  caseId: string;
  inputHash: string;
  caseHash: string;
  trialNumber: number;
  modelConfig: { model: string; maxInputTokens: number };
  elapsedMs: number;
  modelCalls: RecordedModelCall[];
  result:
    | Extract<SemanticSplitResult, { status: 'complete' }>
    | (Omit<Extract<SemanticSplitResult, { status: 'failed' }>, 'error'> & {
        error: { name: string; message: string };
      });
}

export type SplitExperimentOutput =
  | { status: 'complete'; proposal: Proposal }
  | { status: 'failed'; error: { name: string; message: string } };

export interface SplitRunOptions {
  suitePath: string;
  partition: SplitCase['partition'];
  outputDirectory: string;
  model: string;
  maxInputTokens: number;
  trials: number;
  concurrency: number;
}

export interface SplitRunManifest {
  format: 'daphne-split-eval-run-v1';
  suiteId: string;
  datasetHash: string;
  partition: SplitCase['partition'];
  modelConfig: SplitTrial['modelConfig'];
  scorerVersion: string;
  promptHash: string;
  sdkVersion: string;
  git: { commit: string; dirty: boolean };
  startedAt: string;
  trials: number;
  concurrency: number;
  status: 'complete' | 'incomplete';
  cases: {
    caseId: string;
    inputHash: string;
    caseHash: string;
    trialNumber: number;
    trialFile: string | null;
    scores: SplitScores | null;
    issues: string[];
  }[];
  experiments: {
    trialNumber: number;
    id: string | null;
    url: string | null;
    issues: string[];
  }[];
  issues: string[];
}

import type {
  SourceEvidence,
  Change,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';
import type { ProposalValidation } from '@daphne/semantic-split';

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
  reason: string;
}

export interface SplitCase {
  format: 'daphne-split-case-v1';
  id: string;
  partition: 'development' | 'holdout';
  tags: string[];
  provenance:
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

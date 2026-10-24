import type {
  SourceEvidence,
  Change,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';

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

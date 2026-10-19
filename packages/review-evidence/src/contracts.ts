/** Evidence metadata is data only; it carries no live repository handle. */
export interface ReviewIdentity {
  readonly sessionId: string;
  readonly repositoryUrl: string;
  readonly targetCommit: string;
  readonly baseCommit: string;
  readonly headCommit: string;
}

export type Side = 'base' | 'head';

/** Zero-based, half-open offsets into the original UTF-8 bytes. */
export interface ByteRange {
  readonly startByte: number;
  readonly endByte: number;
}

export interface SourceRef {
  readonly sessionId: string;
  readonly side: Side;
  readonly commit: string;
  readonly path: string;
  readonly blobId: string;
  readonly range: ByteRange;
}

export interface SourceEvidence {
  readonly ref: SourceRef;
  readonly text: string;
}

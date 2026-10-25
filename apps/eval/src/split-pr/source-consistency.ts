import type { SourceEvidence } from '@daphne/review-evidence/contracts';
import { EvaluationError } from '../parse.js';

export function validateSourceConsistency(sources: SourceEvidence[]): void {
  const paths = new Map<string, SourceEvidence[]>();

  for (const source of sources) {
    const { ref, text } = source;
    const key = JSON.stringify([ref.commit, ref.path]);
    const previous = paths.get(key) ?? [];
    const bytes = Buffer.from(text);

    for (const earlier of previous) {
      if (earlier.ref.blobId !== ref.blobId) {
        throw new EvaluationError(
          `sources: conflicting blob identities for committed path ${ref.path}.`,
        );
      }

      const start = Math.max(earlier.ref.range.startByte, ref.range.startByte);
      const end = Math.min(earlier.ref.range.endByte, ref.range.endByte);

      if (start >= end) {
        continue;
      }

      const priorBytes = Buffer.from(earlier.text).subarray(
        start - earlier.ref.range.startByte,
        end - earlier.ref.range.startByte,
      );
      const overlap = bytes.subarray(
        start - ref.range.startByte,
        end - ref.range.startByte,
      );

      if (!priorBytes.equals(overlap)) {
        throw new EvaluationError(
          `sources: conflicting overlapping bytes for committed path ${ref.path}.`,
        );
      }
    }

    previous.push(source);
    paths.set(key, previous);
  }
}

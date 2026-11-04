import type { Change, ContextNotice } from '@daphne/review-evidence/contracts';
import type { EvidenceSnapshot } from './contracts.js';

/* Report unavailable original content without pretending metadata contains source text. */
export function initialLimitations(
  changes: readonly Change[],
): ContextNotice[] {
  return changes
    .filter((change) => change.kind !== 'text')
    .map((change) => ({
      code: 'unsupported_change',
      message: `Change ${change.id} has ${change.kind} content; only its metadata is available.`,
      path: change.afterPath ?? change.beforePath,
    }));
}

/* Preserve retrieval notices and outstanding continuations independently of proposal semantics. */
export function retrievalLimitations(
  evidence: EvidenceSnapshot,
): ContextNotice[] {
  return evidence.queries.flatMap((query) => [
    ...query.pages.flatMap((page) => page.notices),
    ...(query.status === 'open'
      ? [
          {
            code: 'retrieval_open',
            message: `Query ${query.queryId} has unread continuation pages.`,
            path: null,
          },
        ]
      : []),
  ]);
}

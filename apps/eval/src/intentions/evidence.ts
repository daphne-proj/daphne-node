import { isDeepStrictEqual } from 'node:util';
import { validateAndCopySnapshot } from '@daphne/context-engine';
import type {
  SourceEvidence,
  ContextNotice,
} from '@daphne/review-evidence/contracts';
import { parseSplitEvidence } from '../split-pr/evidence.js';
import * as parse from '../parse.js';

/* Snapshot validation owns source shape and identity; eval additionally requires Git paths and SHA-1 blob IDs. */
function validateGitSource(source: SourceEvidence, field: string): void {
  const { path, blobId } = source.ref;

  if (
    !path.trim() ||
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/^[0-9a-f]{40}$/.test(blobId)
  ) {
    throw new parse.EvaluationError(`${field}: invalid Git path or blob ID.`);
  }
}

export function parseNotices(value: unknown, field: string): ContextNotice[] {
  return parse.array(value, field).map((value, index) => {
    const label = `${field}[${String(index)}]`;
    const notice = parse.object(value, label);

    return {
      code: parse.text(notice.code, `${label}.code`),
      message: parse.text(notice.message, `${label}.message`),
      path:
        notice.path === null ? null : parse.text(notice.path, `${label}.path`),
    };
  });
}

function lineCount(text: string): number {
  if (text.length === 0) {
    return 0;
  }

  let count = text.endsWith('\n') ? 0 : 1;

  for (const character of text) {
    if (character === '\n') {
      count += 1;
    }
  }

  return count;
}

/*
 * Rebuilds a saved investigation's sources before the judge sees them. The
 * shared frozen-evidence parser checks the original inventory and hunk sides;
 * context-engine checks retained source identities, byte lengths and conflicts.
 * Every original diff source must be retained. The trace reader reconstructs
 * conversation delivery before selecting the sources eligible for judgment.
 * Validate complete query chains here so tool-packet reconstruction can also
 * reject altered navigation without retrieving the repository again.
 */
export function parseIntentionEvidence(
  artifact: Record<string, unknown>,
  investigation: Record<string, unknown>,
) {
  const original = parseSplitEvidence(artifact);
  const snapshot = parse.object(
    investigation.evidence,
    'investigation.evidence',
  );
  const retained = validateAndCopySnapshot(snapshot, 32 * 1024 * 1024);

  if (!isDeepStrictEqual(snapshot.identity, original.identity)) {
    throw new parse.EvaluationError(
      'The retained evidence identity differs from the original comparison.',
    );
  }

  const sources = retained.sources;

  for (const [index, retained] of sources.entries()) {
    validateGitSource(retained.source, `evidence.sources[${String(index)}]`);
  }

  const inventory = new Map(
    original.changes.map((change) => [change.id, change]),
  );
  const hunks = original.hunks.map((entry) => {
    const change = inventory.get(entry.changeId);
    const hunk =
      entry.hunkIndex === null ? undefined : change?.hunks[entry.hunkIndex];

    for (const item of entry.sources) {
      if (!hunk) {
        throw new parse.EvaluationError('A source has no matching text hunk.');
      }

      const count =
        item.ref.side === 'base' ? hunk.beforeLineCount : hunk.afterLineCount;
      const start =
        item.ref.side === 'base' ? hunk.beforeStartLine : hunk.afterStartLine;

      if (
        (count > 0 && start === 0) ||
        !Number.isSafeInteger(start + count) ||
        lineCount(item.text) !== count
      ) {
        throw new parse.EvaluationError(
          'Original hunk source lines do not match the inventory.',
        );
      }
    }

    const evidenceIds = entry.sources.map((item) => {
      const retained = sources.find(({ source }) =>
        isDeepStrictEqual(source, item),
      );

      if (!retained) {
        throw new parse.EvaluationError(
          'Original diff evidence is missing from the retained sources.',
        );
      }

      return retained.evidenceId;
    });

    return {
      changeId: entry.changeId,
      hunkIndex: entry.hunkIndex,
      evidenceIds,
    };
  });

  if (!isDeepStrictEqual(investigation.hunks, hunks)) {
    throw new parse.EvaluationError(
      'Investigation hunk mappings differ from the original diff.',
    );
  }

  return {
    identity: original.identity,
    changes: original.changes,
    hunks,
    sources,
    queries: retained.queries,
    initialEvidenceIds: [...new Set(hunks.flatMap((hunk) => hunk.evidenceIds))],
  };
}

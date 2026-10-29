import { isDeepStrictEqual } from 'node:util';
import { createContextEngine } from '@daphne/context-engine';
import type {
  SourceEvidence,
  ContextNotice,
} from '@daphne/review-evidence/contracts';
import { parseSplitEvidence } from '../split-pr/evidence.js';
import * as parse from '../parse.js';

function source(value: unknown, field: string): SourceEvidence {
  const input = parse.object(value, field);
  const reference = parse.object(input.ref, `${field}.ref`);
  const range = parse.object(reference.range, `${field}.ref.range`);
  const path = parse.text(reference.path, `${field}.ref.path`);
  const blobId = parse.text(reference.blobId, `${field}.ref.blobId`);

  if (
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..') ||
    !/^[0-9a-f]{40}$/.test(blobId)
  ) {
    throw new parse.EvaluationError(`${field}: invalid Git path or blob ID.`);
  }

  return {
    ref: {
      sessionId: parse.text(reference.sessionId, `${field}.ref.sessionId`),
      side: parse.choice(reference.side, ['base', 'head'], `${field}.ref.side`),
      commit: parse.text(reference.commit, `${field}.ref.commit`),
      path,
      blobId,
      range: {
        startByte: parse.integer(
          range.startByte,
          `${field}.ref.range.startByte`,
        ),
        endByte: parse.integer(range.endByte, `${field}.ref.range.endByte`),
      },
    },
    text: parse.text(input.text, `${field}.text`, true),
  };
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
 * Every original diff source must also be present in the delivered evidence.
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

  if (!isDeepStrictEqual(snapshot.identity, original.identity)) {
    throw new parse.EvaluationError(
      'The retained evidence identity differs from the original comparison.',
    );
  }

  const engine = createContextEngine(original.identity, {
    maxContextBytes: 8 * 1024 * 1024,
    maxRetainedBytes: 32 * 1024 * 1024,
  });
  const retainedIds = new Set<string>();

  for (const [index, value] of parse
    .array(snapshot.sources, 'evidence.sources')
    .entries()) {
    const field = `evidence.sources[${String(index)}]`;
    const retained = parse.object(value, field);
    const evidenceId = parse.text(retained.evidenceId, `${field}.evidenceId`);

    if (
      retainedIds.has(evidenceId) ||
      engine.addSource(source(retained.source, `${field}.source`)) !==
        evidenceId
    ) {
      throw new parse.EvaluationError(
        `${field}: inconsistent or duplicate evidence ID.`,
      );
    }

    retainedIds.add(evidenceId);
  }

  const sources = engine.getEvidenceSnapshot().sources;
  const knownIds = new Set(sources.map(({ evidenceId }) => evidenceId));
  const deliveredEvidenceIds = parse
    .array(
      investigation.deliveredEvidenceIds,
      'investigation.deliveredEvidenceIds',
    )
    .map((value) => parse.text(value, 'delivered evidence ID'));
  const delivered = new Set(deliveredEvidenceIds);

  if (
    delivered.size !== deliveredEvidenceIds.length ||
    deliveredEvidenceIds.some((id) => !knownIds.has(id))
  ) {
    throw new parse.EvaluationError(
      'Delivered evidence IDs must be distinct and retained.',
    );
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

      if (!retained || !delivered.has(retained.evidenceId)) {
        throw new parse.EvaluationError(
          'Original diff evidence is missing from the delivered sources.',
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
    sources: sources.filter(({ evidenceId }) => delivered.has(evidenceId)),
    deliveredEvidenceIds,
  };
}

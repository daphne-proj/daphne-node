import { ContextInputError, ContextLimitError } from '@daphne/context-engine';
import type { ContextEngine, EvidenceSnapshot } from '@daphne/context-engine';
import type {
  Change,
  ContextNotice,
  Side,
} from '@daphne/review-evidence/contracts';
import type { IntentionHunkEvidence, IntentionsInput } from './contracts.js';
import { intentionsLimits } from './limits.js';

function checkText(value: string, allowEmpty = false): void {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new ContextInputError(
      'Intentions input requires well-formed UTF-8 text.',
    );
  }
}

function checkCoordinates(start: number, count: number): void {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(count) ||
    start < 0 ||
    count < 0 ||
    (count > 0 && start === 0) ||
    !Number.isSafeInteger(start + count)
  ) {
    throw new ContextInputError('Invalid hunk line coordinates.');
  }
}

function changeDescription(change: Change): string {
  return JSON.stringify([
    change.id,
    change.beforePath,
    change.afterPath,
    change.beforeMode,
    change.afterMode,
    change.status,
    change.kind,
    change.hunks.map((hunk) => [
      hunk.beforeStartLine,
      hunk.beforeLineCount,
      hunk.afterStartLine,
      hunk.afterLineCount,
    ]),
  ]);
}

/* Capture caller-owned data before the first await so the investigation keeps one comparison. */
export function captureInput(input: IntentionsInput): IntentionsInput {
  const captured = structuredClone(input);
  checkText(captured.pr.url);
  checkText(captured.pr.title, true);

  if (captured.pr.body !== null) {
    checkText(captured.pr.body, true);
  }

  const ids = new Set<string>();

  for (const change of captured.changes) {
    checkText(change.id);

    if (
      ids.has(change.id) ||
      (change.beforePath === null && change.afterPath === null)
    ) {
      throw new ContextInputError(
        'Changes need unique IDs and at least one existing path.',
      );
    }

    ids.add(change.id);

    if (
      !['added', 'deleted', 'modified', 'renamed', 'type-changed'].includes(
        change.status,
      ) ||
      !['text', 'binary', 'symlink', 'submodule', 'unsupported'].includes(
        change.kind,
      )
    ) {
      throw new ContextInputError('Unknown change status or content kind.');
    }

    for (const path of [change.beforePath, change.afterPath]) {
      if (path !== null) {
        checkText(path);
      }
    }

    if (
      (change.status === 'added' && change.beforePath !== null) ||
      (change.status === 'deleted' && change.afterPath !== null) ||
      (change.status !== 'added' &&
        change.status !== 'deleted' &&
        (change.beforePath === null || change.afterPath === null))
    ) {
      throw new ContextInputError('Change paths contradict the change status.');
    }

    for (const hunk of change.hunks) {
      checkCoordinates(hunk.beforeStartLine, hunk.beforeLineCount);
      checkCoordinates(hunk.afterStartLine, hunk.afterLineCount);
    }
  }

  return captured;
}

function hunkKey(changeId: string, hunkIndex: number | null): string {
  return JSON.stringify([changeId, hunkIndex]);
}

function sourceLineCount(text: string): number {
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

export function retainDiff(
  input: IntentionsInput,
  engine: ContextEngine,
  mappings: IntentionHunkEvidence[],
): void {
  const inventory = new Map(input.changes.map((change) => [change.id, change]));
  const expected = new Set<string>();

  for (const change of input.changes) {
    if (change.kind === 'text' && change.hunks.length > 0) {
      change.hunks.forEach((_, index) =>
        expected.add(hunkKey(change.id, index)),
      );
    } else {
      expected.add(hunkKey(change.id, null));
    }
  }

  for (const entry of input.hunks) {
    const change = inventory.get(entry.change.id);
    const key = hunkKey(entry.change.id, entry.hunkIndex);

    if (
      !change ||
      !expected.delete(key) ||
      changeDescription(change) !== changeDescription(entry.change)
    ) {
      throw new ContextInputError(
        'Diff evidence contains an unknown, duplicate or mismatched change/hunk pair.',
      );
    }

    if (entry.hunkIndex === null) {
      if (entry.sources.length !== 0) {
        throw new ContextInputError(
          'Metadata-only changes cannot supply hunk sources.',
        );
      }
    } else {
      const hunk = change.hunks[entry.hunkIndex];
      const sides: Side[] = ['base', 'head'];
      const paths = { base: change.beforePath, head: change.afterPath };
      const existingSides = sides.filter((side) => paths[side] !== null);

      if (!hunk || entry.sources.length !== existingSides.length) {
        throw new ContextInputError(
          'Each text hunk needs every existing file side.',
        );
      }

      for (const [index, source] of entry.sources.entries()) {
        const count =
          source.ref.side === 'base'
            ? hunk.beforeLineCount
            : hunk.afterLineCount;

        if (
          source.ref.side !== existingSides[index] ||
          source.ref.path !== paths[source.ref.side] ||
          sourceLineCount(source.text) !== count
        ) {
          throw new ContextInputError(
            'Hunk sources must match the inventory paths, line counts and BASE-then-HEAD order.',
          );
        }
      }
    }

    const evidenceIds = entry.sources.map((source) => engine.addSource(source));
    mappings.push({
      changeId: change.id,
      hunkIndex: entry.hunkIndex,
      evidenceIds,
    });
  }

  if (expected.size > 0) {
    throw new ContextInputError(
      `Missing ${String(expected.size)} required diff entries.`,
    );
  }
}

export async function assembleEvidence(
  engine: ContextEngine,
  evidenceIds: readonly string[],
) {
  const packet = await engine.buildContextPacket({
    evidenceIds,
    maxBytes: intentionsLimits.maxContextBytes,
  });

  /* Full diff delivery is mandatory; tool replies also must not silently lose selected source. */
  if (
    packet.omittedEvidenceIds.length > 0 ||
    packet.notices.some((notice) => notice.code === 'observations_omitted')
  ) {
    throw new ContextLimitError(
      'packet',
      'Required intentions evidence or navigation cannot fit the context packet.',
    );
  }

  return packet;
}

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

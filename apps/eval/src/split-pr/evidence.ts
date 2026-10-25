import type {
  Change,
  ReviewIdentity,
  SourceEvidence,
} from '@daphne/review-evidence/contracts';
import { getExpectedUnitIds } from '@daphne/semantic-split';
import type { FrozenSplitEvidence } from './contracts.js';
import { validateSourceConsistency } from './source-consistency.js';
import * as parse from '../parse.js';

function gitId(value: unknown, field: string): string {
  const id = parse.text(value, field);

  if (!/^[0-9a-f]{40}$/.test(id)) {
    throw new parse.EvaluationError(
      `${field}: expected a full lowercase Git object ID.`,
    );
  }

  return id;
}

function gitPath(value: unknown, field: string): string {
  const path = parse.text(value, field);

  if (
    path.startsWith('/') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new parse.EvaluationError(
      `${field}: expected a repository-relative Git path.`,
    );
  }

  return path;
}

function identity(value: unknown): ReviewIdentity {
  const input = parse.object(value, 'identity');

  return {
    sessionId: parse.text(input.sessionId, 'identity.sessionId'),
    repositoryUrl: parse.text(input.repositoryUrl, 'identity.repositoryUrl'),
    targetCommit: gitId(input.targetCommit, 'identity.targetCommit'),
    baseCommit: gitId(input.baseCommit, 'identity.baseCommit'),
    headCommit: gitId(input.headCommit, 'identity.headCommit'),
  };
}

function change(value: unknown, index: number): Change {
  const field = `changes[${String(index)}]`;
  const input = parse.object(value, field);
  const beforePath =
    input.beforePath === null
      ? null
      : gitPath(input.beforePath, `${field}.beforePath`);
  const afterPath =
    input.afterPath === null
      ? null
      : gitPath(input.afterPath, `${field}.afterPath`);
  const beforeMode =
    input.beforeMode === null
      ? null
      : parse.text(input.beforeMode, `${field}.beforeMode`);
  const afterMode =
    input.afterMode === null
      ? null
      : parse.text(input.afterMode, `${field}.afterMode`);
  const status = parse.choice(
    input.status,
    ['added', 'deleted', 'modified', 'renamed', 'type-changed'],
    `${field}.status`,
  );
  const kind = parse.choice(
    input.kind,
    ['text', 'binary', 'symlink', 'submodule', 'unsupported'],
    `${field}.kind`,
  );

  if (
    (beforePath === null && afterPath === null) ||
    (beforePath === null) !== (beforeMode === null) ||
    (afterPath === null) !== (afterMode === null) ||
    (status === 'added' && (beforePath !== null || afterPath === null)) ||
    (status === 'deleted' && (afterPath !== null || beforePath === null)) ||
    (status !== 'added' &&
      status !== 'deleted' &&
      (beforePath === null || afterPath === null))
  ) {
    throw new parse.EvaluationError(
      `${field}: paths/modes contradict the change status.`,
    );
  }

  const hunks = parse
    .array(input.hunks, `${field}.hunks`)
    .map((value, hunkIndex) => {
      const label = `${field}.hunks[${String(hunkIndex)}]`;
      const hunk = parse.object(value, label);

      return {
        beforeStartLine: parse.integer(
          hunk.beforeStartLine,
          `${label}.beforeStartLine`,
        ),
        beforeLineCount: parse.integer(
          hunk.beforeLineCount,
          `${label}.beforeLineCount`,
        ),
        afterStartLine: parse.integer(
          hunk.afterStartLine,
          `${label}.afterStartLine`,
        ),
        afterLineCount: parse.integer(
          hunk.afterLineCount,
          `${label}.afterLineCount`,
        ),
      };
    });

  if (kind !== 'text' && hunks.length > 0) {
    throw new parse.EvaluationError(
      `${field}: nontext changes cannot contain text hunks.`,
    );
  }

  return {
    id: parse.text(input.id, `${field}.id`),
    beforePath,
    afterPath,
    beforeMode,
    afterMode,
    status,
    kind,
    hunks,
  };
}

function source(
  value: unknown,
  session: ReviewIdentity,
  field: string,
): SourceEvidence {
  const input = parse.object(value, field);
  const reference = parse.object(input.ref, `${field}.ref`);
  const range = parse.object(reference.range, `${field}.ref.range`);
  const side = parse.choice(
    reference.side,
    ['base', 'head'],
    `${field}.ref.side`,
  );
  const ref = {
    sessionId: parse.text(reference.sessionId, `${field}.ref.sessionId`),
    side,
    commit: gitId(reference.commit, `${field}.ref.commit`),
    path: gitPath(reference.path, `${field}.ref.path`),
    blobId: gitId(reference.blobId, `${field}.ref.blobId`),
    range: {
      startByte: parse.integer(range.startByte, `${field}.ref.range.startByte`),
      endByte: parse.integer(range.endByte, `${field}.ref.range.endByte`),
    },
  };
  const text = parse.text(input.text, `${field}.text`, true);
  const commit = side === 'base' ? session.baseCommit : session.headCommit;

  if (ref.sessionId !== session.sessionId || ref.commit !== commit) {
    throw new parse.EvaluationError(
      `${field}: source session/commit does not match its identity and side.`,
    );
  }

  if (Buffer.byteLength(text) !== ref.range.endByte - ref.range.startByte) {
    throw new parse.EvaluationError(
      `${field}: source UTF-8 length does not match its byte range.`,
    );
  }

  return { ref, text };
}

export function parseSplitEvidence(value: unknown): FrozenSplitEvidence {
  const input = parse.object(value, 'evidence');
  const session = identity(input.identity);
  const changes = parse.array(input.changes, 'changes').map(change);
  const inventory = new Map(changes.map((entry) => [entry.id, entry]));

  if (inventory.size !== changes.length) {
    throw new parse.EvaluationError('changes: duplicate change IDs.');
  }

  const expected = getExpectedUnitIds(changes);
  const seen = new Set<string>();
  const hunks = parse.array(input.hunks, 'hunks').map((value, index) => {
    const field = `hunks[${String(index)}]`;
    const hunk = parse.object(value, field);
    const changeId = parse.text(hunk.changeId, `${field}.changeId`);
    const entry = inventory.get(changeId);
    const hunkIndex =
      hunk.hunkIndex === null
        ? null
        : parse.integer(hunk.hunkIndex, `${field}.hunkIndex`);
    const unitId = `${changeId}:${hunkIndex === null ? 'metadata' : String(hunkIndex)}`;

    if (!entry || !expected.has(unitId) || seen.has(unitId)) {
      throw new parse.EvaluationError(
        `${field}: unknown or duplicate original unit ${unitId}.`,
      );
    }

    seen.add(unitId);
    const sources = parse
      .array(hunk.sources, `${field}.sources`)
      .map((value, sourceIndex) =>
        source(value, session, `${field}.sources[${String(sourceIndex)}]`),
      );
    const paths: { side: 'base' | 'head'; path: string | null }[] = [
      { side: 'base', path: entry.beforePath },
      { side: 'head', path: entry.afterPath },
    ];
    const sides =
      hunkIndex === null ? [] : paths.filter(({ path }) => path !== null);

    if (
      sources.length !== sides.length ||
      sources.some(({ ref }, sourceIndex) => {
        const expectedSide = sides[sourceIndex];

        return (
          !expectedSide ||
          ref.side !== expectedSide.side ||
          ref.path !== expectedSide.path
        );
      })
    ) {
      throw new parse.EvaluationError(
        `${field}: supply existing sides once in BASE-then-HEAD order at their change paths; metadata has no sources.`,
      );
    }

    return { changeId, hunkIndex, sources };
  });

  if (seen.size !== expected.size) {
    throw new parse.EvaluationError('hunks: missing original inventory units.');
  }

  validateSourceConsistency(hunks.flatMap(({ sources }) => sources));

  return { identity: session, changes, hunks };
}

import { getExpectedUnitIds } from '@daphne/semantic-split';
import type { PairLabel, SplitCase } from './contracts.js';
import { parseSplitEvidence } from './evidence.js';
import * as parse from './parse.js';

function labels(value: unknown, expected: ReadonlySet<string>): PairLabel[] {
  const input = parse.object(value, 'labels');
  const relations: PairLabel['relation'][] = ['together', 'separate'];

  if (
    Object.keys(input).some(
      (key) => !relations.some((relation) => relation === key),
    )
  ) {
    throw new parse.SplitDatasetError(
      'labels: only together and separate are allowed.',
    );
  }

  const pairs = new Set<string>();
  const result = relations.flatMap((relation) =>
    parse.array(input[relation], relation).map((value, index): PairLabel => {
      const field = `${relation}[${String(index)}]`;
      const endpoints = parse.array(value, field);

      if (endpoints.length !== 2) {
        throw new parse.SplitDatasetError(
          `${field}: expected exactly two unit IDs.`,
        );
      }

      const leftUnitId = parse.text(endpoints[0], `${field}[0]`);
      const rightUnitId = parse.text(endpoints[1], `${field}[1]`);
      const pair = JSON.stringify([leftUnitId, rightUnitId].sort());

      if (
        leftUnitId === rightUnitId ||
        !expected.has(leftUnitId) ||
        !expected.has(rightUnitId) ||
        pairs.has(pair)
      ) {
        throw new parse.SplitDatasetError(
          `${field}: unknown, identical or duplicate pair endpoints.`,
        );
      }

      pairs.add(pair);
      return {
        leftUnitId,
        rightUnitId,
        relation,
      };
    }),
  );

  /* Together labels imply transitive membership; separate labels cannot cross it. */
  const parents = new Map([...expected].map((id) => [id, id]));
  function root(id: string): string {
    let current = id;
    let parent = parents.get(current);

    while (parent !== undefined && parent !== current) {
      current = parent;
      parent = parents.get(current);
    }

    return current;
  }

  for (const label of result) {
    if (label.relation === 'together') {
      parents.set(root(label.leftUnitId), root(label.rightUnitId));
    }
  }

  for (const label of result) {
    if (
      label.relation === 'separate' &&
      root(label.leftUnitId) === root(label.rightUnitId)
    ) {
      throw new parse.SplitDatasetError(
        `labels: separate pair ${label.leftUnitId}/${label.rightUnitId} contradicts together labels.`,
      );
    }
  }

  return result;
}

export function sourcePrUrl(value: unknown): string | null {
  if (value === null) {
    return null;
  }

  const text = parse.text(value, 'provenance.sourcePrUrl');
  const url = URL.parse(text);

  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new parse.SplitDatasetError(
      'provenance.sourcePrUrl: expected an HTTP(S) URL without credentials.',
    );
  }

  return text;
}

function provenance(value: unknown): SplitCase['provenance'] {
  const input = parse.object(value, 'provenance');
  const kind = parse.choice(
    input.kind,
    ['artifact', 'synthetic'],
    'provenance.kind',
  );
  const capturedAt = parse.timestamp(input.capturedAt, 'provenance.capturedAt');

  if (kind === 'synthetic') {
    return {
      kind,
      capturedAt,
      constructionSource: parse.text(
        input.constructionSource,
        'provenance.constructionSource',
      ),
    };
  }

  const artifactSha256 = parse.text(
    input.artifactSha256,
    'provenance.artifactSha256',
  );

  if (!/^[0-9a-f]{64}$/.test(artifactSha256)) {
    throw new parse.SplitDatasetError(
      'provenance.artifactSha256: expected a lowercase SHA-256 digest.',
    );
  }

  return {
    kind,
    capturedAt,
    artifactSha256,
    sourcePrUrl: sourcePrUrl(input.sourcePrUrl),
  };
}

function review(value: unknown): SplitCase['review'] {
  const input = parse.object(value, 'review');
  const status = parse.choice(
    input.status,
    ['draft', 'reviewed'],
    'review.status',
  );

  if (status === 'draft') {
    return { status };
  }

  return {
    status,
    reviewer: parse.text(input.reviewer, 'review.reviewer'),
    reviewedAt: parse.timestamp(input.reviewedAt, 'review.reviewedAt'),
  };
}

export function parseSplitCase(
  value: unknown,
  expectations: unknown,
  caseId: string,
): SplitCase {
  const artifact = parse.object(value, 'artifact');
  parse.choice(artifact.format, ['daphne-split-pr-v3'], 'artifact.format');
  const status = parse.choice(
    artifact.status,
    ['complete', 'failed'],
    'artifact.status',
  );
  const calls = parse.object(artifact.calls, 'artifact.calls');
  const count = parse.integer(calls.count, 'artifact.calls.count');
  const generate = parse.integer(calls.generate, 'artifact.calls.generate');
  parse.array(artifact.pages, 'artifact.pages');
  parse.array(artifact.attempts, 'artifact.attempts');

  /* A failed acquisition must not become a valid empty reference. */
  if (status === 'failed' && count === 0 && generate === 0) {
    throw new parse.SplitDatasetError(
      'artifact: failed with no workflow activity; acquisition completion is ambiguous.',
    );
  }

  const evidence = parseSplitEvidence({
    identity: artifact.identity,
    changes: artifact.changes,
    hunks: artifact.hunks,
  });
  const input: Record<string, unknown> = {
    partition: 'development',
    tags: [],
    notes: [],
    review: { status: 'draft' },
    ...(artifact.caseMetadata === undefined
      ? {}
      : parse.object(artifact.caseMetadata, 'artifact.caseMetadata')),
  };

  return {
    format: 'daphne-split-input-v1',
    id: parse.text(caseId, 'case.id'),
    partition: parse.choice(
      input.partition,
      ['development', 'holdout'],
      'case.partition',
    ),
    tags: parse
      .array(input.tags, 'tags')
      .map((value) => parse.text(value, 'tag')),
    provenance:
      input.provenance === undefined ? null : provenance(input.provenance),
    evidence,
    labels: labels(expectations, getExpectedUnitIds(evidence.changes)),
    notes: parse
      .array(input.notes, 'notes')
      .map((value) => parse.text(value, 'note')),
    review: review(input.review),
  };
}

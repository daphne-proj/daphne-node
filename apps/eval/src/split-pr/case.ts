import { getExpectedUnitIds } from '@daphne/semantic-split';
import type { PairLabel, SplitCase } from './contracts.js';
import { parseSplitEvidence } from './evidence.js';
import * as parse from './parse.js';

function labels(value: unknown, expected: ReadonlySet<string>): PairLabel[] {
  const pairs = new Set<string>();
  const result = parse.array(value, 'labels').map((value, index): PairLabel => {
    const field = `labels[${String(index)}]`;
    const input = parse.object(value, field);
    const leftUnitId = parse.text(input.leftUnitId, `${field}.leftUnitId`);
    const rightUnitId = parse.text(input.rightUnitId, `${field}.rightUnitId`);
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
      relation: parse.choice(
        input.relation,
        ['together', 'separate', 'unknown'],
        `${field}.relation`,
      ),
      reason: parse.text(input.reason, `${field}.reason`),
    };
  });

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

export function parseSplitCase(value: unknown): SplitCase {
  const input = parse.object(value, 'case');
  const format = parse.choice(
    input.format,
    ['daphne-split-case-v1'],
    'case.format',
  );
  const evidence = parseSplitEvidence(input.evidence);

  return {
    format,
    id: parse.text(input.id, 'case.id'),
    partition: parse.choice(
      input.partition,
      ['development', 'holdout'],
      'case.partition',
    ),
    tags: parse
      .array(input.tags, 'tags')
      .map((value) => parse.text(value, 'tag')),
    provenance: provenance(input.provenance),
    evidence,
    labels: labels(input.labels, getExpectedUnitIds(evidence.changes)),
    notes: parse
      .array(input.notes, 'notes')
      .map((value) => parse.text(value, 'note')),
    review: review(input.review),
  };
}

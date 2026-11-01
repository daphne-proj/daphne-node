import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { IntentionJudgePacket } from './artifact.js';
import { parseGoldEvidence } from './gold-evidence.js';
import { validateSourceConsistency } from '../split-pr/source-consistency.js';
import * as parse from '../parse.js';

function ids(value: unknown, known: ReadonlySet<string>, field: string) {
  const result = parse.array(value, field).map((id) => parse.text(id, field));

  if (
    new Set(result).size !== result.length ||
    result.some((id) => !known.has(id))
  ) {
    throw new parse.EvaluationError(
      `${field}: unknown or duplicate reference.`,
    );
  }

  return result;
}

/*
 * Load a case and its independently preserved evidence before any judge request.
 * For example, cases/pr_1.json resolves its evidence file relative to itself.
 * Hashes bind labels to exact source bytes; reference validation does not approve
 * their meaning. Draft cases remain provisional, and malformed data throws.
 */
export async function loadIntentionGoldCase(path: string) {
  const file = await parse.readJson(path, (value) =>
    parse.object(value, 'case'),
  );
  const input = file.value;
  parse.choice(input.format, ['daphne-intentions-gold-v1'], 'case.format');
  const id = parse.text(input.id, 'case.id');
  const partition = parse.choice(
    input.partition,
    ['development', 'holdout'],
    'case.partition',
  );
  const review = parse.object(input.review, 'case.review');
  const status = parse.choice(
    review.status,
    ['draft', 'reviewed'],
    'review.status',
  );
  const reviewer =
    review.reviewer === null
      ? null
      : parse.text(review.reviewer, 'review.reviewer');
  const reviewedAt =
    review.reviewedAt === null
      ? null
      : parse.timestamp(review.reviewedAt, 'review.reviewedAt');

  if (status === 'reviewed' && (reviewer === null || reviewedAt === null)) {
    throw new parse.EvaluationError(
      'Reviewed gold requires a reviewer and review timestamp.',
    );
  }

  const evidencePath = resolve(
    dirname(path),
    parse.text(input.evidenceFile, 'case.evidenceFile'),
  );
  const frozen = await parse.readJson(evidencePath, (value) =>
    parse.object(value, 'evidence'),
  );

  if (
    parse.sha256(frozen.bytes) !==
    parse.text(input.evidenceHash, 'case.evidenceHash')
  ) {
    throw new parse.EvaluationError('Gold evidence hash mismatch.');
  }

  parse.choice(
    frozen.value.format,
    ['daphne-intentions-gold-evidence-v1'],
    'evidence.format',
  );
  const evidence = parseGoldEvidence(frozen.value);
  const metadata = parse.object(frozen.value.metadata, 'evidence.metadata');
  const pr = parse.text(frozen.value.pr, 'evidence.pr');
  const title = parse.text(metadata.title, 'metadata.title', true);
  const body =
    metadata.body === null
      ? null
      : parse.text(metadata.body, 'metadata.body', true);
  const changes = new Set(evidence.changes.map((change) => change.id));
  const sources = new Map(
    evidence.sources.map((source) => [source.evidenceId, source.source]),
  );
  const accounted = new Set<string>();

  function expectation(value: unknown, side: 'base' | 'head') {
    const field = parse.object(value, `behavior.${side}`);
    const changeIds = ids(field.changeIds, changes, 'behavior.changeIds');
    const sourceIds = ids(
      field.sourceIds,
      new Set(sources.keys()),
      'behavior.sourceIds',
    );

    if (
      changeIds.length === 0 ||
      sourceIds.some((id) => sources.get(id)?.ref.side !== side)
    ) {
      throw new parse.EvaluationError(
        'Behavior references require known changes and the correct source revision.',
      );
    }

    if (
      sourceIds.length === 0 &&
      !changeIds.every((id) => {
        const change = evidence.changes.find((entry) => entry.id === id);
        return side === 'base'
          ? change?.beforePath === null
          : change?.afterPath === null;
      })
    ) {
      throw new parse.EvaluationError(
        'A behavior needs source support unless its paths are absent on that side.',
      );
    }

    for (const id of changeIds) {
      accounted.add(id);
    }

    return {
      meaning: parse.text(field.meaning, 'behavior.meaning'),
      changeIds,
      sourceIds,
    };
  }

  const behaviors = parse
    .array(input.behaviors, 'case.behaviors')
    .map((value) => {
      const behavior = parse.object(value, 'behavior');

      if (typeof behavior.required !== 'boolean') {
        throw new parse.EvaluationError(
          'behavior.required: expected a boolean.',
        );
      }

      return {
        id: parse.text(behavior.id, 'behavior.id'),
        required: behavior.required,
        before: expectation(behavior.before, 'base'),
        after: expectation(behavior.after, 'head'),
      };
    });

  if (
    behaviors.length === 0 ||
    new Set(behaviors.map((behavior) => behavior.id)).size !== behaviors.length
  ) {
    throw new parse.EvaluationError(
      'Gold needs distinct, nonempty behavior records.',
    );
  }

  const incidentalChanges = parse
    .array(input.incidentalChanges, 'case.incidentalChanges')
    .map((value) => {
      const entry = parse.object(value, 'incidental change');
      const changeIds = ids(entry.changeIds, changes, 'incidental.changeIds');

      if (changeIds.length === 0) {
        throw new parse.EvaluationError(
          'Incidental entries need at least one change.',
        );
      }

      for (const id of changeIds) {
        accounted.add(id);
      }

      return {
        changeIds,
        reason: parse.text(entry.reason, 'incidental.reason'),
      };
    });

  if (accounted.size !== changes.size) {
    throw new parse.EvaluationError(
      'Gold must account for every change as behavior or incidental.',
    );
  }

  return {
    id,
    partition,
    review: { status, reviewer, reviewedAt },
    behaviors,
    incidentalChanges,
    caseHash: parse.sha256(file.bytes),
    evidenceHash: parse.sha256(frozen.bytes),
    pr,
    metadata: { title, body },
    evidence,
  };
}

export type IntentionGoldCase = Awaited<
  ReturnType<typeof loadIntentionGoldCase>
>;

/*
 * Match a validated accepted artifact to its gold comparison, ignoring only the
 * acquisition session ID. Check original hunks and all overlapping source bytes;
 * unrelated revisions, metadata or inventories must fail before model execution.
 * Gold sources get separate IDs for factual checks, never new candidate citations.
 */
export function prepareGoldPacket(
  gold: IntentionGoldCase,
  packet: IntentionJudgePacket,
): IntentionJudgePacket {
  const expected = { ...gold.evidence.identity, sessionId: '' };
  const actual = { ...packet.identity, sessionId: '' };

  if (
    !isDeepStrictEqual(expected, actual) ||
    !isDeepStrictEqual(gold.metadata, packet.metadata) ||
    !isDeepStrictEqual(gold.evidence.changes, packet.changes)
  ) {
    throw new parse.EvaluationError(
      'Artifact revisions, metadata or inventory differ from the gold case.',
    );
  }

  const frozen = gold.evidence.sources.map(({ source }) => source);
  const delivered = packet.sources.map(({ source }) => source);
  validateSourceConsistency([...frozen, ...delivered]);

  for (const hunk of packet.hunks) {
    const reference = gold.evidence.hunks.find(
      (entry) =>
        entry.changeId === hunk.changeId && entry.hunkIndex === hunk.hunkIndex,
    );
    const expectedSources = reference?.evidenceIds.map(
      (id) =>
        gold.evidence.sources.find((source) => source.evidenceId === id)
          ?.source,
    );
    const actualSources = hunk.evidenceIds.map(
      (id) => packet.sources.find((source) => source.evidenceId === id)?.source,
    );
    const comparable = (sources: typeof expectedSources) =>
      sources?.map((source) => {
        if (!source) {
          throw new parse.EvaluationError('Missing original hunk source.');
        }

        return { ...source, ref: { ...source.ref, sessionId: '' } };
      });

    if (
      !isDeepStrictEqual(comparable(expectedSources), comparable(actualSources))
    ) {
      throw new parse.EvaluationError(
        'Artifact original hunks differ from the frozen gold evidence.',
      );
    }
  }

  if (packet.hunks.length !== gold.evidence.hunks.length) {
    throw new parse.EvaluationError(
      'Artifact original hunk count differs from gold.',
    );
  }

  return {
    ...packet,
    sources: [
      ...packet.sources,
      ...gold.evidence.sources.map((source) => ({
        ...source,
        evidenceId: `gold:${source.evidenceId}`,
      })),
    ],
  };
}

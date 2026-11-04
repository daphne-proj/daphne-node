import { isDeepStrictEqual } from 'node:util';
import type { IntentionJudgePacket } from './artifact.js';
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
 * Load labels and pinned PR identity before judging a saved run. For example,
 * cases/pr_1.json contains expectations without a separate source snapshot.
 * Every change must be accounted for; malformed references throw. Source code
 * comes only from the validated run, and draft labels remain provisional.
 */
export async function loadIntentionGoldCase(path: string) {
  const file = await parse.readJson(path, (value) =>
    parse.object(value, 'case'),
  );
  const input = file.value;
  parse.choice(input.format, ['daphne-intentions-gold-v2'], 'case.format');
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

  const revision = parse.object(input.identity, 'case.identity');

  function commit(field: string) {
    const value = parse.text(revision[field], `identity.${field}`);

    if (!/^[0-9a-f]{40}$/.test(value)) {
      throw new parse.EvaluationError(
        `identity.${field}: expected a full Git commit ID.`,
      );
    }

    return value;
  }

  const identity = {
    repositoryUrl: parse.text(revision.repositoryUrl, 'identity.repositoryUrl'),
    targetCommit: commit('targetCommit'),
    baseCommit: commit('baseCommit'),
    headCommit: commit('headCommit'),
  };
  const metadata = parse.object(input.metadata, 'case.metadata');
  const pr = parse.text(input.pr, 'case.pr');
  const title = parse.text(metadata.title, 'metadata.title', true);
  const body =
    metadata.body === null
      ? null
      : parse.text(metadata.body, 'metadata.body', true);
  const changeIds = parse
    .array(input.changeIds, 'case.changeIds')
    .map((id) => parse.text(id, 'case.changeIds'));
  const changes = new Set(changeIds);

  if (changes.size === 0 || changes.size !== changeIds.length) {
    throw new parse.EvaluationError(
      'Gold requires distinct, nonempty change IDs.',
    );
  }

  const accounted = new Set<string>();

  function expectation(value: unknown) {
    const field = parse.object(value, 'behavior');
    const changeIds = ids(field.changeIds, changes, 'behavior.changeIds');

    if (changeIds.length === 0) {
      throw new parse.EvaluationError('A behavior requires change references.');
    }

    for (const id of changeIds) {
      accounted.add(id);
    }

    return {
      meaning: parse.text(field.meaning, 'behavior.meaning'),
      changeIds,
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
        before: expectation(behavior.before),
        after: expectation(behavior.after),
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

  /* Issue labels identify affected changes; the run supplies any source used to assess them. */
  function issueLabels(value: unknown, field: string) {
    const labels = parse.array(value, field).map((value) => {
      const label = parse.object(value, field);
      const changeIds = ids(label.changeIds, changes, `${field}.changeIds`);

      if (changeIds.length === 0) {
        throw new parse.EvaluationError(
          `${field}: labels need change references.`,
        );
      }

      return {
        id: parse.text(label.id, `${field}.id`),
        meaning: parse.text(label.meaning, `${field}.meaning`),
        changeIds,
      };
    });

    if (new Set(labels.map((label) => label.id)).size !== labels.length) {
      throw new parse.EvaluationError(`${field}: duplicate label IDs.`);
    }

    return labels;
  }

  const expectedIssues = issueLabels(input.expectedIssues, 'expectedIssues');
  const falseAlarmControls = issueLabels(
    input.falseAlarmControls,
    'falseAlarmControls',
  );

  if (
    falseAlarmControls.some((control) =>
      expectedIssues.some((issue) => issue.id === control.id),
    )
  ) {
    throw new parse.EvaluationError(
      'Expected issues and false-alarm controls need distinct IDs.',
    );
  }

  return {
    id,
    partition,
    review: { status, reviewer, reviewedAt },
    behaviors,
    incidentalChanges,
    expectedIssues,
    falseAlarmControls,
    caseHash: parse.sha256(file.bytes),
    pr,
    metadata: { title, body },
    identity,
    changeIds,
  };
}

export type IntentionGoldCase = Awaited<
  ReturnType<typeof loadIntentionGoldCase>
>;

/*
 * Reject a run from a different pinned PR comparison before invoking the judge.
 * For example, changing HEAD or PR metadata requires relabeling the case. Only
 * acquisition session IDs may differ; the artifact reader validates source bytes.
 * This check never adds sources or changes the candidate's citation context.
 */
export function validateGoldComparison(
  gold: IntentionGoldCase,
  packet: IntentionJudgePacket,
): void {
  const actual = {
    repositoryUrl: packet.identity.repositoryUrl,
    targetCommit: packet.identity.targetCommit,
    baseCommit: packet.identity.baseCommit,
    headCommit: packet.identity.headCommit,
  };

  if (
    !isDeepStrictEqual(gold.identity, actual) ||
    !isDeepStrictEqual(gold.metadata, packet.metadata) ||
    !isDeepStrictEqual(
      gold.changeIds,
      packet.changes.map((change) => change.id),
    )
  ) {
    throw new parse.EvaluationError(
      'Artifact revisions, metadata or change IDs differ from the gold case.',
    );
  }
}

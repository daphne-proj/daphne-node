import { expect, test } from 'vitest';
import { getExpectedUnitIds, validateProposal } from '@daphne/semantic-split';
import type { Change } from '@daphne/review-evidence/contracts';

const group = {
  title: 'Update the parser',
  reason: 'Keep related changes together.',
  unitIds: ['a:0', 'b:0'],
};

test('expected IDs follow inventory order and include metadata-only changes', () => {
  const text: Change = {
    id: 'text',
    beforePath: 'parser.ts',
    afterPath: 'parser.ts',
    beforeMode: '100644',
    afterMode: '100644',
    status: 'modified',
    kind: 'text',
    hunks: [
      {
        beforeStartLine: 1,
        beforeLineCount: 1,
        afterStartLine: 1,
        afterLineCount: 2,
      },
      {
        beforeStartLine: 8,
        beforeLineCount: 1,
        afterStartLine: 9,
        afterLineCount: 1,
      },
    ],
  };

  const changes: Change[] = [
    text,
    { ...text, id: 'empty', hunks: [] },
    { ...text, id: 'binary', kind: 'binary', hunks: [] },
  ];

  expect([...getExpectedUnitIds(changes)]).toEqual([
    'text:0',
    'text:1',
    'empty:metadata',
    'binary:metadata',
  ]);
});

test('accepts a proposal covering every expected unit exactly once', () => {
  const proposal = {
    groups: [group],
    warnings: ['Review parser compatibility.'],
  };

  expect(
    validateProposal(JSON.stringify(proposal), new Set(['a:0', 'b:0'])),
  ).toEqual({ status: 'valid', proposal });
});

test.each([
  {
    name: 'within one group',
    groups: [{ ...group, unitIds: ['a:0', 'a:0', 'unknown'] }],
  },
  {
    name: 'across groups',
    groups: [
      { ...group, unitIds: ['a:0'] },
      { ...group, title: 'Another group', unitIds: ['a:0', 'unknown'] },
    ],
  },
])('reports missing, duplicated and unknown units $name', ({ groups }) => {
  const validation = validateProposal(
    JSON.stringify({ groups, warnings: [] }),
    new Set(['a:0', 'b:0']),
  );

  expect(validation).toEqual({
    status: 'invalid_coverage',
    missingIds: ['b:0'],
    duplicateIds: ['a:0'],
    unknownIds: ['unknown'],
  });
});

test.each([
  { name: 'broken JSON', text: '{', status: 'invalid_json' },
  {
    name: 'extra proposal field',
    text: JSON.stringify({ groups: [group], warnings: [], extra: true }),
    status: 'invalid_shape',
  },
  {
    name: 'extra group field',
    text: JSON.stringify({ groups: [{ ...group, extra: true }], warnings: [] }),
    status: 'invalid_shape',
  },
  {
    name: 'blank title',
    text: JSON.stringify({
      groups: [{ ...group, title: ' \t' }],
      warnings: [],
    }),
    status: 'invalid_shape',
  },
  {
    name: 'empty group',
    text: JSON.stringify({ groups: [{ ...group, unitIds: [] }], warnings: [] }),
    status: 'invalid_shape',
  },
])('rejects $name', ({ text, status }) => {
  expect(validateProposal(text, new Set(['a:0', 'b:0']))).toMatchObject({
    status,
  });
});

test('an empty proposal is valid only for an empty inventory', () => {
  const proposal = { groups: [], warnings: [] };
  const text = JSON.stringify(proposal);

  expect(validateProposal(text, new Set())).toEqual({
    status: 'valid',
    proposal,
  });
  expect(validateProposal(text, new Set(['a:0']))).toEqual({
    status: 'invalid_coverage',
    missingIds: ['a:0'],
    duplicateIds: [],
    unknownIds: [],
  });
});

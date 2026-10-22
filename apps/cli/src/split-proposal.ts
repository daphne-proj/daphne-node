import type { Change } from '@daphne/review-evidence';

export interface Proposal {
  groups: { title: string; reason: string; unitIds: string[] }[];
  warnings: string[];
}

export type ProposalValidation =
  | { status: 'valid'; proposal: Proposal }
  | { status: 'invalid_json' | 'invalid_shape'; message: string }
  | {
      status: 'invalid_coverage';
      missingIds: string[];
      duplicateIds: string[];
      unknownIds: string[];
    };

/* Derive coverage from Git's inventory so missing page entries cannot hide omissions. */
export function getExpectedUnitIds(
  changes: readonly Change[],
): ReadonlySet<string> {
  const unitIds = new Set<string>();

  for (const change of changes) {
    if (change.kind === 'text' && change.hunks.length > 0) {
      for (let index = 0; index < change.hunks.length; index++) {
        unitIds.add(`${change.id}:${String(index)}`);
      }
    } else {
      unitIds.add(`${change.id}:metadata`);
    }
  }

  return unitIds;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateProposal(
  text: string,
  expectedUnitIds: ReadonlySet<string>,
): ProposalValidation {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }

    return { status: 'invalid_json', message: error.message };
  }

  if (
    !isObject(value) ||
    Object.keys(value).some((key) => !['groups', 'warnings'].includes(key)) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every((warning: unknown) => typeof warning === 'string')
  ) {
    return {
      status: 'invalid_shape',
      message:
        'Expected an object containing only groups and warnings arrays, with strings in warnings.',
    };
  }

  const groups: Proposal['groups'] = [];

  for (const group of value.groups) {
    if (
      !isObject(group) ||
      Object.keys(group).some(
        (key) => !['title', 'reason', 'unitIds'].includes(key),
      ) ||
      typeof group.title !== 'string' ||
      !group.title.trim() ||
      typeof group.reason !== 'string' ||
      !Array.isArray(group.unitIds) ||
      group.unitIds.length === 0 ||
      !group.unitIds.every((id: unknown) => typeof id === 'string')
    ) {
      return {
        status: 'invalid_shape',
        message: `Group ${String(groups.length + 1)} must contain only a nonblank title, a string reason, and a nonempty unitIds array of strings.`,
      };
    }

    groups.push({
      title: group.title,
      reason: group.reason,
      unitIds: group.unitIds,
    });
  }

  const counts = new Map<string, number>();

  for (const group of groups) {
    for (const id of group.unitIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  const missingIds = [...expectedUnitIds].filter((id) => !counts.has(id));
  const duplicateIds: string[] = [];
  const unknownIds: string[] = [];

  for (const [id, count] of counts) {
    if (count > 1) {
      duplicateIds.push(id);
    }

    if (!expectedUnitIds.has(id)) {
      unknownIds.push(id);
    }
  }

  if (
    missingIds.length > 0 ||
    duplicateIds.length > 0 ||
    unknownIds.length > 0
  ) {
    return { status: 'invalid_coverage', missingIds, duplicateIds, unknownIds };
  }

  return { status: 'valid', proposal: { groups, warnings: value.warnings } };
}

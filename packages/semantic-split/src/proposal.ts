import type { Change } from '@daphne/review-evidence/contracts';
import { proposalOutputSchema } from './schema.js';
import type { Proposal } from './schema.js';

export type { Proposal } from './schema.js';

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

/* Shape parsing preserves text; coverage still uses the original inventory and encounter order. */
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

  const parsed = proposalOutputSchema.safeParse(value);

  if (!parsed.success) {
    return {
      status: 'invalid_shape',
      message: parsed.error.issues
        .map(
          (issue) =>
            `${issue.path.map(String).join('.') || 'proposal'}: ${issue.message}`,
        )
        .join('; '),
    };
  }

  const proposal = parsed.data;
  const counts = new Map<string, number>();

  for (const group of proposal.groups) {
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

  return { status: 'valid', proposal };
}

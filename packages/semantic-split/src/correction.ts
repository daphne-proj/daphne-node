import type { PageAnalysis } from './contracts.js';
import type { ProposalValidation } from './proposal.js';
import { correctionInstructions } from './prompts.js';

/*
 * Build an application-generated correction prompt for the LLM, appended to the
 * grouping conversation with the API role `user`. Its JSON content requests a
 * complete replacement proposal and includes validation errors and relevant raw
 * diff pages. For example, a missing unit gets its original diff page.
 * Update suppliedPageIndexes so each page is included once, in original order;
 * the caller has already checked that pages match the inventory.
 */
export function correctionMessage(
  validation: Exclude<ProposalValidation, { status: 'valid' }>,
  pages: readonly PageAnalysis[],
  suppliedPageIndexes: Set<number>,
): Record<string, unknown> {
  const evidence: {
    pageIndex: number;
    unitIds: readonly string[];
    context: string;
  }[] = [];

  if (validation.status === 'invalid_coverage') {
    const neededIds = new Set([
      ...validation.missingIds,
      ...validation.duplicateIds,
    ]);

    for (const [pageIndex, page] of pages.entries()) {
      if (
        !suppliedPageIndexes.has(pageIndex) &&
        page.unitIds.some((id) => neededIds.has(id))
      ) {
        evidence.push({
          pageIndex,
          unitIds: page.unitIds,
          context: page.context,
        });
        suppliedPageIndexes.add(pageIndex);
      }
    }
  }

  return {
    role: 'user',
    content: JSON.stringify({
      instruction: correctionInstructions,
      validation,
      pages: evidence,
    }),
  };
}

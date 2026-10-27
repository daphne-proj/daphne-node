import type { IntentionsPullRequestResult } from '@daphne/pr-review/intentions';
import { describeFailure } from './errors.js';

/*
 * Keeps the investigation available in run.json after a failed run. For example,
 * a completed draft remains diagnostic if Git cleanup fails. Replace error
 * objects with the CLI's safe descriptions so causes and credentials stay out
 * of the artifact; only the report's top-level proposal is accepted output.
 */
export function serializeInvestigation(
  investigation: IntentionsPullRequestResult['investigation'],
) {
  if (investigation === null) {
    return null;
  }

  return {
    ...investigation,
    tools: investigation.tools.map((tool) => {
      if (tool.status === 'complete') {
        return tool;
      }

      return {
        ...tool,
        error: describeFailure('investigation', tool.error),
      };
    }),
    ...(investigation.status === 'failed'
      ? { error: describeFailure('investigation', investigation.error) }
      : {}),
  };
}

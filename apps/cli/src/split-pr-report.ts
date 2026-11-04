import type { SplitPullRequestResult } from '@daphne/pr-review/split';
import { describeFailure } from './errors.js';

/* Keep completed replies/evidence while serializing errors without their causes or credentials. */
export function serializeSplitInvestigation(
  investigation: SplitPullRequestResult['investigation'],
) {
  if (investigation === null) {
    return null;
  }

  return {
    ...investigation,
    tools: investigation.tools.map((tool) =>
      tool.status === 'complete'
        ? tool
        : {
            ...tool,
            error: describeFailure('investigation', tool.error),
          },
    ),
    ...(investigation.status === 'failed'
      ? { error: describeFailure('investigation', investigation.error) }
      : {}),
  };
}

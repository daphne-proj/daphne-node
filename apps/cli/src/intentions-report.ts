import type { IntentionsProposal, IntentionReason } from '@daphne/intentions';
import { formatCommandOutput, formatCommandTable } from './command-output.js';
import { formatIntentionRunSummary } from './intentions-summary.js';
import type { IntentionRunSummary } from './intentions-summary.js';

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

function reasonText(reason: IntentionReason): string {
  return reason.basis === 'unknown'
    ? 'Unknown'
    : `${reason.text} (${reason.basis})`;
}

/* Render accepted cards and accounting for an interactive terminal; raw citations remain in run.json. */
export function formatIntentionsOutput(input: {
  status: string;
  proposal: IntentionsProposal | null;
  output: string | null;
  errors: { message: string }[];
  summary: IntentionRunSummary;
}): string {
  const sections = [
    formatCommandOutput('Intentions result', [
      {
        label: 'Status',
        value: input.status,
        tone: input.status === 'complete' ? 'success' : 'error',
      },
      {
        label: 'Intentions',
        value: String(input.proposal?.intentions.length ?? 0),
      },
      {
        label: 'Run artifact',
        value: input.output ?? 'Could not save run.json',
      },
      ...input.errors.map(({ message }) => ({
        label: 'Error',
        value: message,
        tone: 'error' as const,
      })),
    ]),
    formatIntentionRunSummary(input.summary),
  ];

  for (const [index, intention] of (
    input.proposal?.intentions ?? []
  ).entries()) {
    sections.push(
      formatCommandTable(
        `${String(index + 1)}. ${intention.title}`,
        ['Aspect', 'Explanation'],
        [
          { values: ['BASE', intention.before.text] },
          { values: ['HEAD', intention.after.text] },
          { values: ['Purpose', reasonText(intention.intendedOutcome)] },
          { values: ['Motivation', reasonText(intention.why)] },
          ...intention.issues.map((issue, issueIndex) => ({
            values: [
              `Issue ${String(issueIndex + 1)}`,
              `${issue.text}\nPR relevance: ${issue.relevance.replaceAll('_', ' ')}${issue.uncertainty === null ? '' : `\nUncertainty: ${issue.uncertainty}`}`,
            ],
            tone: 'warning' as const,
          })),
        ],
      ),
    );
  }

  if (input.proposal?.warnings.length) {
    sections.push(
      formatCommandOutput(
        'Warnings',
        input.proposal.warnings.map((value) => ({
          label: 'Warning',
          value,
          tone: 'warning',
        })),
      ),
    );
  }

  return sections.join('\n');
}

import { open } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { ModelError } from '@daphne/llm';
import { EvidenceInputError } from '@daphne/review-evidence';
import {
  ContextConflictError,
  ContextInputError,
  ContextLimitError,
} from '@daphne/context-engine';
import type { IntentionsProposal } from '@daphne/intentions';
import type { RetainedSource } from '@daphne/context-engine';
import type {
  Change,
  ContextNotice,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';
import { parseIntentionEvidence, parseNotices } from './evidence.js';
import { parseIntentionTrace } from './artifact-trace.js';
import type { IntentionSearchReceipt } from './artifact-tools.js';
import { parseRunBudget } from '../run-budget.js';
import type { IntentionRunSummary } from '@daphne/cli/intentions-summary';
import { parseIntentionRunSummary } from '@daphne/cli/intentions-summary';
import * as parse from '../parse.js';

/*
 * Contains only the accepted cards and evidence needed to judge them. For
 * example, hunks map the complete diff to sources by evidenceId, while proposal
 * citations contain freshly resolved byte ranges. Model names and earlier
 * assessments stay outside this packet to avoid influencing the judge. Search
 * receipts establish scoped investigation history without granting code citation
 * eligibility; for example, an empty search is not proof that no callers exist.
 */
export interface IntentionJudgePacket {
  identity: ReviewIdentity;
  metadata: { title: string; body: string | null };
  changes: Change[];
  hunks: {
    changeId: string;
    hunkIndex: number | null;
    evidenceIds: string[];
  }[];
  sources: RetainedSource[];
  limitations: ContextNotice[];
  searches: readonly IntentionSearchReceipt[];
  proposal: IntentionsProposal;
}

/* Only complete, freshly validated runs have a packet that may be sent to Codex. */
export type PreparedIntentionArtifact = {
  artifactHash: string;
  diagnostics: string[];
  generationInstructions: string | null;
} & (
  | { status: 'complete'; packet: IntentionJudgePacket }
  | { status: 'failed_run' | 'invalid_output'; packet: null }
);

function instructions(value: unknown, field: string): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const response = parse.object(value, field);

  if (response.instructions === null || response.instructions === undefined) {
    return null;
  }

  return parse.text(response.instructions, `${field}.instructions`);
}

function decodeArtifact(
  value: unknown,
  artifactHash: string,
): PreparedIntentionArtifact {
  const artifact = parse.object(value, 'artifact');
  const provider = parse.choice(
    artifact.provider ?? 'openai',
    ['openai', 'anthropic', 'codex'],
    'artifact.provider',
  );
  const status = parse.choice(
    artifact.status,
    ['complete', 'failed'],
    'artifact.status',
  );
  const generationInstructions = instructions(
    artifact.response,
    'artifact.response',
  );
  const errors = parse.array(artifact.errors, 'artifact.errors');

  if (status === 'failed') {
    if (
      artifact.proposal !== null ||
      artifact.response !== null ||
      errors.length === 0
    ) {
      throw new parse.EvaluationError(
        'A failed run requires errors and no accepted proposal or response.',
      );
    }

    const diagnostics = errors.map((value, index) => {
      const field = `artifact.errors[${String(index)}]`;
      const error = parse.object(value, field);
      return parse.text(error.message, `${field}.message`);
    });

    return {
      artifactHash,
      diagnostics,
      generationInstructions,
      status: 'failed_run',
      packet: null,
    };
  }

  if (errors.length > 0) {
    throw new parse.EvaluationError(
      'A complete run cannot contain workflow errors.',
    );
  }

  const investigation = parse.object(
    artifact.investigation,
    'artifact.investigation',
  );
  parse.choice(investigation.status, ['complete'], 'investigation.status');
  const comparison = parse.object(
    investigation.comparison,
    'investigation.comparison',
  );
  const metadata = parse.object(artifact.metadata, 'artifact.metadata');
  const pr = {
    url: parse.text(artifact.pr, 'artifact.pr'),
    title: parse.text(metadata.title, 'metadata.title', true),
    body:
      metadata.body === null
        ? null
        : parse.text(metadata.body, 'metadata.body', true),
  };
  const evidence = parseIntentionEvidence(artifact, investigation);

  if (
    !isDeepStrictEqual(comparison.identity, evidence.identity) ||
    !isDeepStrictEqual(comparison.changes, evidence.changes) ||
    !isDeepStrictEqual(comparison.pr, pr) ||
    metadata.targetCommit !== evidence.identity.targetCommit ||
    metadata.headCommit !== evidence.identity.headCommit
  ) {
    throw new parse.EvaluationError(
      'The investigation comparison differs from the captured artifact.',
    );
  }

  if (
    !isDeepStrictEqual(
      parseRunBudget(artifact.budget),
      parseRunBudget(investigation.budget),
    )
  ) {
    throw new parse.EvaluationError(
      'The artifact and investigation budgets disagree.',
    );
  }

  const accepted = parseIntentionTrace(investigation, {
    ...evidence,
    pr,
    provider,
  });

  if (
    !isDeepStrictEqual(artifact.proposal, accepted.proposal) ||
    !isDeepStrictEqual(investigation.proposal, accepted.proposal) ||
    !isDeepStrictEqual(artifact.response, accepted.response) ||
    !isDeepStrictEqual(investigation.response, accepted.response)
  ) {
    throw new parse.EvaluationError(
      'Accepted output disagrees with its structurally valid writer reply.',
    );
  }

  const delivered = new Set(accepted.deliveredEvidenceIds);

  return {
    artifactHash,
    diagnostics: [],
    generationInstructions: accepted.generationInstructions,
    status: 'complete',
    packet: {
      identity: evidence.identity,
      metadata: { title: pr.title, body: pr.body },
      changes: evidence.changes,
      hunks: evidence.hunks,
      sources: evidence.sources.filter(({ evidenceId }) =>
        delivered.has(evidenceId),
      ),
      searches: accepted.searches,
      limitations: [
        ...parseNotices(artifact.limitations, 'artifact.limitations'),
        ...parseNotices(investigation.limitations, 'investigation.limitations'),
      ],
      proposal: accepted.proposal,
    },
  };
}

/*
 * Reads one local run without repository or model calls. For example,
 * loadIntentionArtifact('outputs/intentions/run.json') returns a judge packet
 * only after revalidating source delivery and the selected writer draft. Malformed
 * artifact data returns invalid_output with no judge packet; failed runs remain
 * explicit outcomes. Unreadable/oversized files and unexpected internal failures
 * throw. The file and retained evidence have fixed host-side caps.
 */
export async function loadIntentionArtifact(
  path: string,
): Promise<
  PreparedIntentionArtifact & { generationSummary: IntentionRunSummary | null }
> {
  const maxBytes = 64 * 1024 * 1024;
  const handle = await open(path, 'r');
  let bytes: Buffer;

  try {
    const stat = await handle.stat();

    if (!stat.isFile() || stat.size > maxBytes) {
      throw new parse.EvaluationError(
        'The intentions artifact must be a regular file of at most 64 MiB.',
      );
    }

    const chunks: Buffer[] = [];
    const stream = handle.createReadStream({
      autoClose: false,
      start: 0,
      end: maxBytes,
    });
    let length = 0;

    for await (const chunk of stream) {
      if (!Buffer.isBuffer(chunk)) {
        throw new parse.EvaluationError('Expected artifact bytes.');
      }

      length += chunk.length;

      if (length > maxBytes) {
        throw new parse.EvaluationError(
          'The intentions artifact exceeds 64 MiB.',
        );
      }

      chunks.push(chunk);
    }

    bytes = Buffer.concat(chunks, length);
  } finally {
    await handle.close();
  }

  const artifactHash = parse.sha256(bytes);

  try {
    let value: unknown;

    try {
      value = JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch (error) {
      throw new parse.EvaluationError(
        'The intentions artifact is not valid UTF-8 JSON.',
        { cause: error },
      );
    }

    const prepared = decodeArtifact(value, artifactHash);
    const artifact = parse.object(value, 'artifact');

    return {
      ...prepared,
      generationSummary: parseIntentionRunSummary(artifact.summary),
    };
  } catch (error) {
    if (
      !(error instanceof parse.EvaluationError) &&
      !(error instanceof ModelError) &&
      !(error instanceof ContextInputError) &&
      !(error instanceof ContextConflictError) &&
      !(error instanceof ContextLimitError) &&
      !(error instanceof EvidenceInputError) &&
      !(error instanceof SyntaxError)
    ) {
      throw error;
    }

    return {
      artifactHash,
      diagnostics: [error.message],
      generationInstructions: null,
      status: 'invalid_output',
      packet: null,
      generationSummary: null,
    };
  }
}

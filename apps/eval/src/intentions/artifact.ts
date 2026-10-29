import { open } from 'node:fs/promises';
import { isDeepStrictEqual } from 'node:util';
import { validateIntentions } from '@daphne/intentions';
import type { IntentionsProposal } from '@daphne/intentions';
import type { RetainedSource } from '@daphne/context-engine';
import type {
  Change,
  ContextNotice,
  ReviewIdentity,
} from '@daphne/review-evidence/contracts';
import { parseIntentionEvidence, parseNotices } from './evidence.js';
import * as parse from '../parse.js';

/*
 * Contains only the accepted cards and evidence needed to judge them. For
 * example, hunks map the complete diff to sources by evidenceId, while proposal
 * citations contain freshly resolved byte ranges. Model names and earlier
 * assessments stay outside this packet to avoid influencing the judge.
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
  parse.choice(artifact.format, ['daphne-intentions-v1'], 'artifact.format');
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

  const turns = parse.array(investigation.turns, 'investigation.turns');
  let proposalText = '{"intentions":[],"warnings":[]}';
  let finalInstructions: string | null = null;

  if (evidence.changes.length === 0) {
    if (turns.length !== 0) {
      throw new parse.EvaluationError(
        'An empty comparison must not contain generation turns.',
      );
    }
  } else {
    const final = turns.at(-1);

    if (final === undefined) {
      throw new parse.EvaluationError(
        'A complete nonempty run requires a final model turn.',
      );
    }

    const turn = parse.object(final, 'final turn');
    const reply = parse.object(turn.reply, 'final reply');
    proposalText = parse.text(reply.text, 'final reply.text', true);
    finalInstructions = instructions(reply.response, 'final reply.response');

    if (
      reply.functionCalls !== undefined &&
      parse.array(reply.functionCalls, 'final reply.functionCalls').length > 0
    ) {
      return {
        artifactHash,
        generationInstructions,
        status: 'invalid_output',
        packet: null,
        diagnostics: ['The final reply still contains pending tool calls.'],
      };
    }
  }

  if (
    generationInstructions !== null &&
    finalInstructions !== null &&
    generationInstructions !== finalInstructions
  ) {
    throw new parse.EvaluationError(
      'Saved generation instructions disagree between the final response copies.',
    );
  }

  const savedInstructions = generationInstructions ?? finalInstructions;
  const validation = validateIntentions(proposalText, { ...evidence, pr });

  if (validation.status === 'invalid') {
    return {
      artifactHash,
      generationInstructions: savedInstructions,
      status: 'invalid_output',
      packet: null,
      diagnostics: validation.diagnostics,
    };
  }

  /* Saved cards contain resolved source text; compare them with fresh resolution of the raw final reply. */
  if (
    !isDeepStrictEqual(artifact.proposal, validation.proposal) ||
    !isDeepStrictEqual(investigation.proposal, validation.proposal)
  ) {
    throw new parse.EvaluationError(
      'The accepted proposal disagrees with the freshly validated final reply.',
    );
  }

  return {
    artifactHash,
    diagnostics: [],
    generationInstructions: savedInstructions,
    status: 'complete',
    packet: {
      identity: evidence.identity,
      metadata: { title: pr.title, body: pr.body },
      changes: evidence.changes,
      hunks: evidence.hunks,
      sources: evidence.sources,
      limitations: [
        ...parseNotices(artifact.limitations, 'artifact.limitations'),
        ...parseNotices(investigation.limitations, 'investigation.limitations'),
      ],
      proposal: validation.proposal,
    },
  };
}

/*
 * Reads one local v1 run without repository or model calls. For example,
 * loadIntentionArtifact('outputs/intentions/run.json') returns a judge packet
 * only after revalidating source provenance and the final proposal. Malformed
 * or oversized input throws; failed runs and invalid output remain explicit
 * report outcomes. The file and retained evidence have fixed host-side caps.
 */
export async function loadIntentionArtifact(
  path: string,
): Promise<PreparedIntentionArtifact> {
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

  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new parse.EvaluationError(
      'The intentions artifact is not valid UTF-8 JSON.',
      { cause: error },
    );
  }

  return decodeArtifact(value, parse.sha256(bytes));
}

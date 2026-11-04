import { parseDiffEvidence } from '../diff-evidence.js';
import type { FrozenSplitEvidence } from './contracts.js';
import * as parse from '../parse.js';

/* Extend the shared original diff with split-specific model text and pinned acquisition coordinates. */
export function parseSplitEvidence(value: unknown): FrozenSplitEvidence {
  const input = parse.object(value, 'evidence');
  const diff = parseDiffEvidence(input);
  const session = diff.identity;
  const metadata = parse.object(input.pr, 'evidence.pr');
  const pr = {
    url: parse.text(metadata.url, 'pr.url'),
    title: parse.text(metadata.title, 'pr.title', true),
    body:
      metadata.body === null
        ? null
        : parse.text(metadata.body, 'pr.body', true),
  };
  const acquisition = parse.object(input.source, 'evidence.source');
  const acquisitionSource = {
    targetRepositoryUrl: parse.text(
      acquisition.targetRepositoryUrl,
      'source.targetRepositoryUrl',
    ),
    headRepositoryUrl: parse.text(
      acquisition.headRepositoryUrl,
      'source.headRepositoryUrl',
    ),
    targetCommit: parse.text(acquisition.targetCommit, 'source.targetCommit'),
    headCommit: parse.text(acquisition.headCommit, 'source.headCommit'),
  };

  if (
    acquisitionSource.targetRepositoryUrl !== session.repositoryUrl ||
    acquisitionSource.targetCommit !== session.targetCommit ||
    acquisitionSource.headCommit !== session.headCommit
  ) {
    throw new parse.EvaluationError(
      'Acquisition coordinates disagree with the frozen comparison.',
    );
  }

  return { pr, source: acquisitionSource, ...diff };
}

/* Normalize only the ephemeral session; commits, order, paths and source bytes remain exact. */
export function rebindSplitEvidence(
  evidence: FrozenSplitEvidence,
  sessionId: string,
): FrozenSplitEvidence {
  return {
    ...evidence,
    identity: { ...evidence.identity, sessionId },
    hunks: evidence.hunks.map((hunk) => ({
      ...hunk,
      sources: hunk.sources.map((source) => ({
        ...source,
        ref: { ...source.ref, sessionId },
      })),
    })),
  };
}

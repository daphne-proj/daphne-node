import { isDeepStrictEqual } from 'node:util';
import {
  createContextEngine,
  ContextLimitError,
  validateDiffInput,
  retainDiff,
  validateAndCopySnapshot,
} from '@daphne/context-engine';
import type {
  DiffHunkEvidence,
  EvidenceSnapshot,
} from '@daphne/context-engine';
import { splitLimits } from '@daphne/semantic-split';
import { parseSplitEvidence } from './evidence.js';
import { parseSplitTrace } from './artifact-trace.js';
import { toSemanticSplitInput } from './trial.js';
import { parseRunBudget } from '../run-budget.js';
import * as parse from '../parse.js';

/*
 * Read the current CLI/frozen-run artifact for capture, scoring and upload.
 * Original evidence is validated independently; a valid top-level proposal cannot
 * conceal a failed investigation, another comparison or a different terminal reply.
 */
export function parseSplitArtifact(value: unknown) {
  const input = parse.object(value, 'artifact');
  const metadata = parse.object(input.metadata, 'metadata');
  const ref = parse.object(metadata.ref, 'metadata.ref');
  const evidence = parseSplitEvidence({
    pr: { url: ref.url, title: metadata.title, body: metadata.body },
    source: {
      targetRepositoryUrl: metadata.targetRepositoryUrl,
      headRepositoryUrl: metadata.headRepositoryUrl,
      targetCommit: metadata.targetCommit,
      headCommit: metadata.headCommit,
    },
    identity: input.identity,
    changes: input.changes,
    hunks: input.hunks,
  });
  const provider = parse.choice(
    input.provider,
    ['openai', 'anthropic', 'codex'],
    'provider',
  );
  const model = parse.text(input.model, 'model');
  const maxInputTokens = parse.integer(input.maxInputTokens, 'maxInputTokens');
  const reasoningEffort =
    input.reasoningEffort === null
      ? null
      : parse.choice(
          input.reasoningEffort,
          ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
          'reasoningEffort',
        );
  const budget = parseRunBudget(input.budget);
  const investigation = parse.object(input.investigation, 'investigation');
  const comparison =
    investigation.comparison === null
      ? null
      : parse.object(investigation.comparison, 'comparison');
  const expectedComparison = {
    identity: evidence.identity,
    pr: evidence.pr,
    changes: evidence.changes,
  };

  if (
    input.pr !== evidence.pr.url ||
    maxInputTokens < 1 ||
    (provider === 'anthropic' && reasoningEffort !== null) ||
    (comparison === null
      ? input.status !== 'failed'
      : !isDeepStrictEqual(comparison, expectedComparison)) ||
    !isDeepStrictEqual(budget, parseRunBudget(investigation.budget)) ||
    input.status !== investigation.status ||
    !isDeepStrictEqual(input.proposal, investigation.proposal) ||
    !isDeepStrictEqual(input.response, investigation.response)
  ) {
    throw new parse.EvaluationError(
      'Artifact configuration, comparison or accepted output copies disagree.',
    );
  }

  const engine = createContextEngine(evidence.identity, {
    maxContextBytes: splitLimits.maxContextBytes,
    maxRetainedBytes: splitLimits.maxRetainedBytes,
  });
  const mappings: DiffHunkEvidence[] = [];
  const original = toSemanticSplitInput(evidence);
  validateDiffInput(original);
  let originalComplete = true;

  try {
    retainDiff(original, engine, mappings);
  } catch (error) {
    if (input.status !== 'failed' || !(error instanceof ContextLimitError)) {
      throw error;
    }

    originalComplete = false;
  }

  const retainedMappings = parse.array(
    investigation.hunks,
    'investigation.hunks',
  );
  const turns = parse.array(investigation.turns, 'investigation.turns');
  const tools = parse.array(investigation.tools, 'investigation.tools');
  const retainedComplete =
    originalComplete && retainedMappings.length === mappings.length;
  let snapshot: EvidenceSnapshot | null = null;

  if (investigation.evidence !== null) {
    snapshot = validateAndCopySnapshot(
      investigation.evidence,
      splitLimits.maxRetainedBytes,
    );
    if (
      comparison === null ||
      !isDeepStrictEqual(snapshot.identity, evidence.identity) ||
      !isDeepStrictEqual(
        retainedMappings,
        mappings.slice(0, retainedMappings.length),
      )
    ) {
      throw new parse.EvaluationError(
        'Investigation identity or original hunk mappings disagree.',
      );
    }

    const sources = new Map(
      snapshot.sources.map((source) => [source.evidenceId, source.source]),
    );
    const originalSources = engine.getEvidenceSnapshot().sources;

    if (retainedComplete) {
      if (
        originalSources.some(
          (source) =>
            !isDeepStrictEqual(source.source, sources.get(source.evidenceId)),
        )
      ) {
        throw new parse.EvaluationError(
          'Investigation is missing original source bytes.',
        );
      }
    } else {
      // Retention failed before model work, so only an original source prefix is available.
      const expectedSources = new Map(
        originalSources.map((source) => [source.evidenceId, source.source]),
      );
      const mappedIds = mappings
        .slice(0, retainedMappings.length)
        .flatMap((mapping) => mapping.evidenceIds);

      if (
        snapshot.queries.length > 0 ||
        snapshot.sources.some(
          (source) =>
            !isDeepStrictEqual(
              source.source,
              expectedSources.get(source.evidenceId),
            ),
        ) ||
        mappedIds.some((id) => !sources.has(id))
      ) {
        throw new parse.EvaluationError(
          'Partially retained input contains foreign or missing original sources.',
        );
      }
    }
  } else if (
    retainedMappings.length > 0 ||
    turns.length > 0 ||
    tools.length > 0
  ) {
    throw new parse.EvaluationError('Retained activity requires evidence.');
  }

  if (
    (input.status === 'complete' || turns.length > 0 || tools.length > 0) &&
    (!retainedComplete || snapshot === null)
  ) {
    throw new parse.EvaluationError(
      'Model activity requires the complete original diff.',
    );
  }

  const result = parseSplitTrace(
    investigation,
    evidence.changes,
    provider,
    snapshot,
  );
  const calls = parse.object(investigation.calls, 'calls');

  return {
    input,
    evidence,
    originalComplete,
    result,
    provider,
    model,
    maxInputTokens,
    reasoningEffort,
    budget,
    calls: {
      count: parse.integer(calls.count, 'calls.count'),
      generate: parse.integer(calls.generate, 'calls.generate'),
      tools: parse.integer(calls.tools, 'calls.tools'),
    },
  };
}

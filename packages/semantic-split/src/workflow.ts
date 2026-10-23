import {
  ContextInputError,
  defaultContextLimits,
  paginateDiffContext,
} from '@daphne/context-engine';
import type { DiffContextHunk, DiffContextPage } from '@daphne/context-engine';
import type { Change, ReviewIdentity } from '@daphne/review-evidence/contracts';
import { createOpenAI, ModelError } from '@daphne/review-agent';
import type { ModelReply, ModelRequest } from '@daphne/review-agent';
import {
  correctionInstructions,
  groupingInstructions,
  pageInstructions,
} from './prompts.js';
import { getExpectedUnitIds, validateProposal } from './proposal.js';
import type { Proposal, ProposalValidation } from './proposal.js';
import { proposalSchema } from './schema.js';

export const maxCorrections = 3;

export interface PageAnalysis extends DiffContextPage {
  analysis: Pick<ModelReply, 'text' | 'response'> | null;
}

export interface SplitAttempt {
  number: number;
  inputTokens: number;
  text: string;
  response: Record<string, unknown>;
  validation: ProposalValidation;
}

export interface SemanticSplitInput {
  identity: ReviewIdentity;
  changes: readonly Change[];
  hunks: readonly DiffContextHunk[];
}

export interface SemanticSplitOptions {
  apiKey: string;
  model: string;
  maxInputTokens: number;
  signal: AbortSignal;
  onPage?: (page: DiffContextPage, pageNumber: number) => void;
}

interface SplitProgress {
  maxCorrections: typeof maxCorrections;
  pages: PageAnalysis[];
  attempts: SplitAttempt[];
  calls: { count: number; generate: number };
}

export type SemanticSplitResult = SplitProgress &
  (
    | {
        status: 'complete';
        proposal: Proposal;
        response: Record<string, unknown> | null;
      }
    | { status: 'failed'; proposal: null; response: null; error: unknown }
  );

function groupingRequest(
  input: readonly Record<string, unknown>[],
): ModelRequest {
  return {
    instructions: groupingInstructions,
    input,
    text: {
      format: {
        type: 'json_schema',
        name: 'split_proposal',
        strict: true,
        schema: proposalSchema,
      },
    },
  };
}

async function proposeGroups(
  expectedUnitIds: ReadonlySet<string>,
  pages: PageAnalysis[],
  model: ReturnType<typeof createOpenAI>,
  maxInputTokens: number,
  attempts: SplitAttempt[],
) {
  const pageUnitIds = new Set(pages.flatMap((page) => page.unitIds));
  const missingIds = [...expectedUnitIds].filter((id) => !pageUnitIds.has(id));
  const unknownIds = [...pageUnitIds].filter((id) => !expectedUnitIds.has(id));

  if (missingIds.length > 0 || unknownIds.length > 0) {
    throw new ContextInputError(
      `Diff pages do not match the Git inventory: ${JSON.stringify({ missingIds, unknownIds })}`,
    );
  }

  if (expectedUnitIds.size === 0) {
    if (pages.length > 0) {
      throw new ContextInputError(
        'An empty Git inventory requires no diff pages.',
      );
    }

    return { proposal: { groups: [], warnings: [] }, response: null };
  }

  const [onlyPage] = pages;
  const history: Record<string, unknown>[] = [];
  const suppliedPageIndexes = new Set<number>();

  if (pages.length === 1 && onlyPage) {
    history.push({ role: 'user', content: onlyPage.context });
    suppliedPageIndexes.add(0);
  } else {
    const notes = [];

    for (const page of pages) {
      const analysisRequest = {
        instructions: pageInstructions,
        input: page.context,
      };
      const inputTokens = await model.count(analysisRequest);

      if (inputTokens > maxInputTokens) {
        throw new ModelError('The page analysis exceeds --max-input-tokens.');
      }

      const { text, response } = await model.generate(analysisRequest);

      page.analysis = { text, response };
      notes.push({ unitIds: page.unitIds, notes: text });
    }

    /* shortcut: final notes must fit one request; add hierarchical grouping only when needed. */
    history.push({ role: 'user', content: JSON.stringify(notes) });
  }

  for (let number = 1; number <= maxCorrections + 1; number++) {
    const request = groupingRequest(history);

    if (
      Buffer.byteLength(JSON.stringify(request.input)) >
      defaultContextLimits.maxContextBytes
    ) {
      throw new ModelError(
        'The serialized grouping conversation exceeds the byte budget, including prior replies, message wrappers and JSON escaping.',
      );
    }

    /* Only the first single-page request is identical to the pager's count. */
    const inputTokens =
      number === 1 && pages.length === 1 && onlyPage
        ? onlyPage.inputTokens
        : await model.count(request);

    if (inputTokens > maxInputTokens) {
      throw new ModelError(
        'The grouping conversation exceeds --max-input-tokens.',
      );
    }

    const reply = await model.generate(request);
    const validation = validateProposal(reply.text, expectedUnitIds);

    /* Save the completed draft before a later count or generation can fail. */
    attempts.push({
      number,
      inputTokens,
      text: reply.text,
      response: reply.response,
      validation,
    });

    if (validation.status === 'valid') {
      return { proposal: validation.proposal, response: reply.response };
    }

    if (number === maxCorrections + 1) {
      break;
    }

    const evidence: {
      pageIndex: number;
      unitIds: readonly string[];
      context: string;
    }[] = [];

    if (validation.status === 'invalid_coverage') {
      const neededIds = new Set(
        [...validation.missingIds, ...validation.duplicateIds].filter((id) =>
          expectedUnitIds.has(id),
        ),
      );

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

    history.push(...reply.output);

    history.push({
      role: 'user',
      content: JSON.stringify({
        instruction: correctionInstructions,
        validation,
        pages: evidence,
      }),
    });
  }

  throw new ModelError(
    `The split proposal remained invalid after ${String(maxCorrections)} corrections (${String(maxCorrections + 1)} grouping generations); see attempts for validation details.`,
  );
}

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelError('The semantic split was cancelled.');
  }
}

/* Return completed work on failure so every host can retain the same diagnostics. */
export async function runSemanticSplit(
  input: SemanticSplitInput,
  options: SemanticSplitOptions,
): Promise<SemanticSplitResult> {
  const { apiKey, model: modelName, maxInputTokens, signal, onPage } = options;
  const model = createOpenAI(apiKey, modelName, signal);
  const progress: SplitProgress = {
    maxCorrections,
    pages: [],
    attempts: [],
    calls: model.calls,
  };

  try {
    checkCancellation(signal);
    const expectedUnitIds = getExpectedUnitIds(input.changes);

    for await (const page of paginateDiffContext({
      identity: input.identity,
      hunks: input.hunks,
      tokens: {
        counterId: 'openai-responses',
        maxTokens: maxInputTokens,
        countTokens: (context) =>
          model.count(groupingRequest([{ role: 'user', content: context }])),
      },
    })) {
      progress.pages.push({ ...page, analysis: null });
      onPage?.(page, progress.pages.length);
      checkCancellation(signal);
    }

    const result = await proposeGroups(
      expectedUnitIds,
      progress.pages,
      model,
      maxInputTokens,
      progress.attempts,
    );

    checkCancellation(signal);

    return { ...progress, status: 'complete', ...result };
  } catch (error) {
    return {
      ...progress,
      status: 'failed',
      proposal: null,
      response: null,
      error,
    };
  }
}

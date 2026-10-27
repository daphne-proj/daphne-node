import {
  ContextInputError,
  defaultContextLimits,
  splitDiffIntoContextPages,
} from '@daphne/context-engine';
import { createOpenAI, ModelError } from '@daphne/review-agent';
import type { ModelRequest } from '@daphne/review-agent';
import type {
  PageAnalysis,
  SemanticSplitInput,
  SemanticSplitOptions,
  SemanticSplitResult,
  SplitAttempt,
} from './contracts.js';
import {
  correctionInstructions,
  groupingInstructions,
  pageInstructions,
} from './prompts.js';
import { getExpectedUnitIds, validateProposal } from './proposal.js';
import { proposalSchema } from './schema.js';

export const maxCorrections: SemanticSplitResult['maxCorrections'] = 3;

type SplitProgress = Pick<
  SemanticSplitResult,
  'maxCorrections' | 'pages' | 'attempts' | 'calls'
>;

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

/*
 * Group expected units and retain completed drafts in attempts.
 * Example inputs: IDs {'change-1:0'}, one page containing that hunk,
 * an OpenAI adapter, a 4,000-token limit, and an empty attempts array.
 */
async function proposeGroups(
  expectedUnitIds: ReadonlySet<string>,
  pages: PageAnalysis[],
  model: ReturnType<typeof createOpenAI>,
  maxInputTokens: number,
  attempts: SplitAttempt[],
) {
  /* Changes and hunks are separate inputs;
  check that the pages built from hunks match the change inventory. */
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

    /*
     * Summarize each page so the final grouping request can consider all
     * changes together within the token budget.
     */
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

    /*
     * For one page, the pager counted the same instructions, schema and page text
     * used by the first grouping request, so reuse that count.
     * Page summaries and correction history change the request and need a new count.
     */
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

    /*
     * Record this reply and its validation now so the caller can inspect them
     * even if counting tokens or generating the next reply fails.
     */
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

    /*
     * Summaries may omit details needed to place missing or duplicated IDs in
     * the right groups. Supply their original page text to help the correction.
     */
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
  const model = createOpenAI(apiKey, modelName, signal, options.onModelCall);
  const progress: SplitProgress = {
    maxCorrections,
    pages: [],
    attempts: [],
    calls: model.calls,
  };

  try {
    checkCancellation(signal);
    const expectedUnitIds = getExpectedUnitIds(input.changes);

    for await (const page of splitDiffIntoContextPages({
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

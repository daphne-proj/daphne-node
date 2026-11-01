import {
  ContextInputError,
  defaultContextLimits,
  splitDiffIntoContextPages,
} from '@daphne/context-engine';
import { createOpenAI, ModelError } from '@daphne/llm';
import type { ModelReply, ModelRequest } from '@daphne/llm';
import { runEvaluatorOptimizer } from '@daphne/evaluator-optimizer';
import type { RunBudget } from '@daphne/evaluator-optimizer';
import type {
  PageAnalysis,
  SemanticSplitInput,
  SemanticSplitOptions,
  SemanticSplitResult,
  SplitAttempt,
} from './contracts.js';
import { groupingInstructions, pageInstructions } from './prompts.js';
import { getExpectedUnitIds, validateProposal } from './proposal.js';
import { proposalSchema } from './schema.js';
import type { Proposal, ProposalValidation } from './proposal.js';
import { correctionMessage } from './correction.js';

/* Keep the successful reply and its structural validation together, including after cancellation. */
interface SplitCandidate {
  reply: ModelReply;
  inputTokens: number;
  validation: ProposalValidation;
}

type SplitProgress = Pick<
  SemanticSplitResult,
  'budget' | 'pages' | 'attempts' | 'calls'
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

/* Use the shared runner for grouping while keeping analyses outside the candidate count. */
async function proposeGroups(
  expectedUnitIds: ReadonlySet<string>,
  pages: PageAnalysis[],
  model: ReturnType<typeof createOpenAI>,
  maxInputTokens: number,
  attempts: SplitAttempt[],
  budget: RunBudget,
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
      checkCancellation(budget.signal);

      const analysisRequest = {
        instructions: pageInstructions,
        input: page.context,
      };
      const inputTokens = await model.count(analysisRequest);

      if (inputTokens > maxInputTokens) {
        throw new ModelError('The page analysis exceeds --max-input-tokens.');
      }

      checkCancellation(budget.signal);

      const { text, response } = await model.generate(analysisRequest);

      page.analysis = { text, response };
      checkCancellation(budget.signal);
      notes.push({ unitIds: page.unitIds, notes: text });
    }

    /* shortcut: final notes must fit one request; add hierarchical grouping only when needed. */
    history.push({ role: 'user', content: JSON.stringify(notes) });
  }

  const result = await runEvaluatorOptimizer<
    SplitCandidate,
    Exclude<ProposalValidation, { status: 'valid' }>,
    { proposal: Proposal; response: Record<string, unknown> }
  >({
    budget,
    async produce(production) {
      if (production.kind === 'revision') {
        history.push(...production.previous.reply.output);
        history.push(
          correctionMessage(production.feedback, pages, suppliedPageIndexes),
        );
      }

      const request = groupingRequest(history);

      if (
        Buffer.byteLength(JSON.stringify(request.input)) >
        defaultContextLimits.maxContextBytes
      ) {
        throw new ModelError(
          'The serialized grouping conversation exceeds the byte budget, including prior replies, message wrappers and JSON escaping.',
        );
      }

      /* Only the initial single-page request is identical to the request counted by the pager. */
      const inputTokens =
        production.kind === 'initial' && pages.length === 1 && onlyPage
          ? onlyPage.inputTokens
          : await model.count(request);

      if (inputTokens > maxInputTokens) {
        throw new ModelError(
          'The grouping conversation exceeds --max-input-tokens.',
        );
      }

      checkCancellation(budget.signal);

      const reply = await model.generate(request);
      const validation = validateProposal(reply.text, expectedUnitIds);

      return { reply, inputTokens, validation };
    },
    evaluate({ reply, validation }) {
      if (validation.status === 'valid') {
        return {
          status: 'accept',
          value: { proposal: validation.proposal, response: reply.response },
        };
      }

      return { status: 'revise', feedback: validation };
    },
  });

  for (const { number, candidate } of result.attempts) {
    attempts.push({
      number,
      inputTokens: candidate.inputTokens,
      text: candidate.reply.text,
      response: candidate.reply.response,
      validation: candidate.validation,
    });
  }

  switch (result.status) {
    case 'accepted':
      return result.value;
    case 'failed':
      throw result.error;
    case 'cancelled':
      throw result.cause === null ? result.reason : result.cause;
    case 'stopped':
      throw new ModelError(`The split proposal stopped: ${result.reason}`);
    case 'exhausted':
      throw new ModelError(
        `The split proposal remained invalid after ${String(result.attempts.length)} candidates; the configured run ceiling was reached. See attempts for validation details.`,
      );
  }
}

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelError('The semantic split was cancelled.', {
      cause: signal.reason,
    });
  }
}

/* Return completed work on failure so every host can retain the same diagnostics. */
export async function runSemanticSplit(
  input: SemanticSplitInput,
  options: SemanticSplitOptions,
): Promise<SemanticSplitResult> {
  const { apiKey, model: modelName, maxInputTokens, budget, onPage } = options;
  const { signal, maxCandidates, deadlineAt } = budget;

  const model = createOpenAI(apiKey, modelName, signal, options.onModelCall);

  const progress: SplitProgress = {
    budget: { maxCandidates, deadlineAt },
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
      budget,
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

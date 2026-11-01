import { setImmediate } from 'node:timers/promises';
import type {
  Attempt,
  EvaluatorOptimizerOptions,
  EvaluatorOptimizerResult,
  IterationContext,
  Production,
} from './contracts.js';

/* Retain completed callbacks before cancellation checks; only an evaluated candidate can succeed. */
export async function runEvaluatorOptimizer<Candidate, Feedback, Accepted>(
  options: EvaluatorOptimizerOptions<Candidate, Feedback, Accepted>,
): Promise<EvaluatorOptimizerResult<Candidate, Feedback, Accepted>> {
  const { budget, produce, evaluate } = options;

  const attempts: Attempt<Candidate, Feedback, Accepted>[] = [];
  const isCancelled = () => budget.signal.aborted;
  let request: Production<Candidate, Feedback> = { kind: 'initial' };

  const cancelled = (
    cause: unknown,
  ): EvaluatorOptimizerResult<Candidate, Feedback, Accepted> => ({
    status: 'cancelled',
    reason: budget.signal.reason,
    cause,
    attempts,
  });

  for (;;) {
    if (isCancelled()) {
      return cancelled(null);
    }

    const context: IterationContext = { number: attempts.length + 1, budget };
    let stage: 'produce' | 'evaluate' = 'produce';

    try {
      const candidate = await produce(request, context);
      attempts.push({ number: context.number, candidate, evaluation: null });

      if (isCancelled()) {
        return cancelled(null);
      }

      stage = 'evaluate';

      const evaluation = await evaluate(candidate, context);
      attempts[context.number - 1] = {
        number: context.number,
        candidate,
        evaluation,
      };

      if (isCancelled()) {
        return cancelled(null);
      }

      switch (evaluation.status) {
        case 'accept':
          return { status: 'accepted', value: evaluation.value, attempts };
        case 'stop':
          return { status: 'stopped', reason: evaluation.reason, attempts };
        case 'revise':
          if (
            budget.maxCandidates !== null &&
            attempts.length >= budget.maxCandidates
          ) {
            return { status: 'exhausted', attempts };
          }

          request = {
            kind: 'revision',
            previous: candidate,
            feedback: evaluation.feedback,
          };
      }
    } catch (error) {
      if (isCancelled()) {
        return cancelled(error);
      }

      return { status: 'failed', stage, error, attempts };
    }

    /*
     * Yield to the event loop between iterations to allow timers (including timeout-based
     * cancellation) and I/O to run. If produce/evaluate resolve immediately, their await
     * continuations run as microtasks, potentially starving the event loop and preventing
     * cancellation timers from firing.
     *
     * See: https://nodejs.org/learn/asynchronous-work/event-loop-timers-and-nexttick
     */
    await setImmediate();
  }
}

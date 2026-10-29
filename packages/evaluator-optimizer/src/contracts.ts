/* Hosts select optional limits once; an empty policy imposes neither ceiling. */
export interface RunBudgetPolicy {
  maxCandidates?: number;
  timeoutMs?: number;
}

/* Share one resolved budget across preparation, callbacks and publication. */
export interface RunBudget {
  readonly signal: AbortSignal;
  readonly maxCandidates: number | null;
  readonly deadlineAt: number | null;
}

/* Persist the resolved candidate limit and deadline without serializing a signal. */
export type RunBudgetSnapshot = Omit<RunBudget, 'signal'>;

/* Revisions receive only the preceding candidate and its evaluator's feedback. */
export type Production<Candidate, Feedback> =
  | { readonly kind: 'initial' }
  | {
      readonly kind: 'revision';
      readonly previous: Candidate;
      readonly feedback: Feedback;
    };

/* Both callbacks for candidate 1 receive number 1 and the host's exact budget. */
export interface IterationContext {
  readonly number: number;
  readonly budget: RunBudget;
}

/* Only accept supplies a publishable value; revise requests a complete replacement. */
export type Evaluation<Accepted, Feedback> =
  | { readonly status: 'accept'; readonly value: Accepted }
  | { readonly status: 'revise'; readonly feedback: Feedback }
  | { readonly status: 'stop'; readonly reason: string };

/* Retain completed candidates even when evaluation throws or cancellation skips it. */
export interface Attempt<Candidate, Feedback, Accepted> {
  readonly number: number;
  readonly candidate: Candidate;
  readonly evaluation: Evaluation<Accepted, Feedback> | null;
}

/* Callbacks own domain validation and I/O; honor budget.signal and keep prior values stable. */
export interface EvaluatorOptimizerOptions<Candidate, Feedback, Accepted> {
  budget: RunBudget;

  /* The evaluator–optimizer pattern's producer creates a candidate or replaces it using evaluator feedback. */
  produce: (
    request: Production<Candidate, Feedback>,
    context: IterationContext,
  ) => Candidate | Promise<Candidate>;

  /* The evaluator–optimizer pattern's evaluator applies workflow criteria to accept, request revision or stop. */
  evaluate: (
    candidate: Candidate,
    context: IterationContext,
  ) => Evaluation<Accepted, Feedback> | Promise<Evaluation<Accepted, Feedback>>;
}

/* Cancellation takes precedence over acceptance and keeps any original callback cause. */
export type EvaluatorOptimizerResult<Candidate, Feedback, Accepted> = {
  readonly attempts: readonly Attempt<Candidate, Feedback, Accepted>[];
} & (
  | { readonly status: 'accepted'; readonly value: Accepted }
  | { readonly status: 'exhausted' }
  | { readonly status: 'stopped'; readonly reason: string }
  | {
      readonly status: 'failed';
      readonly stage: 'produce' | 'evaluate';
      readonly error: unknown;
    }
  | {
      readonly status: 'cancelled';
      readonly reason: unknown;
      readonly cause: unknown;
    }
);

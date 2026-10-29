# Evaluator–optimizer

`@daphne/evaluator-optimizer` runs a produce–evaluate–revise loop with one shared run budget. It owns callback ordering, cancellation and completed-attempt retention. Workflows own candidates, acceptance criteria, feedback, model/tool calls and longer conversation history. Semantic split and intentions will adopt it in later implementation steps; their current behavior is unchanged.

The package has no runtime dependencies. It uses Node's `AbortSignal.timeout` and `AbortSignal.any` for cancellation and a standard timer yield between revisions so synchronous callbacks cannot starve cancellation events. It does not load environment variables, fetch evidence, interpret schemas, record telemetry or publish artifacts.

## Main flow

The host calls `createRunBudget(policy, signal)` **once before preparation**, then passes that same budget through preparation, `runEvaluatorOptimizer` and publication. `RunBudgetPolicy` accepts optional `maxCandidates` and `timeoutMs`. Both must be positive safe integers; timeout is limited to Node's maximum timer delay, 2,147,483,647 milliseconds. Invalid values throw `RangeError` before any timer is created. There are no numeric defaults or per-operation quotas.

The resolved `RunBudget` is frozen and copies the policy values. Missing limits become `null`; `deadlineAt` uses epoch milliseconds. The signal preserves caller cancellation and, when configured, the original deadline. Stages must not recreate the budget. `RunBudgetSnapshot` is the serializable subset excluding `signal`, for host-owned artifacts.

`runEvaluatorOptimizer` calls `produce` with an initial request, then `evaluate` with that exact candidate. Both receive the same `IterationContext`, containing a one-based candidate number and the host's budget. Evaluation may accept a separate validated value, request a replacement with feedback, or stop with a reason. A revision receives only the previous candidate and feedback. Every completed candidate is evaluated before candidate exhaustion, including the last candidate allowed by a ceiling.

```ts
import {
  createRunBudget,
  runEvaluatorOptimizer,
} from '@daphne/evaluator-optimizer';

const controller = new AbortController();
const budget = createRunBudget({}, controller.signal);

const result = await runEvaluatorOptimizer<number, number, string>({
  budget,
  produce(request) {
    if (request.kind === 'initial') {
      return 1;
    }

    return request.previous + request.feedback;
  },
  evaluate(candidate) {
    if (candidate < 2) {
      return { status: 'revise', feedback: 1 };
    }

    return { status: 'accept', value: String(candidate) };
  },
});
```

## Results and ownership

`EvaluatorOptimizerResult` contains readonly attempts on every outcome:

| Status      | Meaning                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------ |
| `accepted`  | `value` came from the accepting evaluation of the final candidate.                         |
| `exhausted` | The last allowed candidate was evaluated and still needs revision.                         |
| `stopped`   | The evaluator returned an explicit unresolved `reason`.                                    |
| `failed`    | A callback threw; `stage` identifies it and `error` preserves the original thrown value.   |
| `cancelled` | The budget signal aborted; `reason` is its reason and `cause` is a callback throw or null. |

A returned candidate is retained immediately. Its evaluation stays `null` if evaluation throws or cancellation prevents evaluation. A returned evaluation is also retained before checking cancellation. Cancellation takes precedence over acceptance, even when an accepting evaluation has completed. A throwing producer adds no candidate; workflows must retain partial replies and tool activity themselves.

Candidates, feedback, evaluations and accepted values retain their original identities. The runner does not clone or freeze arbitrary generic values; callers must keep earlier values stable. Readonly result types protect history at compile time, not against JavaScript mutation.

Callbacks performing I/O must pass `context.budget.signal` to it. Cancellation is cooperative: the runner waits for callbacks to settle and cannot interrupt synchronous work or a promise that ignores its signal. An unlimited run continues until acceptance, explicit stop, callback failure or cancellation. Native deadline timers do not keep an otherwise idle Node process alive.

See [ADR 0006](../../docs/adr/0006-evaluator-optimizer.md) for ownership and integration decisions. Build and typecheck with the workspace scripts; `bun run check` runs the existing repository checks. Focused automated runner/budget tests are deferred at the user's request.

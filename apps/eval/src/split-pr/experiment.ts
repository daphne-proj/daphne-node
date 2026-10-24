import { join } from 'node:path';
import { context, trace } from '@opentelemetry/api';
import { startObservation } from '@langfuse/tracing';
import type { Evaluation, LangfuseClient } from '@langfuse/client';
import { runSemanticSplit } from '@daphne/semantic-split';
import type { SemanticSplitOptions } from '@daphne/semantic-split';
import {
  collectExperimentIssues,
  getExperimentCaseId,
} from '../../tests/smoke/experiment-completeness.js';
import type {
  PreparedSplitCase,
  SplitRunManifest,
  SplitTrial,
} from './contracts.js';
import { object } from './parse.js';
import { writeJsonArtifact } from './report.js';
import { scoreSplitTrial } from './score.js';
import {
  collectModelCallIssues,
  createModelCallRecorder,
} from './telemetry.js';
import {
  toSemanticSplitInput,
  toSplitExperimentOutput,
  toSplitTrial,
} from './trial.js';

async function observeSplit(
  caseData: PreparedSplitCase,
  options: SemanticSplitOptions,
  issues: string[],
) {
  let span: ReturnType<typeof startObservation> | undefined;
  const input = toSemanticSplitInput(caseData.definition.evidence);

  try {
    span = startObservation('semantic-split');
  } catch {
    issues.push('Could not start the workflow observation.');
  }

  const active = span
    ? trace.setSpan(context.active(), span.otelSpan)
    : context.active();
  const result = await context.with(active, () =>
    runSemanticSplit(input, options),
  );

  try {
    if (result.status === 'failed') {
      span?.update({ level: 'ERROR', statusMessage: 'Semantic split failed.' });
    }

    span?.end();
  } catch {
    issues.push('Could not finish the workflow observation.');
  }

  return result;
}

const itemScoreNames = [
  'completed',
  'accepted',
  'constraints_passed',
  'together_rate',
  'separate_rate',
  'corrections',
  'count_calls',
  'generate_calls',
];

/* One SDK invocation per trial keeps repetition separate from case concurrency. */
export async function runSplitExperiment(
  client: LangfuseClient,
  cases: PreparedSplitCase[],
  manifest: SplitRunManifest,
  trialNumber: number,
  outputDirectory: string,
  apiKey: string,
  signal: AbortSignal,
): Promise<void> {
  const trials = new Map<string, SplitTrial>();
  const entries = manifest.cases.filter(
    (entry) => entry.trialNumber === trialNumber,
  );
  const experiment: SplitRunManifest['experiments'][number] = {
    trialNumber,
    id: null,
    url: null,
    issues: [],
  };
  manifest.experiments.push(experiment);

  function resolveCase(input: unknown) {
    const id = getExperimentCaseId(input);
    const index = cases.findIndex(({ definition }) => definition.id === id);
    const caseData = cases[index];
    const entry = entries[index];

    if (
      !caseData ||
      !entry ||
      object(input, 'experiment.input').inputHash !== caseData.inputHash
    ) {
      throw new Error('Experiment case identity mismatch.');
    }

    return { caseData, entry, index };
  }

  try {
    const result = await client.experiment.run({
      name: 'daphne-split-pr',
      runName: `${manifest.suiteId}-${manifest.startedAt}-trial-${String(trialNumber)}`,
      maxConcurrency: manifest.concurrency,
      metadata: {
        suiteId: manifest.suiteId,
        datasetHash: manifest.datasetHash,
        partition: manifest.partition,
        trialNumber,
        scorerVersion: manifest.scorerVersion,
        promptHash: manifest.promptHash,
        sdkVersion: manifest.sdkVersion,
        git: manifest.git,
        modelConfig: manifest.modelConfig,
      },
      data: cases.map(({ definition, inputHash, caseHash }) => ({
        input: {
          caseId: definition.id,
          inputHash,
          evidence: definition.evidence,
        },
        expectedOutput: definition.labels,
        metadata: { caseId: definition.id, inputHash, caseHash },
      })),
      task: async (item) => {
        const { caseData, entry, index } = resolveCase(item.input);

        try {
          signal.throwIfAborted();

          if (trials.has(caseData.definition.id)) {
            throw new Error('Duplicate experiment task.');
          }

          const recorder = createModelCallRecorder();
          const started = performance.now();
          const result = await observeSplit(
            caseData,
            {
              apiKey,
              ...manifest.modelConfig,
              signal,
              onModelCall: recorder.onModelCall,
            },
            entry.issues,
          );
          const trial = toSplitTrial(
            caseData,
            result,
            { trialNumber, elapsedMs: performance.now() - started },
            manifest.modelConfig,
            recorder.calls,
          );
          trials.set(caseData.definition.id, trial);
          entry.issues.push(
            ...recorder.issues,
            ...collectModelCallIssues(recorder.calls, result.calls),
          );

          const filename = `trial-${String(trialNumber)}-case-${String(index + 1)}.json`;
          await writeJsonArtifact(join(outputDirectory, filename), trial);
          entry.trialFile = filename;
          return toSplitExperimentOutput(trial);
        } catch {
          const message = signal.aborted
            ? 'Task cancelled.'
            : 'Task execution or trial publication failed.';
          entry.issues.push(message);
          throw new Error(message);
        }
      },
      evaluators: [
        ({ input, output }) => {
          const { caseData, entry } = resolveCase(input);

          try {
            const trial = trials.get(caseData.definition.id);
            const actual: unknown = output;

            if (
              !trial ||
              JSON.stringify(actual) !==
                JSON.stringify(toSplitExperimentOutput(trial))
            ) {
              throw new Error('Missing or mismatched local trial.');
            }

            const scores = scoreSplitTrial(caseData, trial);
            entry.scores = scores;
            const evaluations: Evaluation[] = [
              { name: 'completed', value: Number(scores.completed) },
              { name: 'accepted', value: Number(scores.accepted) },
              {
                name: 'constraints_passed',
                value: Number(scores.constraintsPassed),
              },
              {
                name: 'together_rate',
                value: scores.together.rate ?? 'not_applicable',
              },
              {
                name: 'separate_rate',
                value: scores.separate.rate ?? 'not_applicable',
              },
              { name: 'corrections', value: scores.corrections },
              { name: 'count_calls', value: trial.result.calls.count },
              { name: 'generate_calls', value: trial.result.calls.generate },
            ];

            return Promise.resolve(evaluations);
          } catch {
            entry.issues.push('Trial scoring failed.');
            throw new Error('Trial scoring failed.');
          }
        },
      ],
      runEvaluators: [
        () =>
          Promise.resolve({
            name: 'accepted_rate',
            value:
              entries.filter((entry) => entry.scores?.accepted).length /
              entries.length,
          }),
      ],
    });

    experiment.id = result.experimentId;
    experiment.url = result.experimentUrl ?? null;
    experiment.issues.push(
      ...collectExperimentIssues(result, {
        caseIds: cases.map(({ definition }) => definition.id),
        itemScoreNames,
        runScoreNames: ['accepted_rate'],
      }),
    );

    if (!experiment.url) {
      experiment.issues.push('Langfuse did not return an experiment URL.');
    }
  } catch {
    experiment.issues.push('Experiment execution failed.');
  }
}

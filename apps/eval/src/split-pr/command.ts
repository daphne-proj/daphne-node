import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { LangfuseConfigurationError } from '../langfuse.js';
import { loadSplitCase, loadSplitSuite } from './dataset.js';
import { summarizeSplitCase } from './validation.js';
import {
  evaluateSplitArtifact,
  evaluateSplitCaseArtifact,
} from './evaluate.js';
import { formatSplitEvaluation } from './evaluation-summary.js';
import { writeJsonArtifact } from '../artifacts.js';
import { EvaluationError, text, choice } from '../parse.js';
import { runSplitEvaluation } from './run.js';
import { uploadSplitEvaluation } from './upload.js';

const usage =
  'Usage: eval split-pr validate --case PATH [--artifact PATH] | --suite PATH\n       eval split-pr eval --case PATH --artifact PATH [--reference PATH] [--output NEW_FILE]\n       eval split-pr score --suite PATH --case-id ID --artifact PATH --output NEW_FILE\n       eval split-pr upload --run-dir PATH\n       eval split-pr run --suite PATH --partition development|holdout --output NEW_DIRECTORY [--model NAME] [--max-input-tokens N] [--trials N] [--concurrency N]';

function options(
  args: string[],
  names: string[],
  defaults: Record<string, string> = {},
  optional: string[] = [],
): Record<string, string> {
  try {
    const { values, tokens } = parseArgs({
      args,
      options: Object.fromEntries(
        names.map((name) => [name, { type: 'string' }]),
      ),
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const used = tokens
      .filter((token) => token.kind === 'option')
      .map((token) => token.name);

    if (new Set(used).size !== used.length) {
      throw new EvaluationError('Options must appear once.');
    }

    return Object.fromEntries(
      names.flatMap((name) => {
        const value = values[name] ?? defaults[name];

        if (value === undefined && optional.includes(name)) {
          return [];
        }

        return [[name, text(value, `--${name}`)]];
      }),
    );
  } catch {
    throw new EvaluationError(usage);
  }
}

export async function runSplitCommand(
  args: string[],
  signal: AbortSignal,
): Promise<number> {
  try {
    signal.throwIfAborted();

    const [command, ...rest] = args;

    if (command === 'validate') {
      const target = rest.some(
        (argument) => argument === '--case' || argument.startsWith('--case='),
      )
        ? 'case'
        : 'suite';
      const values = options(
        rest,
        target === 'case' ? [target, 'artifact'] : [target],
        {},
        ['artifact'],
      );
      const path = text(values[target], `--${target}`);

      if (target === 'case') {
        const prepared = await loadSplitCase(path, values.artifact);
        signal.throwIfAborted();
        process.stdout.write(
          JSON.stringify(
            { status: 'valid', ...summarizeSplitCase(prepared) },
            null,
            2,
          ) + '\n',
        );
        return 0;
      }

      const suite = await loadSplitSuite(path);
      signal.throwIfAborted();
      const partitions = { development: 0, holdout: 0 };
      const reviews = { draft: 0, reviewed: 0 };
      const labels = { together: 0, separate: 0, unknown: 0 };

      for (const { definition } of suite.cases) {
        partitions[definition.partition] += 1;
        reviews[definition.review.status] += 1;
        for (const label of definition.labels) {
          labels[label.relation] += 1;
        }
      }

      process.stdout.write(
        JSON.stringify({
          status: 'valid',
          id: suite.id,
          datasetHash: suite.datasetHash,
          partitions,
          reviews,
          labels,
          cases: suite.cases.map(summarizeSplitCase),
        }) + '\n',
      );
    } else if (command === 'eval') {
      const values = options(
        rest,
        ['case', 'artifact', 'reference', 'output'],
        {},
        ['reference', 'output'],
      );
      const report = await evaluateSplitCaseArtifact(
        text(values.case, '--case'),
        text(values.artifact, '--artifact'),
        values.reference,
      );
      const outputPath =
        values.output === undefined ? undefined : resolve(values.output);
      signal.throwIfAborted();

      if (outputPath !== undefined) {
        await writeJsonArtifact(outputPath, report);
        signal.throwIfAborted();
      }

      process.stdout.write(formatSplitEvaluation(report));

      return report.status === 'complete' ? 0 : 1;
    } else if (command === 'upload') {
      const values = options(rest, ['run-dir']);
      const result = await uploadSplitEvaluation(
        text(values['run-dir'], '--run-dir'),
        signal,
      );
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (command === 'score') {
      const values = options(rest, ['suite', 'case-id', 'artifact', 'output']);
      const report = await evaluateSplitArtifact(
        text(values.suite, '--suite'),
        text(values['case-id'], '--case-id'),
        text(values.artifact, '--artifact'),
      );
      signal.throwIfAborted();
      await writeJsonArtifact(text(values.output, '--output'), report);
      signal.throwIfAborted();
      process.stdout.write(JSON.stringify(report) + '\n');
    } else if (command === 'run') {
      const defaults = {
        model: 'gpt-6.1-sol',
        'max-input-tokens': '16384',
        trials: '3',
        concurrency: '2',
      };
      const values = options(
        rest,
        ['suite', 'partition', 'output', ...Object.keys(defaults)],
        defaults,
      );

      return await runSplitEvaluation(
        {
          suitePath: text(values.suite, '--suite'),
          partition: choice(
            values.partition,
            ['development', 'holdout'],
            '--partition',
          ),
          outputDirectory: text(values.output, '--output'),
          model: text(values.model, '--model'),
          maxInputTokens: Number(values['max-input-tokens']),
          trials: Number(values.trials),
          concurrency: Number(values.concurrency),
        },
        signal,
      );
    } else {
      throw new EvaluationError(usage);
    }

    return 0;
  } catch (error) {
    const message =
      error instanceof EvaluationError ||
      error instanceof LangfuseConfigurationError
        ? error.message
        : 'Split dataset operation failed.';
    process.stderr.write(
      `${signal.aborted ? 'Command cancelled.' : message}\n`,
    );
    return 1;
  }
}

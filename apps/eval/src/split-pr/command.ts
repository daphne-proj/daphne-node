import { parseArgs } from 'node:util';
import { loadSplitCase, loadSplitSuite } from './dataset.js';
import { summarizeSplitCase } from './validation.js';
import { importSplitCase } from './import.js';
import { evaluateSplitArtifact } from './evaluate.js';
import { writeJsonArtifact } from './report.js';
import { SplitDatasetError, text, choice } from './parse.js';
import { runSplitEvaluation } from './run.js';

const usage =
  'Usage: eval split-pr import --artifact PATH --case-id ID --output NEW_FILE\n       eval split-pr validate --case PATH | --suite PATH\n       eval split-pr score --suite PATH --case-id ID --artifact PATH --output NEW_FILE\n       eval split-pr run --suite PATH --partition development|holdout --output NEW_DIRECTORY [--model NAME] [--max-input-tokens N] [--trials N] [--concurrency N]';

function options(
  args: string[],
  names: string[],
  defaults: Record<string, string> = {},
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
      throw new SplitDatasetError('Options must appear once.');
    }

    return Object.fromEntries(
      names.map((name) => [
        name,
        text(values[name] ?? defaults[name], `--${name}`),
      ]),
    );
  } catch {
    throw new SplitDatasetError(usage);
  }
}

export async function runSplitCommand(
  args: string[],
  signal: AbortSignal,
): Promise<number> {
  try {
    signal.throwIfAborted();

    const [command, ...rest] = args;

    if (command === 'import') {
      const values = options(rest, ['artifact', 'case-id', 'output']);
      await importSplitCase(
        text(values.artifact, '--artifact'),
        text(values['case-id'], '--case-id'),
        text(values.output, '--output'),
      );
      signal.throwIfAborted();
      process.stdout.write(
        JSON.stringify({
          status: 'draft',
          caseId: values['case-id'],
          output: values.output,
          message:
            'Evidence imported. Human labels, review and deliberate partition assignment are still required; the suite was not changed.',
        }) + '\n',
      );
    } else if (command === 'validate') {
      const target = rest.some(
        (argument) => argument === '--case' || argument.startsWith('--case='),
      )
        ? 'case'
        : 'suite';
      const values = options(rest, [target]);
      const path = text(values[target], `--${target}`);

      if (target === 'case') {
        const prepared = await loadSplitCase(path);
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
      throw new SplitDatasetError(usage);
    }

    return 0;
  } catch (error) {
    const message =
      error instanceof SplitDatasetError
        ? error.message
        : 'Split dataset operation failed.';
    process.stderr.write(
      `${signal.aborted ? 'Command cancelled.' : message}\n`,
    );
    return 1;
  }
}

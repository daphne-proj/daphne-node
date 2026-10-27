#!/usr/bin/env node
import { CliInputError, describeFailure } from './errors.js';
import { parseContextArgs, runContextInspect } from './context.js';
import { parseSplitArgs, runSplitPr } from './split-pr.js';
import { parseIntentionsArgs, runIntentionsPr } from './intentions.js';
import { formatCommandOutput } from './command-output.js';

const args = process.argv.slice(2);

if (args[0] === '--') {
  args.shift();
}

if (args.length === 0) {
  process.stdout.write(
    'Daphne TypeScript workspace is ready. Application commands have not been migrated yet.\n',
  );
} else {
  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);

  try {
    if (args[0] === 'split-pr') {
      process.exitCode = await runSplitPr(
        parseSplitArgs(args.slice(1)),
        controller.signal,
      );
    } else if (args[0] === 'intentions') {
      process.exitCode = await runIntentionsPr(
        parseIntentionsArgs(args.slice(1)),
        controller.signal,
      );
    } else if (args[0] === 'context' && args[1] === 'inspect') {
      process.exitCode = await runContextInspect(
        parseContextArgs(args.slice(2)),
        controller.signal,
      );
    } else {
      throw new CliInputError(
        'Expected context inspect, split-pr or intentions --pr URL --output DIRECTORY.',
      );
    }
  } catch (error) {
    const failure = describeFailure('arguments', error);

    if (args[0] === 'split-pr' && process.stdout.isTTY) {
      process.stdout.write(
        formatCommandOutput('Split failed', [
          { label: 'Status', value: 'failed', tone: 'error' },
          { label: 'Error', value: failure.message },
        ]) + '\n',
      );
    } else {
      process.stdout.write(
        JSON.stringify(
          { status: 'failed', errors: [failure] },
          null,
          args[0] === 'intentions' ? 2 : undefined,
        ) + '\n',
      );
      process.stderr.write(failure.message + '\n');
    }

    process.exitCode = 1;
  } finally {
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

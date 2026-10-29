/*
 * Dispatches offline dataset commands and explicit live experiments.
 * Example: `bun run eval langfuse-smoke` checks the Langfuse setup.
 * A failed or cancelled run makes the command exit with an error.
 */

import { existsSync } from 'node:fs';
import { runSplitCommand } from './split-pr/command.js';
import { runIntentionsCommand } from './intentions/command.js';
import { loadEnvFile } from 'node:process';
import {
  LangfuseConfigurationError,
  readLangfuseConnection,
  withLangfuse,
} from './langfuse.js';
import { runLangfuseSmoke } from '../tests/smoke/langfuse-smoke.js';
import type { LangfuseSmokeResult } from '../tests/smoke/langfuse-smoke.js';

async function runSmoke(signal: AbortSignal): Promise<number> {
  let result: LangfuseSmokeResult | undefined;

  try {
    if (existsSync('.env')) {
      loadEnvFile('.env');
    }

    const connection = readLangfuseConnection(process.env);

    await withLangfuse(connection, async (client) => {
      result = await runLangfuseSmoke(client, signal);
    });
  } catch (error) {
    const message =
      error instanceof LangfuseConfigurationError
        ? error.message
        : 'Langfuse experiment or telemetry finalization failed.';

    if (result) {
      result.status = 'failed';
      result.issues.push(message);
    } else {
      process.stderr.write(`${message}\n`);
    }

    if (!result) {
      return 1;
    }
  }

  if (!result) {
    return 1;
  }

  if (signal.aborted) {
    result.status = 'failed';
    result.issues.push('Command cancelled.');
  }

  /* Announce success only after scores and traces have finished finalization. */
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === 'complete' ? 0 : 1;
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (
    args[0] !== 'split-pr' &&
    args[0] !== 'intentions' &&
    (args.length !== 1 || args[0] !== 'langfuse-smoke')
  ) {
    process.stderr.write(
      'Usage: eval langfuse-smoke | split-pr validate|eval|score|upload|run ... | intentions judge ...\n',
    );
    return 1;
  }

  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);

  try {
    if (args[0] === 'intentions') {
      return await runIntentionsCommand(args.slice(1), controller.signal);
    }

    if (args[0] === 'split-pr') {
      return await runSplitCommand(args.slice(1), controller.signal);
    }

    return await runSmoke(controller.signal);
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

process.exitCode = await main();

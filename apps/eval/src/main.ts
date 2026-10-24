/*
 * Starts the evaluation command and prints its result after cleanup.
 * Example: `bun run eval langfuse-smoke` checks the Langfuse setup.
 * A failed or cancelled run makes the command exit with an error.
 */

import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import {
  LangfuseConfigurationError,
  readLangfuseConnection,
  withLangfuse,
} from './langfuse.js';
import { runLangfuseSmoke } from '../tests/smoke/langfuse-smoke.js';
import type { LangfuseSmokeResult } from '../tests/smoke/langfuse-smoke.js';

async function main(): Promise<number> {
  const args = process.argv.slice(2);

  if (args.length !== 1 || args[0] !== 'langfuse-smoke') {
    process.stderr.write('Usage: eval langfuse-smoke\n');
    return 1;
  }

  const controller = new AbortController();
  const cancel = () => {
    controller.abort();
  };
  let result: LangfuseSmokeResult | undefined;

  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);

  try {
    if (existsSync('.env')) {
      loadEnvFile('.env');
    }

    const connection = readLangfuseConnection(process.env);

    await withLangfuse(connection, async (client) => {
      result = await runLangfuseSmoke(client, controller.signal);
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
  } finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }

  if (!result) {
    return 1;
  }

  if (controller.signal.aborted) {
    result.status = 'failed';
    result.issues.push('Command cancelled.');
  }

  /* Announce success only after scores and traces have finished finalization. */
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === 'complete' ? 0 : 1;
}

process.exitCode = await main();

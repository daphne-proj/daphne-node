/*
 * Checks Langfuse settings and manages experiment reporting and cleanup.
 * Example: after an experiment, send pending scores and recorded activity.
 * If the experiment fails, still attempt to send pending data before closing.
 */

import { LangfuseClient } from '@langfuse/client';
import { LangfuseSpanProcessor } from '@langfuse/otel';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { captureLangfuseDiagnostics } from './langfuse-diagnostics.js';

export interface LangfuseConnection {
  publicKey: string;
  secretKey: string;
  baseUrl: string;
}

export class LangfuseConfigurationError extends Error {}

function requiredValue(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new LangfuseConfigurationError(
      `Set ${name} in .env or the environment.`,
    );
  }

  return value;
}

export function readLangfuseConnection(
  environment: NodeJS.ProcessEnv,
): LangfuseConnection {
  const publicKey = requiredValue(environment, 'LANGFUSE_PUBLIC_KEY');
  const secretKey = requiredValue(environment, 'LANGFUSE_SECRET_KEY');
  const baseUrl = requiredValue(environment, 'LANGFUSE_BASE_URL');

  const url = URL.parse(baseUrl);

  if (
    !url ||
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    baseUrl.includes('?') ||
    baseUrl.includes('#')
  ) {
    throw new LangfuseConfigurationError(
      'LANGFUSE_BASE_URL must be an absolute HTTP(S) URL without credentials, query or fragment.',
    );
  }

  return { publicKey, secretKey, baseUrl };
}

/* Own one provider for all experiments in a command, including failed operations. */
export async function withLangfuse<T>(
  connection: LangfuseConnection,
  run: (client: LangfuseClient) => Promise<T>,
): Promise<T> {
  const diagnostics = captureLangfuseDiagnostics();

  try {
    return await runWithProvider(connection, run, diagnostics.failures);
  } finally {
    diagnostics.restore();
  }
}

async function runWithProvider<T>(
  connection: LangfuseConnection,
  run: (client: LangfuseClient) => Promise<T>,
  diagnostics: Error[],
): Promise<T> {
  const client = new LangfuseClient({ ...connection, timeout: 5 });
  const processor = new LangfuseSpanProcessor({ ...connection, timeout: 5 });

  const sdk = new NodeSDK({
    spanProcessors: [processor],
    autoDetectResources: false,
    metricReaders: [],
    logRecordProcessors: [],
  });

  let outcome:
    { status: 'complete'; value: T } | { status: 'failed'; error: unknown };

  try {
    sdk.start();
    outcome = { status: 'complete', value: await run(client) };
  } catch (error) {
    outcome = { status: 'failed', error };
  }

  /* Attempt both cleanups even if one fails; retain the original operation error. */
  const cleanup = await Promise.allSettled([client.flush(), sdk.shutdown()]);
  const failures: unknown[] = [];

  if (outcome.status === 'failed') {
    failures.push(outcome.error);
  }

  for (const result of cleanup) {
    if (result.status === 'rejected') {
      failures.push(result.reason);
    }
  }

  failures.push(...diagnostics);

  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Langfuse operation and cleanup failed.',
    );
  }

  if (failures.length === 1) {
    throw failures[0];
  }

  if (outcome.status === 'failed') {
    throw outcome.error;
  }

  return outcome.value;
}

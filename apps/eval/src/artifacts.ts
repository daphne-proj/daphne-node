import { randomUUID } from 'node:crypto';
import { linkSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import { EvaluationError } from './parse.js';

/* Check optional cancellation and publish in the same turn; existing destinations are never replaced. */
export async function writeJsonArtifact(
  path: string,
  value: unknown,
  signal?: AbortSignal,
): Promise<void> {
  const destination = resolve(path);

  if (await isGoldenDatasetPath(destination)) {
    throw new EvaluationError(
      'The golden dataset is read-only; choose an output outside its cases directory.',
    );
  }

  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${randomUUID()}`,
  );
  const failures: unknown[] = [];
  let created = false;

  try {
    const json: unknown = JSON.stringify(value, null, 2);

    if (typeof json !== 'string') {
      throw new Error('Artifact must be JSON serializable.');
    }

    const file = await open(temporary, 'wx', 0o600);
    created = true;

    try {
      await file.writeFile(json + '\n');
    } finally {
      await file.close();
    }

    signal?.throwIfAborted();
    linkSync(temporary, destination);
  } catch (error) {
    failures.push(error);
  } finally {
    if (created) {
      try {
        await unlink(temporary);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  if (
    failures.length === 1 &&
    signal?.aborted &&
    failures[0] === signal.reason
  ) {
    throw failures[0];
  }

  if (failures.length > 0) {
    throw new EvaluationError(
      `${path}: could not publish JSON without overwriting existing data, or clean its temporary file. The parent must exist.`,
      { cause: new AggregateError(failures) },
    );
  }
}

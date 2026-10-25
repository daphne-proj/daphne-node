import { randomUUID } from 'node:crypto';
import { link, open, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import { EvaluationError } from './parse.js';

/* Publish a complete file with a hard link so an existing destination is never replaced. */
export async function writeJsonArtifact(
  path: string,
  value: unknown,
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

    await link(temporary, destination);
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

  if (failures.length > 0) {
    throw new EvaluationError(
      `${path}: could not publish JSON without overwriting existing data, or clean its temporary file. The parent must exist.`,
      { cause: new AggregateError(failures) },
    );
  }
}

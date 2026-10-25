import { randomUUID } from 'node:crypto';
import { linkSync, renameSync, unlinkSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isGoldenDatasetPath } from './output-path.js';

export class ArtifactError extends Error {
  override readonly name = 'ArtifactError';

  constructor(
    readonly code: 'output_directory' | 'artifact_write' | 'cancelled',
    message: string,
    cause: unknown,
  ) {
    super(message, { cause });
  }
}

export async function createRunDirectory(
  path: string,
  options: { reuse?: boolean } = {},
): Promise<string> {
  const directory = resolve(path);

  if (await isGoldenDatasetPath(directory)) {
    throw new ArtifactError(
      'output_directory',
      'The golden dataset is read-only; choose an output outside its cases directory.',
      undefined,
    );
  }

  try {
    await mkdir(directory, { mode: 0o700, recursive: options.reuse ?? false });
  } catch (error) {
    throw new ArtifactError(
      'output_directory',
      options.reuse
        ? 'Output must be a writable directory.'
        : 'Output must be a new directory in an existing writable parent.',
      error,
    );
  }

  return directory;
}

export async function writeArtifact(
  directory: string,
  filename: 'context.json' | 'run.json',
  value: object,
  signal?: AbortSignal,
  options: { overwrite?: boolean } = {},
): Promise<void> {
  if (await isGoldenDatasetPath(directory)) {
    throw new ArtifactError(
      'artifact_write',
      'The golden dataset is read-only; choose an output outside its cases directory.',
      undefined,
    );
  }

  const temporary = join(directory, '.' + filename + '.' + randomUUID());
  const failures: unknown[] = [];
  let created = false;

  try {
    const encoded = JSON.stringify(value, null, 2);
    const file = await open(temporary, 'wx', 0o600);
    created = true;

    try {
      await file.writeFile(encoded + '\n');
    } catch (error) {
      failures.push(error);
    } finally {
      await file.close();
    }

    if (failures.length === 0) {
      if (signal?.aborted) {
        throw new ArtifactError(
          'cancelled',
          'Artifact publication was cancelled.',
          undefined,
        );
      }

      /* Check cancellation and publish atomically in the same JS turn. */
      if (options.overwrite) {
        renameSync(temporary, join(directory, filename));
        created = false;
      } else {
        linkSync(temporary, join(directory, filename));
      }
    }
  } catch (error) {
    failures.push(error);
  } finally {
    if (created) {
      try {
        unlinkSync(temporary);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  if (failures.length === 1 && failures[0] instanceof ArtifactError) {
    throw failures[0];
  }

  if (failures.length > 0) {
    throw new ArtifactError(
      'artifact_write',
      'Could not publish an artifact and clean up its temporary file.',
      new AggregateError(failures),
    );
  }
}

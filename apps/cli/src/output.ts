import { randomUUID } from 'node:crypto';
import { linkSync, unlinkSync } from 'node:fs';
import { mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';

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

export async function createRunDirectory(path: string): Promise<string> {
  const directory = resolve(path);

  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    throw new ArtifactError(
      'output_directory',
      'Output must be a new directory in an existing writable parent.',
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
): Promise<void> {
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

      // Check cancellation and publish in one JS turn; no overwrite or late async publication gap.
      linkSync(temporary, join(directory, filename));
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
      'Could not publish an artifact and clean its temporary link without overwriting existing data.',
      new AggregateError(failures),
    );
  }
}

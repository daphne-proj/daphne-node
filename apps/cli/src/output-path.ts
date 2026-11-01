import { realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path';

function contains(directory: string, path: string): boolean {
  const within = relative(directory, path);
  return (
    within === '' ||
    (!isAbsolute(within) && within !== '..' && !within.startsWith('..' + sep))
  );
}

/* Resolve existing ancestors so a new output cannot enter the gold directory through a symlink. */
async function canonicalPath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];

  for (;;) {
    try {
      return resolve(await realpath(ancestor), ...missing);
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )) {
        throw error;
      }

      const parent = dirname(ancestor);

      if (parent === ancestor) {
        throw error;
      }

      missing.unshift(basename(ancestor));
      ancestor = parent;
    }
  }
}

/* CLI and eval writers protect split labels and the whole intentions dataset, including symlink aliases. */
export async function isGoldenDatasetPath(path: string): Promise<boolean> {
  const packagePath = findPackageJSON(import.meta.url);

  if (!packagePath) {
    throw new Error('Could not locate the CLI workspace.');
  }

  const directories = [
    '../eval/datasets/split-pr/cases',
    '../eval/datasets/intentions',
  ];
  const canonicalOutput = await canonicalPath(path);

  for (const directory of directories) {
    const gold = resolve(dirname(packagePath), directory);

    if (contains(gold, resolve(path))) {
      return true;
    }

    if (contains(await canonicalPath(gold), canonicalOutput)) {
      return true;
    }
  }

  return false;
}

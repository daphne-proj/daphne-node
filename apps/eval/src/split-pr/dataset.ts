import { realpath } from 'node:fs/promises';
import { findPackageJSON } from 'node:module';
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
  win32,
} from 'node:path';
import type { PreparedSplitCase } from './contracts.js';
import { parseSplitCase } from './case.js';
import * as parse from '../parse.js';

function caseFile(value: unknown): string {
  const path = parse.text(value, 'suite.caseFiles');

  if (
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new parse.EvaluationError(
      'suite.caseFiles: expected relative paths within the suite directory.',
    );
  }

  return path;
}

export function splitCaseRunPath(path: string): string {
  const packagePath = findPackageJSON(import.meta.url);

  if (!packagePath) {
    throw new parse.EvaluationError('Could not locate the eval workspace.');
  }

  return resolve(
    dirname(packagePath),
    '../../outputs',
    `split_${basename(path, '.json')}`,
    'run.json',
  );
}

export async function loadSplitCase(
  path: string,
  artifactPath = splitCaseRunPath(path),
): Promise<PreparedSplitCase> {
  const { value: artifact } = await parse.readJson(
    artifactPath,
    (value) => value,
  );
  const { bytes, value: definition } = await parse.readJson(path, (value) =>
    parseSplitCase(artifact, value, basename(path, '.json')),
  );

  return {
    definition,
    caseHash: parse.sha256(JSON.stringify([definition, parse.sha256(bytes)])),
    inputHash: parse.sha256(JSON.stringify(definition.evidence)),
  };
}

export async function loadSplitSuite(
  path: string,
): Promise<{ id: string; datasetHash: string; cases: PreparedSplitCase[] }> {
  const { bytes, value: input } = await parse.readJson(path, (value) =>
    parse.object(value, 'suite'),
  );

  try {
    const suite = {
      format: parse.choice(
        input.format,
        ['daphne-split-suite-v1'],
        'suite.format',
      ),
      id: parse.text(input.id, 'suite.id'),
      caseFiles: parse.array(input.caseFiles, 'suite.caseFiles').map(caseFile),
    };

    if (
      suite.caseFiles.length === 0 ||
      new Set(suite.caseFiles).size !== suite.caseFiles.length
    ) {
      throw new parse.EvaluationError(
        'suite.caseFiles: require a nonempty list of unique paths.',
      );
    }

    const directory = await realpath(dirname(resolve(path)));
    const cases: PreparedSplitCase[] = [];
    const ids = new Set<string>();

    for (const filename of suite.caseFiles) {
      const target = await realpath(resolve(directory, filename));
      const within = relative(directory, target);

      if (
        !within ||
        within === '..' ||
        within.startsWith('..' + sep) ||
        isAbsolute(within)
      ) {
        throw new parse.EvaluationError(
          `suite.caseFiles: ${filename} resolves outside the suite directory.`,
        );
      }

      const prepared = await loadSplitCase(target);

      if (ids.has(prepared.definition.id)) {
        throw new parse.EvaluationError(
          `suite: duplicate case ID ${prepared.definition.id}.`,
        );
      }

      ids.add(prepared.definition.id);
      cases.push(prepared);
    }

    return {
      id: suite.id,
      datasetHash: parse.sha256(
        JSON.stringify([
          parse.sha256(bytes),
          cases.map(({ definition, caseHash }) => [definition.id, caseHash]),
        ]),
      ),
      cases,
    };
  } catch (error) {
    const message =
      error instanceof parse.EvaluationError
        ? error.message
        : 'could not resolve suite case files.';
    throw new parse.EvaluationError(`${path}: ${message}`, { cause: error });
  }
}

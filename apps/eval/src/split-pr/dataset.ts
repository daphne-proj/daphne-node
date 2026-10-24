import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import type { PreparedSplitCase } from './contracts.js';
import { parseSplitCase } from './case.js';
import * as parse from './parse.js';

function caseFile(value: unknown): string {
  const path = parse.text(value, 'suite.caseFiles');

  if (
    isAbsolute(path) ||
    win32.isAbsolute(path) ||
    path.includes('\\') ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new parse.SplitDatasetError(
      'suite.caseFiles: expected relative paths within the suite directory.',
    );
  }

  return path;
}

async function loadCase(path: string): Promise<PreparedSplitCase> {
  const { bytes, value: definition } = await parse.readJson(
    path,
    parseSplitCase,
  );

  return {
    definition,
    caseHash: parse.sha256(bytes),
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
      throw new parse.SplitDatasetError(
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
        throw new parse.SplitDatasetError(
          `suite.caseFiles: ${filename} resolves outside the suite directory.`,
        );
      }

      const prepared = await loadCase(target);

      if (ids.has(prepared.definition.id)) {
        throw new parse.SplitDatasetError(
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
      error instanceof parse.SplitDatasetError
        ? error.message
        : 'could not resolve suite case files.';
    throw new parse.SplitDatasetError(`${path}: ${message}`, { cause: error });
  }
}

import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parsePullRequestUrl } from '@daphne/pr-review';
import { splitPullRequest } from '@daphne/pr-review/split';
import { CliInputError, describeFailure } from './errors.js';
import { createRunDirectory, writeArtifact } from './output.js';

interface SplitOptions {
  pr: string;
  output: string;
  model: string;
  maxInputTokens: number;
}

export function parseSplitArgs(args: string[]): SplitOptions {
  try {
    const { values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        pr: { type: 'string' },
        output: { type: 'string' },
        model: { type: 'string', default: 'gpt-6.1-sol' },
        'max-input-tokens': { type: 'string', default: '16384' },
      },
    });
    const maxInputTokens = Number(values['max-input-tokens']);

    if (
      !values.pr ||
      !values.output?.trim() ||
      values.output.includes('\0') ||
      !values.model.trim() ||
      !Number.isSafeInteger(maxInputTokens) ||
      maxInputTokens < 1
    ) {
      throw new CliInputError();
    }

    return {
      pr: values.pr,
      output: values.output,
      model: values.model,
      maxInputTokens,
    };
  } catch {
    throw new CliInputError(
      'Usage: split-pr --pr URL --output NEW_DIRECTORY [--model MODEL] [--max-input-tokens NUMBER]',
    );
  }
}

export async function runSplitPr(
  options: SplitOptions,
  signal: AbortSignal,
): Promise<number> {
  const ref = parsePullRequestUrl(options.pr);

  if (existsSync('.env')) {
    loadEnvFile('.env');
  }

  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey?.trim()) {
    throw new CliInputError('Set OPENAI_API_KEY in .env or the environment.');
  }

  const directory = await createRunDirectory(options.output);
  const githubToken = process.env.GITHUB_TOKEN;
  const result = await splitPullRequest(ref, {
    apiKey,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    signal,
    ...(githubToken === undefined ? {} : { githubToken }),
    onPage: (page, pageNumber) => {
      process.stderr.write(
        `Prepared page ${String(pageNumber)} (${page.unitIds.join(', ')}).\n`,
      );
    },
  });
  const errors = result.errors.map((error) => describeFailure('split', error));

  /* The command owns the versioned file format; the workflow returns typed results. */
  await writeArtifact(directory, 'run.json', {
    format: 'daphne-split-pr-v3',
    status: result.status,
    pr: ref.url,
    model: options.model,
    maxInputTokens: options.maxInputTokens,
    maxCorrections: result.maxCorrections,
    identity: result.identity,
    changes: result.changes,
    hunks: result.hunks.map(({ change, hunkIndex, sources }) => ({
      changeId: change.id,
      hunkIndex,
      sources,
    })),
    pages: result.pages,
    proposal: result.proposal,
    response: result.response,
    attempts: result.attempts,
    calls: result.calls,
    errors,
  });
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      pages: result.pages.length,
      groups: result.proposal?.groups.length ?? 0,
      output: join(directory, 'run.json'),
      errors,
    }) + '\n',
  );

  return result.status === 'complete' ? 0 : 1;
}

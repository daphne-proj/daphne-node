import { spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import {
  defaultModels,
  parseModelProvider,
  parseOpenAIReasoningEffort,
} from '@daphne/llm';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import { loadIntentionGoldCase } from '../dist/src/intentions/gold-case.js';

/*
 * Make calls this after building. Each stage keeps its output in a log so a
 * successful terminal run shows scores and generation metrics. Failure stops subsequent stages
 * and names the retained log; signals from interrupted children also fail.
 */
function runStage(command, args, logPath) {
  const log = openSync(logPath, 'wx');

  try {
    const result = spawnSync(
      'bun',
      ['run', '--silent', command, '--', ...args],
      {
        stdio: ['inherit', log, log],
        env:
          command === 'eval' && process.stdout.isTTY
            ? {
                ...process.env,
                COLUMNS: String(process.stdout.columns),
                ...(process.env.NO_COLOR === undefined &&
                process.env.FORCE_COLOR === undefined
                  ? { FORCE_COLOR: '1' }
                  : {}),
              }
            : process.env,
      },
    );

    if (result.error || result.status !== 0) {
      throw new Error(`${command} failed. See ${logPath}`, {
        cause: result.error,
      });
    }
  } finally {
    closeSync(log);
  }
}

try {
  const {
    CASE,
    ARTIFACT,
    OUTPUT,
    PROVIDER,
    MAX_INPUT_TOKENS,
    REASONING_EFFORT,
    GENERATION_PROMPT,
  } = process.env;
  const provider = parseModelProvider(PROVIDER);
  const reasoningEffort =
    !ARTIFACT && provider === 'openai'
      ? parseOpenAIReasoningEffort(REASONING_EFFORT)
      : undefined;
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const output = resolve(
    OUTPUT || `outputs/intentions-eval-${stamp}-${process.pid}`,
  );

  if (await isGoldenDatasetPath(output)) {
    throw new Error(
      'Evaluation output must be outside the reference datasets.',
    );
  }

  const gold = CASE ? await loadIntentionGoldCase(CASE) : null;

  if (!ARTIFACT && gold === null) {
    throw new Error(
      'Provide CASE for a fresh run or ARTIFACT for saved output.',
    );
  }

  if (!OUTPUT) {
    await mkdir('outputs', { recursive: true });
  }

  await mkdir(output);
  let artifact = ARTIFACT;

  if (!artifact) {
    const generation = join(output, 'generation');
    runStage(
      'cli',
      [
        'intentions',
        '--pr',
        gold.pr,
        '--output',
        generation,
        '--provider',
        provider,
        '--max-input-tokens',
        MAX_INPUT_TOKENS,
        ...(reasoningEffort === undefined
          ? []
          : ['--reasoning-effort', reasoningEffort]),
      ],
      join(output, 'generation.log'),
    );
    artifact = join(generation, 'run.json');
  }

  const evaluation = join(output, 'evaluation');
  const args = ['intentions', CASE ? 'eval' : 'judge'];

  if (CASE) {
    args.push('--case', CASE);
  }

  /* The independent Codex judge uses OpenAI even when Anthropic generated the cards. */
  args.push(
    '--artifact',
    artifact,
    '--output',
    evaluation,
    '--model',
    defaultModels.openai,
  );

  if (GENERATION_PROMPT) {
    args.push('--generation-prompt', GENERATION_PROMPT);
  }

  runStage('eval', args, join(output, 'evaluation.log'));

  process.stdout.write(await readFile(join(output, 'evaluation.log'), 'utf8'));
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
}

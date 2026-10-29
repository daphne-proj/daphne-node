import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { isGoldenDatasetPath } from '@daphne/cli/output-path';
import { CodexJudgeError, runCodexJudge } from '../codex-runner.js';
import type { CodexJudgeDiagnostics } from '../codex-runner.js';
import { writeJsonArtifact } from '../artifacts.js';
import { EvaluationError, sha256, text } from '../parse.js';
import { loadIntentionArtifact } from './artifact.js';
import { judgmentSchema, parseJudgment } from './judgment.js';

const usage =
  'Usage: eval intentions judge --artifact PATH --output NEW_DIRECTORY --model NAME [--generation-prompt PATH]';

function options(args: string[]) {
  const [command, ...rest] = args;

  if (command !== 'judge') {
    throw new EvaluationError(usage);
  }

  const { values, tokens } = parseArgs({
    args: rest,
    options: {
      output: { type: 'string' },
      model: { type: 'string' },
      artifact: { type: 'string' },
      'generation-prompt': { type: 'string' },
    },
    tokens: true,
    strict: true,
    allowPositionals: false,
  });
  const names = tokens.map((token) =>
    token.kind === 'option' ? token.name : '',
  );

  if (new Set(names).size !== names.length) {
    throw new EvaluationError('Options must appear once.');
  }

  return {
    output: resolve(text(values.output, '--output')),
    model: text(values.model, '--model'),
    artifact: resolve(text(values.artifact, '--artifact')),
    promptPath: values['generation-prompt'],
  };
}

/*
 * Grade one saved run against its captured instructions and evidence without regenerating it.
 * For example, use `intentions judge --artifact run.json --output new-dir --model MODEL`.
 * Inputs are published before invoking Codex, and a final report preserves model failures.
 * Low scores still mean a completed evaluation; missing or invalid judgments exit nonzero.
 */
export async function runIntentionsCommand(
  args: string[],
  signal: AbortSignal,
): Promise<number> {
  try {
    signal.throwIfAborted();
    const input = options(args);
    const candidate = await loadIntentionArtifact(input.artifact);
    const provenance = {
      artifactHash: candidate.artifactHash,
      requestedModel: input.model,
    };

    if (await isGoldenDatasetPath(input.output)) {
      throw new EvaluationError(
        'Evaluation output must be outside the reference datasets.',
      );
    }

    let generationInstructions = candidate.generationInstructions;
    let instructionsSource = 'provider_response';

    if (input.promptPath !== undefined) {
      const supplied = text(
        await readFile(input.promptPath, 'utf8'),
        'generation prompt',
      );

      if (
        generationInstructions !== null &&
        supplied !== generationInstructions
      ) {
        throw new EvaluationError(
          'Supplied generation prompt differs from the captured instructions.',
        );
      }

      generationInstructions = supplied;
      instructionsSource = 'explicit_file';
    }

    if (candidate.status === 'complete' && generationInstructions === null) {
      throw new EvaluationError(
        'Original generation instructions are unavailable; provide --generation-prompt PATH.',
      );
    }

    const rubric = await readFile(
      new URL('../../../prompts/intentions.md', import.meta.url),
      'utf8',
    );
    const request = {
      generationInstructions,
      packet: candidate.packet,
    };
    const prompt = `${rubric}\n\nEvaluation input (JSON data):\n${JSON.stringify(request)}\n`;

    if (Buffer.byteLength(prompt) > 512 * 1024) {
      throw new EvaluationError(
        'The judge input exceeds 512 KiB; no evidence was truncated or sent.',
      );
    }

    signal.throwIfAborted();

    try {
      await mkdir(input.output);
    } catch (error) {
      throw new EvaluationError(
        'Could not create the output directory; choose a new path with an existing parent.',
        { cause: error },
      );
    }

    await writeJsonArtifact(join(input.output, 'input.json'), {
      format: 'daphne-intentions-judge-input-v1',
      ...provenance,
      instructionsSource:
        generationInstructions === null ? 'unavailable' : instructionsSource,
      generationInstructionsHash:
        generationInstructions === null ? null : sha256(generationInstructions),
      rubricHash: sha256(rubric),
      schemaHash: sha256(JSON.stringify(judgmentSchema)),
      promptHash: sha256(prompt),
      prompt,
      schema: judgmentSchema,
    });

    const startedAt = new Date().toISOString();
    const start = performance.now();
    let status:
      'complete' | 'failed_evaluation' | 'failed_run' | 'invalid_output' =
      candidate.status;
    let judgment: ReturnType<typeof parseJudgment> | null = null;
    let codex: CodexJudgeDiagnostics | null = null;
    let rawOutput: unknown = null;
    const issues = [...candidate.diagnostics];

    if (candidate.status === 'complete') {
      try {
        const result = await runCodexJudge(prompt, judgmentSchema, {
          model: input.model,
          timeoutMs: 10 * 60 * 1000,
          signal,
        });
        const { output, ...diagnostics } = result;
        codex = diagnostics;
        rawOutput = output;
        judgment = parseJudgment(output, candidate.packet);
        signal.throwIfAborted();
      } catch (error) {
        status = 'failed_evaluation';
        judgment = null;

        if (error instanceof CodexJudgeError) {
          codex = error.diagnostics;
        }

        issues.push(
          error instanceof EvaluationError || error instanceof CodexJudgeError
            ? error.message
            : 'Judgment failed or was cancelled.',
        );
      }
    }

    const reportPath = join(input.output, 'report.json');
    await writeJsonArtifact(reportPath, {
      format: 'daphne-intentions-judge-v1',
      ...provenance,
      status,
      judgment,
      issues,
      codex,
      rawOutput,
      timing: { startedAt, elapsedMs: performance.now() - start },
    });
    process.stdout.write(
      JSON.stringify(
        {
          status,
          reportPath,
          dimensions: judgment?.dimensions ?? null,
          issues,
        },
        null,
        2,
      ) + '\n',
    );

    return status === 'complete' && !signal.aborted ? 0 : 1;
  } catch (error) {
    const message =
      error instanceof EvaluationError
        ? error.message
        : `Intentions evaluation could not complete. ${usage}`;
    process.stderr.write(
      `${signal.aborted ? 'Command cancelled.' : message}\n`,
    );
    return 1;
  }
}

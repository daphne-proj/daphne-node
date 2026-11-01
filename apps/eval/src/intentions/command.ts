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
import { summarizeIntentionQuality } from './quality.js';
import { formatIntentionEvaluation } from './presentation.js';
import { loadIntentionGoldCase, prepareGoldPacket } from './gold-case.js';
import { goldJudgmentSchema, parseGoldJudgment } from './gold-judgment.js';

const usage =
  'Usage: eval intentions judge|eval --artifact PATH --output NEW_DIRECTORY --model NAME [--case PATH (required for eval)] [--generation-prompt PATH]';

function options(args: string[]) {
  const [command, ...rest] = args;

  if (command !== 'judge' && command !== 'eval') {
    throw new EvaluationError(usage);
  }

  const { values, tokens } = parseArgs({
    args: rest,
    options: {
      output: { type: 'string' },
      model: { type: 'string' },
      artifact: { type: 'string' },
      case: { type: 'string' },
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

  if (command === 'judge' && values.case !== undefined) {
    throw new EvaluationError('--case is only available with intentions eval.');
  }

  return {
    casePath: command === 'eval' ? resolve(text(values.case, '--case')) : null,
    output: resolve(text(values.output, '--output')),
    model: text(values.model, '--model'),
    artifact: resolve(text(values.artifact, '--artifact')),
    promptPath: values['generation-prompt'],
  };
}

/*
 * Grade a saved accepted run; eval additionally loads and matches a frozen gold case.
 * For example, intentions eval --case cases/pr_1.json adds semantic behavior coverage.
 * Gold annotations are never sent to the writer or runtime reviewer.
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
    const gold =
      input.casePath === null
        ? null
        : await loadIntentionGoldCase(input.casePath);
    const candidate = await loadIntentionArtifact(input.artifact);
    const packet =
      gold !== null && candidate.status === 'complete'
        ? prepareGoldPacket(gold, candidate.packet)
        : candidate.packet;
    const schema = gold === null ? judgmentSchema : goldJudgmentSchema;
    const goldProvenance =
      gold === null
        ? {}
        : {
            caseId: gold.id,
            caseHash: gold.caseHash,
            evidenceHash: gold.evidenceHash,
            partition: gold.partition,
            review: gold.review,
            provisional: gold.review.status !== 'reviewed',
            goldRubricVersion: 4,
          };
    const provenance = {
      artifactHash: candidate.artifactHash,
      requestedModel: input.model,
      rubricVersion: 5,
      ...goldProvenance,
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

    let rubric = await readFile(
      new URL('../../../prompts/intentions.md', import.meta.url),
      'utf8',
    );

    if (gold !== null) {
      rubric +=
        '\n' +
        (await readFile(
          new URL('../../../prompts/intentions-gold.md', import.meta.url),
          'utf8',
        ));
    }

    const request = {
      generationInstructions,
      packet,
      ...(gold === null
        ? {}
        : {
            gold: {
              behaviors: gold.behaviors,
              incidentalChanges: gold.incidentalChanges,
              expectedIssues: gold.expectedIssues,
              falseAlarmControls: gold.falseAlarmControls,
            },
          }),
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
      format:
        gold === null
          ? 'daphne-intentions-judge-input-v4'
          : 'daphne-intentions-gold-input-v3',
      ...provenance,
      instructionsSource:
        generationInstructions === null ? 'unavailable' : instructionsSource,
      generationInstructionsHash:
        generationInstructions === null ? null : sha256(generationInstructions),
      rubricHash: sha256(rubric),
      schemaHash: sha256(JSON.stringify(schema)),
      promptHash: sha256(prompt),
      prompt,
      schema,
    });

    const startedAt = new Date().toISOString();
    const start = performance.now();
    let status:
      'complete' | 'failed_evaluation' | 'failed_run' | 'invalid_output' =
      candidate.status;
    let judgment: ReturnType<typeof parseJudgment> | null = null;
    let goldResult: ReturnType<typeof parseGoldJudgment> | null = null;
    let codex: CodexJudgeDiagnostics | null = null;
    let rawOutput: unknown = null;
    const issues = [...candidate.diagnostics];

    if (candidate.status === 'complete') {
      try {
        const result = await runCodexJudge(prompt, schema, {
          model: input.model,
          timeoutMs: 10 * 60 * 1000,
          signal,
        });
        const { output, ...diagnostics } = result;
        codex = diagnostics;
        rawOutput = output;

        if (gold !== null && packet !== null) {
          goldResult = parseGoldJudgment(output, gold, packet);
          judgment = goldResult.judgment;
        } else {
          judgment = parseJudgment(output, candidate.packet);
        }

        signal.throwIfAborted();
      } catch (error) {
        status = 'failed_evaluation';
        judgment = null;
        goldResult = null;

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
    const quality = goldResult?.quality ?? summarizeIntentionQuality(judgment);
    await writeJsonArtifact(reportPath, {
      format:
        gold === null
          ? 'daphne-intentions-judge-v4'
          : 'daphne-intentions-gold-report-v3',
      ...provenance,
      status,
      judgment,
      quality,
      ...(gold === null
        ? {}
        : {
            behaviors: goldResult?.behaviors ?? null,
            coverage: goldResult?.coverage ?? null,
            issueEvaluation: goldResult?.issueEvaluation ?? null,
          }),
      issues,
      codex,
      rawOutput,
      timing: { startedAt, elapsedMs: performance.now() - start },
    });
    process.stdout.write(
      formatIntentionEvaluation({
        status,
        judgment,
        gold: goldResult,
        provisional: gold !== null && gold.review.status !== 'reviewed',
        quality,
        diagnostics: issues,
        unassessedBehaviors:
          goldResult?.behaviors.filter(
            (behavior) =>
              gold?.behaviors.some(
                (expected) => expected.id === behavior.id && expected.required,
              ) &&
              (behavior.before.status === 'unassessed' ||
                behavior.after.status === 'unassessed'),
          ).length ?? 0,
        reportPath,
      }),
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

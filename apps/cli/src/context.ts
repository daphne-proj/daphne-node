import { parseArgs } from 'node:util';
import { join } from 'node:path';
import {
  defaultPullRequestLimits,
  parsePullRequestUrl,
  resolvePullRequest,
} from '@daphne/pr-review';
import { acquireSnapshot, defaultGitLimits } from '@daphne/git-source';
import {
  createEvidenceSession,
  defaultEvidenceLimits,
} from '@daphne/review-evidence';
import type {
  EvidenceSession,
  ReviewIdentity,
  ToolResult,
} from '@daphne/review-evidence';
import {
  createContextEngine,
  defaultContextLimits,
} from '@daphne/context-engine';
import type { ContextEngine, ContextPacket } from '@daphne/context-engine';
import { ArtifactError, createRunDirectory, writeArtifact } from './output.js';
import {
  CliInputError,
  InspectionCancelledError,
  describeFailure,
} from './errors.js';
import type { Stage, Failure } from './errors.js';

const sourceAllowanceBytes = 65_536;

type Progress = 'unstarted' | 'open' | 'complete' | 'partial' | 'unavailable';
interface ChangeProgress {
  readonly changeId: string;
  status: Progress;
  recordedPages: number;
  stopReason: 'source_allowance' | null;
}

interface RunReport {
  readonly format: 'daphne-context-run-v1';
  readonly pr: string;
  readonly startedAt: string;
  finishedAt: string | null;
  durationMs: number;
  status: 'running' | 'complete' | 'partial' | 'failed' | 'stopped';
  identity: ReviewIdentity | null;
  readonly policy: { readonly sourceAllowanceBytes: number };
  readonly inventory: {
    status: Progress;
    recordedPages: number;
    knownChangeCount: number;
    changedFileCount: number | null;
  };
  readonly inspection: {
    readonly changes: ChangeProgress[];
    admittedSourceBytes: number;
    retainedSourceCount: number;
    stopReason: 'source_allowance' | null;
  };
  packet: {
    readonly packetId: string;
    readonly byteCount: number;
    readonly includedEvidenceIds: readonly string[];
    readonly omittedEvidenceIds: readonly string[];
    readonly notices: ContextPacket['notices'];
  } | null;
  readonly stages: {
    readonly name: Stage;
    readonly durationMs: number;
    readonly outcome: 'complete' | 'failed';
  }[];
  readonly errors: Failure[];
}

export function parseContextArgs(args: readonly string[]): {
  pr: string;
  output: string;
} {
  try {
    const parsed = parseArgs({
      args: [...args],
      options: { pr: { type: 'string' }, output: { type: 'string' } },
      strict: true,
      allowPositionals: false,
      tokens: true,
    });
    const { pr, output } = parsed.values;
    const names = parsed.tokens.flatMap((token) =>
      token.kind === 'option' ? [token.name] : [],
    );

    if (
      typeof pr !== 'string' ||
      pr.length === 0 ||
      typeof output !== 'string' ||
      output.trim().length === 0 ||
      output.includes('\0') ||
      new Set(names).size !== names.length
    ) {
      throw new CliInputError();
    }

    return { pr, output };
  } catch {
    throw new CliInputError(
      'Usage: context inspect --pr https://github.com/OWNER/REPO/pull/NUMBER --output NEW_DIRECTORY',
    );
  }
}

function checkCancellation(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new InspectionCancelledError();
  }
}

function progress(page: ToolResult): Progress {
  return page.nextCursor === null ? page.completeness : 'open';
}

async function inspectRepository(
  session: EvidenceSession,
  context: ContextEngine,
  report: RunReport,
  signal: AbortSignal,
): Promise<void> {
  let cursor: string | null = null;
  report.inventory.status = 'open';

  do {
    checkCancellation(signal);
    const page = await session.execute({ name: 'list_changes', cursor });
    context.addToolResult(page);

    for (const entry of page.entries) {
      if (entry.kind === 'change') {
        report.inspection.changes.push({
          changeId: entry.change.id,
          status: 'unstarted',
          recordedPages: 0,
          stopReason: null,
        });
      }
    }

    report.inventory.recordedPages += 1;
    report.inventory.knownChangeCount = report.inspection.changes.length;
    report.inventory.status = progress(page);
    cursor = page.nextCursor;
  } while (cursor !== null);

  if (report.inventory.status === 'complete') {
    report.inventory.changedFileCount = report.inventory.knownChangeCount;
  }

  for (const change of report.inspection.changes) {
    if (report.inspection.admittedSourceBytes >= sourceAllowanceBytes) {
      report.inspection.stopReason = 'source_allowance';
      return;
    }

    cursor = null;
    change.status = 'open';

    do {
      checkCancellation(signal);
      const page = await session.execute({
        name: 'inspect_change',
        changeId: change.changeId,
        cursor,
      });
      const sourceBytes = page.entries.reduce(
        (total, entry) =>
          total +
          (entry.kind === 'source' ? Buffer.byteLength(entry.source.text) : 0),
        0,
      );

      if (
        report.inspection.admittedSourceBytes + sourceBytes >
        sourceAllowanceBytes
      ) {
        change.status = 'partial';
        change.stopReason = 'source_allowance';
        report.inspection.stopReason = 'source_allowance';
        return;
      }

      context.addToolResult(page);
      report.inspection.admittedSourceBytes += sourceBytes;
      report.inspection.retainedSourceCount =
        context.getEvidenceSnapshot().sources.length;
      change.recordedPages += 1;
      change.status = progress(page);
      cursor = page.nextCursor;

      if (
        cursor !== null &&
        report.inspection.admittedSourceBytes === sourceAllowanceBytes
      ) {
        change.stopReason = 'source_allowance';
        report.inspection.stopReason = 'source_allowance';
        return;
      }
    } while (cursor !== null);
  }
}

export async function runContextInspect(
  input: { readonly pr: string; readonly output: string },
  signal: AbortSignal,
): Promise<0 | 1 | 2> {
  const ref = parsePullRequestUrl(input.pr);
  const directory = await createRunDirectory(input.output);
  const started = Date.now();
  const report: RunReport = {
    format: 'daphne-context-run-v1',
    pr: ref.url,
    startedAt: new Date(started).toISOString(),
    finishedAt: null,
    durationMs: 0,
    status: 'running',
    identity: null,
    policy: { sourceAllowanceBytes },
    inventory: {
      status: 'unstarted',
      recordedPages: 0,
      knownChangeCount: 0,
      changedFileCount: null,
    },
    inspection: {
      changes: [],
      admittedSourceBytes: 0,
      retainedSourceCount: 0,
      stopReason: null,
    },
    packet: null,
    stages: [],
    errors: [],
  };

  async function stage<T>(
    name: Stage,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    const started = Date.now();
    let outcome: 'complete' | 'failed' = 'complete';

    try {
      return await operation();
    } catch (error) {
      outcome = 'failed';
      report.errors.push(describeFailure(name, error));
      throw error;
    } finally {
      report.stages.push({ name, durationMs: Date.now() - started, outcome });
    }
  }

  let packet: ContextPacket | undefined;
  let contextWritten = false;

  try {
    const acquisitionSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(defaultGitLimits.acquisitionTimeoutMs),
    ]);
    const token = process.env.GITHUB_TOKEN;
    const metadata = await stage('metadata', async () => {
      checkCancellation(signal);

      return resolvePullRequest(ref, {
        signal: acquisitionSignal,
        limits: defaultPullRequestLimits,
        ...(token === undefined ? {} : { token }),
      });
    });
    const snapshot = await stage('acquisition', () =>
      acquireSnapshot(
        {
          targetRepositoryUrl: metadata.targetRepositoryUrl,
          headRepositoryUrl: metadata.headRepositoryUrl,
          targetCommit: metadata.targetCommit,
          headCommit: metadata.headCommit,
        },
        { signal: acquisitionSignal, limits: defaultGitLimits },
      ),
    );
    let context: ContextEngine;

    try {
      report.identity = snapshot.identity;
      context = await stage('inspection', async () => {
        const session = createEvidenceSession(snapshot, {
          signal,
          gitLimits: defaultGitLimits,
          limits: defaultEvidenceLimits,
        });
        const engine = createContextEngine(
          session.identity,
          defaultContextLimits,
        );
        await inspectRepository(session, engine, report, signal);

        return engine;
      });
    } finally {
      // Cleanup has its own lifetime; preserve both errors if retrieval and close fail.
      await stage('cleanup', () => snapshot.close()).catch(() => undefined);
    }

    if (report.errors.length === 0) {
      const assembled = await stage('assembly', () => {
        checkCancellation(signal);

        return context.buildContextPacket({
          evidenceIds: context
            .getEvidenceSnapshot()
            .sources.map((entry) => entry.evidenceId),
          maxBytes: defaultContextLimits.maxContextBytes,
        });
      });
      packet = assembled;
      report.packet = {
        packetId: packet.packetId,
        byteCount: packet.byteCount,
        includedEvidenceIds: packet.includedEvidenceIds,
        omittedEvidenceIds: packet.omittedEvidenceIds,
        notices: packet.notices,
      };
      await stage('context_output', async () => {
        checkCancellation(signal);
        await writeArtifact(directory, 'context.json', assembled, signal);
      });
      contextWritten = true;
    }
  } catch {
    // The stage records a safe error; the report is still published after cleanup.
  }

  if (
    signal.aborted &&
    !report.errors.some((error) => error.code === 'cancelled')
  ) {
    report.errors.push(
      describeFailure('run_output', new InspectionCancelledError()),
    );
  }

  let exitCode: 0 | 1 | 2;

  if (report.errors.length > 0 || !packet) {
    report.status = signal.aborted ? 'stopped' : 'failed';
    exitCode = 1;
  } else if (
    report.inventory.status !== 'complete' ||
    report.inspection.changes.some((change) => change.status !== 'complete') ||
    packet.notices.length > 0 ||
    packet.omittedEvidenceIds.length > 0
  ) {
    report.status = 'partial';
    exitCode = 2;
  } else {
    report.status = 'complete';
    exitCode = 0;
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - started;
  let runWritten = false;

  try {
    await writeArtifact(
      directory,
      'run.json',
      report,
      signal.aborted ? undefined : signal,
    );
    runWritten = true;
  } catch (error) {
    report.errors.push(describeFailure('run_output', error));
    exitCode = 1;

    if (error instanceof ArtifactError && error.code === 'cancelled') {
      report.status = 'stopped';
      report.finishedAt = new Date().toISOString();
      report.durationMs = Date.now() - started;

      try {
        await writeArtifact(directory, 'run.json', report);
        runWritten = true;
      } catch (error) {
        report.errors.push(describeFailure('run_output', error));
        report.status = 'failed';
      }
    } else {
      report.status = 'failed';
    }
  }

  process.stdout.write(
    JSON.stringify({
      status: report.status,
      identity: report.identity,
      changedFileCount: report.inventory.changedFileCount,
      knownChangeCount: report.inventory.knownChangeCount,
      inspectedChangeCount: report.inspection.changes.filter(
        (change) => change.status === 'complete',
      ).length,
      includedEvidenceCount: packet?.includedEvidenceIds.length ?? 0,
      omittedEvidenceCount: packet?.omittedEvidenceIds.length ?? 0,
      limitations: {
        inventory: report.inventory.status,
        unfinishedChangeCount: report.inspection.changes.filter(
          (change) => change.status !== 'complete',
        ).length,
        stopReason: report.inspection.stopReason,
        packetNotices: packet?.notices ?? [],
      },
      artifacts: {
        context: contextWritten ? join(directory, 'context.json') : null,
        run: runWritten ? join(directory, 'run.json') : null,
      },
      errors: report.errors,
    }) + '\n',
  );

  for (const error of report.errors) {
    process.stderr.write(error.stage + ': ' + error.message + '\n');
  }

  return exitCode;
}

import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import {
  checkCancellation,
  GitOperationError,
  resolveGitLimits,
} from './limits.js';
import type { GitOperationOptions } from './limits.js';

// Only host-installed Git is trusted; repository config and inherited Git settings are not.
const gitConfig = [
  'core.hooksPath=/dev/null',
  'core.fsmonitor=false',
  'core.attributesFile=/dev/null',
  'credential.helper=',
  'protocol.allow=never',
  'protocol.https.allow=always',
  'http.followRedirects=false',
  'fetch.recurseSubmodules=false',
  'gc.auto=0',
  'maintenance.auto=false',
  'core.commitGraph=false',
  'diff.renameLimit=0',
];

export async function runGit(
  args: readonly string[],
  cwd: string,
  options: GitOperationOptions & {
    fetch: boolean;
    acceptedExitCodes?: readonly number[];
  },
): Promise<Buffer> {
  if (process.platform !== 'darwin' && process.platform !== 'linux') {
    throw new GitOperationError(
      'unsupported',
      'Git process-group cleanup currently requires macOS or Linux.',
    );
  }
  const limits = resolveGitLimits(options.limits);
  checkCancellation(options.signal);
  const timeout = options.fetch
    ? limits.acquisitionTimeoutMs
    : limits.gitTimeoutMs;
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(timeout),
  ]);
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: cwd,
    XDG_CONFIG_HOME: cwd,
    LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_ATTR_NOSYSTEM: '1',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_TERMINAL_PROMPT: '0',
    GIT_PROTOCOL_FROM_USER: '0',
    GIT_LITERAL_PATHSPECS: '1',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CEILING_DIRECTORIES: dirname(cwd),
  };

  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '--no-pager',
        '--no-replace-objects',
        '--no-lazy-fetch',
        ...gitConfig.flatMap((value) => ['-c', value]),
        ...args,
      ],
      {
        cwd,
        env,
        shell: false,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    const output: Buffer[] = [];
    let bytes = 0;
    let failure: GitOperationError | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    function killGroup(killSignal: NodeJS.Signals): void {
      if (child.pid === undefined) {
        return;
      }
      try {
        process.kill(-child.pid, killSignal);
      } catch {
        // The group may already have exited.
        child.kill(killSignal);
      }
    }

    function stop(error: GitOperationError): void {
      if (failure) {
        return;
      }
      failure = error;
      killGroup('SIGTERM');
      killTimer = setTimeout(() => {
        killGroup('SIGKILL');
      }, 500);
      killTimer.unref();
    }

    function onAbort(): void {
      try {
        checkCancellation(signal);
      } catch (error) {
        if (error instanceof GitOperationError) {
          stop(error);
        }
      }
    }

    function capture(chunk: Buffer, keep: boolean): void {
      if (failure) {
        return;
      }
      bytes += chunk.byteLength;
      if (bytes > limits.maxGitOutputBytes) {
        stop(
          new GitOperationError(
            'output_limit',
            'Git output exceeds the configured byte limit.',
          ),
        );
        return;
      }
      if (keep) {
        output.push(chunk);
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      capture(chunk, true);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      capture(chunk, false);
    });
    child.on('error', () => {
      stop(
        new GitOperationError(
          'git',
          'Could not start or communicate with Git.',
        ),
      );
    });
    child.once('close', (exitCode, exitSignal) => {
      signal.removeEventListener('abort', onAbort);
      clearTimeout(killTimer);
      if (failure) {
        killGroup('SIGKILL');
        reject(failure);
        return;
      }
      if (
        exitCode === null ||
        !(options.acceptedExitCodes ?? [0]).includes(exitCode)
      ) {
        reject(
          new GitOperationError(
            'git',
            'Git failed; the repository or requested objects may be unavailable.',
            {
              cause: { exitCode, signal: exitSignal },
            },
          ),
        );
        return;
      }
      resolve(Buffer.concat(output));
    });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    }
  });
}

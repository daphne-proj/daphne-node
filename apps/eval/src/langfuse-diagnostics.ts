/*
 * Collects background reporting errors so the command can report failure.
 * Example: Langfuse rejects a score but only logs an error; capture it here.
 */

import { getGlobalLogger, LogLevel } from '@langfuse/core';
import { diag, DiagLogLevel } from '@opentelemetry/api';

/*
 * Langfuse can drop failed exports after logging them, without rejecting flush().
 * Capture those errors for this command and keep provider payloads out of stdout.
 */
export function captureLangfuseDiagnostics(): {
  failures: Error[];
  restore: () => void;
} {
  const failures: Error[] = [];
  const logger = getGlobalLogger();
  const previousLevel = logger.getLevel();
  const previousError = logger.error.bind(logger);

  logger.setLevel(LogLevel.ERROR);
  logger.error = (message, ...details) => {
    failures.push(
      new Error('Langfuse SDK reported a failure.', {
        cause: { message, details },
      }),
    );
  };

  diag.setLogger(
    {
      error: (...details: unknown[]) => {
        failures.push(
          new Error('OpenTelemetry reported a failure.', {
            cause: details,
          }),
        );
      },
      warn: () => {},
      info: () => {},
      debug: () => {},
      verbose: () => {},
    },
    DiagLogLevel.ERROR,
  );

  return {
    failures,
    restore: () => {
      logger.error = previousError;
      logger.setLevel(previousLevel);
      diag.disable();
    },
  };
}

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export class SplitDatasetError extends Error {
  override readonly name = 'SplitDatasetError';
}

export function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SplitDatasetError(`${field}: expected an object.`);
  }

  return Object.fromEntries(Object.entries(value));
}

export function array(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new SplitDatasetError(`${field}: expected an array.`);
  }

  return value;
}

export function text(
  value: unknown,
  field: string,
  allowEmpty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!allowEmpty && !value.trim()) ||
    value.includes('\0') ||
    Buffer.from(value).toString('utf8') !== value
  ) {
    throw new SplitDatasetError(
      `${field}: expected ${allowEmpty ? '' : 'nonblank '}UTF-8 text without NUL.`,
    );
  }

  return value;
}

export function integer(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new SplitDatasetError(
      `${field}: expected a nonnegative safe integer.`,
    );
  }

  return value;
}

export function choice<const T extends string>(
  value: unknown,
  choices: readonly T[],
  field: string,
): T {
  const match = choices.find((candidate) => candidate === value);

  if (match === undefined) {
    throw new SplitDatasetError(`${field}: expected ${choices.join(' or ')}.`);
  }

  return match;
}

export function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  const canonical = result.replace(/Z$/, '.000Z');
  const time = new Date(result);

  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(result) ||
    !Number.isFinite(time.getTime()) ||
    (time.toISOString() !== result && time.toISOString() !== canonical)
  ) {
    throw new SplitDatasetError(
      `${field}: expected a valid ISO UTC timestamp.`,
    );
  }

  return result;
}

export function sha256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function readJson<T>(
  path: string,
  decode: (value: unknown, bytes: Buffer) => T,
): Promise<{ bytes: Buffer; value: T }> {
  let bytes: Buffer;

  try {
    bytes = await readFile(path);
  } catch (error) {
    throw new SplitDatasetError(`${path}: could not read file.`, {
      cause: error,
    });
  }

  let value: unknown;

  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new SplitDatasetError(`${path}: invalid JSON or UTF-8.`, {
      cause: error,
    });
  }

  try {
    return { bytes, value: decode(value, bytes) };
  } catch (error) {
    if (error instanceof SplitDatasetError) {
      throw new SplitDatasetError(`${path}: ${error.message}`, {
        cause: error,
      });
    }

    throw error;
  }
}

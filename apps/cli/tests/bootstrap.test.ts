import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

test('the compiled CLI starts under Node outside the repository', () => {
  const entry = fileURLToPath(new URL('../dist/main.js', import.meta.url));
  const result = spawnSync(process.execPath, [entry], {
    cwd: tmpdir(),
    encoding: 'utf8',
    timeout: 5_000,
  });

  expect(process.versions).not.toHaveProperty('bun');
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe(
    'Daphne TypeScript workspace is ready. Application commands have not been migrated yet.\n',
  );
});

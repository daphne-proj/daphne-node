import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

const workspaceImportRestrictions = [
  {
    group: ['@daphne/*/src', '@daphne/*/dist', '**/src/**', '**/dist/**'],
    message:
      'Use public workspace exports; do not import source or build internals.',
  },
];

const libraryImportRestrictions = [
  ...workspaceImportRestrictions,
  {
    group: [
      '@daphne/cli',
      '@daphne/cli/**',
      '@daphne/eval',
      '@daphne/eval/**',
      '**/apps/**',
    ],
    message: 'Apps compose libraries; libraries must not import apps.',
  },
];

export default defineConfig(
  globalIgnores([
    '**/dist/**',
    '**/coverage/**',
    '**/fixtures/**',
    '.agents/**',
  ]),
  {
    files: ['**/*.{ts,mjs}'],
    rules: {
      curly: ['error', 'all'],
      'no-nested-ternary': 'error',
    },
  },
  { files: ['**/*.mjs'], extends: [js.configs.recommended] },
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ['vitest.config.ts'],
          defaultProject: 'tsconfig.tools.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    files: ['apps/*/src/**/*.ts', 'packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: workspaceImportRestrictions },
      ],
    },
  },
  {
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: libraryImportRestrictions },
      ],
    },
  },
  {
    files: [
      'packages/context-engine/src/contracts.ts',
      'packages/context-engine/src/limits.ts',
      'packages/context-engine/src/tools/contracts.ts',
      'packages/context-engine/src/evidence.ts',
      'packages/context-engine/src/assembly.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            {
              group: [
                '**/git/**',
                '**/acquisition/**',
                '**/tools/execute.js',
                '**/engine.js',
                '**/index.js',
                '@daphne/**',
              ],
              message:
                'Keep context contracts, evidence, and assembly independent of adapters and composition.',
            },
            {
              regex:
                '^(?:node:)?(?:fs|child_process|https?|http2|net|tls|dgram|dns|worker_threads|cluster|module|process)(?:/|$)',
              message: 'Keep filesystem, process, and network I/O in adapters.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message: 'Acquire evidence through the adapter before assembly.',
        },
        {
          name: 'process',
          message:
            'Pass configuration explicitly; keep process ownership in composition.',
        },
        {
          name: 'console',
          message: 'Return results and notices; let the caller present them.',
        },
      ],
    },
  },
);

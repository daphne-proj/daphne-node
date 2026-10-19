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

const prReviewImportRestriction = {
  group: [
    '@daphne/pr-review',
    '@daphne/pr-review/**',
    '**/pr-review',
    '**/pr-review/**',
  ],
  message: 'PR metadata is resolved by the host before Git acquisition.',
};

const gitSourceImportRestriction = {
  group: [
    '@daphne/git-source',
    '@daphne/git-source/**',
    '**/git-source',
    '**/git-source/**',
  ],
  message:
    'Git access belongs to git-source; the host composes acquisition and context.',
};

const downstreamImportRestriction = {
  group: [
    '@daphne/context-engine',
    '@daphne/context-engine/**',
    '**/context-engine',
    '**/context-engine/**',
    '@daphne/review-evidence',
    '@daphne/review-evidence/**',
    '**/review-evidence',
    '**/review-evidence/**',
  ],
  message:
    'Acquisition packages must not depend on evidence retrieval or context assembly.',
};

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
    files: ['packages/pr-review/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            gitSourceImportRestriction,
            downstreamImportRestriction,
          ],
        },
      ],
    },
  },
  {
    files: ['packages/git-source/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            prReviewImportRestriction,
            downstreamImportRestriction,
          ],
        },
      ],
    },
  },
  {
    files: ['packages/review-evidence/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            prReviewImportRestriction,
            {
              group: [
                '@daphne/context-engine',
                '@daphne/context-engine/**',
                '**/context-engine',
                '**/context-engine/**',
              ],
              message:
                'Evidence retrieval must not depend on context retention or assembly.',
            },
            {
              regex:
                '^(?:node:)?(?:fs|child_process|https?|http2|net|tls|dgram|dns|worker_threads|cluster|module|process)(?:/|$)',
              message: 'Repository I/O goes through the public git-source API.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/review-evidence/src/contracts.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**'],
              message:
                'Evidence data contracts must not import runtime or Git types.',
            },
          ],
        },
      ],
      'no-restricted-globals': ['error', 'fetch', 'process', 'console'],
    },
  },
  {
    files: ['packages/context-engine/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            prReviewImportRestriction,
            gitSourceImportRestriction,
          ],
        },
      ],
    },
  },
  {
    files: [
      'packages/git-source/src/contracts.ts',
      'packages/git-source/src/limits.ts',
      'packages/pr-review/src/limits.ts',
      'packages/review-evidence/src/limits.ts',
      'packages/context-engine/src/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...libraryImportRestrictions,
            prReviewImportRestriction,
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
                'Keep data contracts, limits and context assembly independent of I/O and runtime composition.',
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

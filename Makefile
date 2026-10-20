.DEFAULT_GOAL := help

.PHONY: help install build check lint format format-check typecheck test test-watch clean cli inspect split-pr

MODEL ?= gpt-6.1-sol
MAX_INPUT_TOKENS ?= 16384
export PR OUTPUT MODEL MAX_INPUT_TOKENS

help:
	@printf '%s\n' \
		'make install       Install dependencies from the lockfile' \
		'make build         Compile all workspaces' \
		'make check         Run formatting, lint, typechecks and existing tests' \
		'make lint          Run ESLint' \
		'make format        Format repository files' \
		'make format-check  Check formatting without changing files' \
		'make typecheck     Build and check TypeScript types' \
		'make test          Build and run Vitest' \
		'make test-watch    Build and start Vitest in watch mode' \
		'make clean         Remove TypeScript build outputs' \
		'make cli           Build and run the CLI without arguments' \
		'make inspect PR=https://github.com/OWNER/REPO/pull/123' \
		'                   Build and inspect into a new ignored outputs/context-* directory' \
		'                   Optional: OUTPUT=NEW_DIRECTORY overrides the default' \
		'make split-pr PR=https://github.com/OWNER/REPO/pull/123' \
		'                   Analyze diff pages with OpenAI and save outputs/split-pr-*/run.json' \
		'                   Optional: OUTPUT=NEW_DIRECTORY MODEL=gpt-6.1-sol MAX_INPUT_TOKENS=16384'

install:
	bun install --frozen-lockfile

build check lint format typecheck test clean:
	bun run $@

format-check:
	bun run format:check

test-watch:
	bun run test:watch

cli: build
	bun run cli

inspect:
	@test -n "$$PR" || { \
		printf '%s\n' 'Usage: make inspect PR=https://github.com/OWNER/REPO/pull/123 [OUTPUT=NEW_DIRECTORY]' >&2; \
		exit 1; \
	}
	bun run build
	@if test -z "$$OUTPUT"; then \
		mkdir -p outputs || exit 1; \
		OUTPUT="outputs/context-$$(date +%Y%m%d-%H%M%S)-$$$$"; \
	fi; \
	bun run cli -- context inspect --pr "$$PR" --output "$$OUTPUT"

split-pr:
	@test -n "$$PR" || { \
		printf '%s\n' 'Usage: make split-pr PR=https://github.com/OWNER/REPO/pull/123 [OUTPUT=NEW_DIRECTORY] [MODEL=gpt-6.1-sol] [MAX_INPUT_TOKENS=16384]' >&2; \
		exit 1; \
	}
	bun run build
	@if test -z "$$OUTPUT"; then \
		mkdir -p outputs || exit 1; \
		OUTPUT="outputs/split-pr-$$(date +%Y%m%d-%H%M%S)-$$$$"; \
	fi; \
	bun run cli -- split-pr --pr "$$PR" --output "$$OUTPUT" --model "$$MODEL" --max-input-tokens "$$MAX_INPUT_TOKENS"

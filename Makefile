.DEFAULT_GOAL := help

.PHONY: help install build check lint format format-check typecheck test test-watch clean cli inspect split-pr split-pr-case

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
		'                   Optional: TEST=PATH selects a package directory or test file' \
		'make test-watch    Build and start Vitest in watch mode' \
		'make clean         Remove TypeScript build outputs' \
		'make cli           Build and run the CLI without arguments' \
		'make inspect PR=https://github.com/OWNER/REPO/pull/123' \
		'                   Build and inspect into a new ignored outputs/context-* directory' \
		'                   Optional: OUTPUT=NEW_DIRECTORY overrides the default' \
		'make split-pr PR=https://github.com/OWNER/REPO/pull/123' \
		'                   Analyze diff pages with OpenAI and save outputs/split_pr_<pr_number>_<count>/run.json' \
		'                   Optional: OUTPUT=NEW_DIRECTORY MODEL=gpt-6.1-sol MAX_INPUT_TOKENS=16384' \
		'make split-pr-case PR=https://github.com/OWNER/REPO/pull/123' \
		'                   Save outputs/pr_123_1/run.json and draft cases/pr_123_1.json' \
		'                   Increment the suffix when occupied; no labels or suite registration' \
		'                   Optional: MODEL=gpt-6.1-sol MAX_INPUT_TOKENS=16384'

install:
	bun install --frozen-lockfile

build check lint format typecheck clean:
	bun run $@

test:
	bun run test $(TEST)

format-check:
	bun run format:check

test-watch:
	bun run test:watch

cli: build
	bun run cli

## Dapgne CLI

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
		pr_number=$$(cd apps/cli && node --input-type=module -e 'import { parsePullRequestUrl } from "@daphne/pr-review"; process.stdout.write(String(parsePullRequestUrl(process.env.PR ?? "").number));') || exit 1; \
		mkdir -p outputs || exit 1; \
		count=1; \
		OUTPUT="outputs/split_pr_$${pr_number}_$${count}"; \
		while test -e "$$OUTPUT" || test -L "$$OUTPUT"; do \
			count=$$((count + 1)); \
			OUTPUT="outputs/split_pr_$${pr_number}_$${count}"; \
		done; \
	fi; \
	bun run cli -- split-pr --pr "$$PR" --output "$$OUTPUT" --model "$$MODEL" --max-input-tokens "$$MAX_INPUT_TOKENS"

# Reserve a numbered name across concurrent imports; the CLI creates the run directory.
split-pr-case:
	@test -n "$$PR" || { \
		printf '%s\n' 'Usage: make split-pr-case PR=https://github.com/OWNER/REPO/pull/123 [MODEL=gpt-6.1-sol] [MAX_INPUT_TOKENS=16384]' >&2; \
		exit 1; \
	}
	bun run build
	@set -eu; \
	pr_number=$$(cd apps/cli && node --input-type=module -e 'import { parsePullRequestUrl } from "@daphne/pr-review"; process.stdout.write(String(parsePullRequestUrl(process.env.PR ?? "").number));'); \
	cases=apps/eval/datasets/split-pr/cases; \
	mkdir -p outputs "$$cases"; \
	sequence=1; \
	while :; do \
		case_id="pr_$${pr_number}_$${sequence}"; \
		directory="outputs/$$case_id"; \
		case_file="$$cases/$$case_id.json"; \
		lock="outputs/.$$case_id.lock"; \
		reservation_status=0; \
		node --input-type=module -e ' \
			import { mkdirSync } from "node:fs"; \
			try { \
				mkdirSync(process.argv[1]); \
			} catch (error) { \
				if (error.code !== "EEXIST") { throw error; } \
				process.exitCode = 2; \
			} \
		' "$$lock" || reservation_status=$$?; \
		if test "$$reservation_status" -eq 0; then \
			if ! test -e "$$directory" && ! test -L "$$directory" && ! test -e "$$case_file" && ! test -L "$$case_file"; then \
				break; \
			fi; \
			rmdir "$$lock"; \
		elif test "$$reservation_status" -ne 2; then \
			printf '%s\n' "Cannot reserve $$directory." >&2; \
			exit 1; \
		fi; \
		sequence=$$((sequence + 1)); \
	done; \
	trap 'rmdir "$$lock"' 0; \
	trap 'exit 130' 2; \
	trap 'exit 143' 15; \
	printf '%s\n' "Run artifact: $$directory/run.json" "Draft case: $$case_file"; \
	split_status=0; \
	bun run cli -- split-pr --pr "$$PR" --output "$$directory" --model "$$MODEL" --max-input-tokens "$$MAX_INPUT_TOKENS" || split_status=$$?; \
	if ! test -f "$$directory/run.json"; then \
		printf '%s\n' 'No run artifact was saved; no draft case was imported.' >&2; \
		exit 1; \
	fi; \
	bun run eval -- split-pr import --artifact "$$directory/run.json" --case-id "$$case_id" --output "$$case_file"; \
	exit "$$split_status"

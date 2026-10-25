.DEFAULT_GOAL := help

.PHONY: help install build check lint format format-check typecheck test test-watch clean cli inspect split-pr split-pr-eval split-pr-eval-all split-pr-langfuse-upload

MODEL ?= gpt-6.1-sol
MAX_INPUT_TOKENS ?= 16384
export PR OUTPUT MODEL MAX_INPUT_TOKENS CASE ARTIFACT RUN_DIR

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
		'                   Analyze diff pages with OpenAI and replace outputs/split_pr_<pr_number>/run.json' \
		'                   Optional: OUTPUT=DIRECTORY MODEL=gpt-6.1-sol MAX_INPUT_TOKENS=16384' \
		'make split-pr-eval CASE=apps/eval/datasets/split-pr/cases/pr_1.json ARTIFACT=outputs/split_pr_1/run.json' \
		'                   Compare saved groups with labels offline; drafts are provisional' \
		'                   Print results; optional OUTPUT=NEW_FILE outside the gold dataset' \
		'make split-pr-eval-all' \
		'                   Re-run every gold case; save run.json and eval.json together' \
		'make split-pr-langfuse-upload RUN_DIR=outputs/split-pr-eval-all.XXXXXX' \
		'                   Upload saved scores to Langfuse; no model calls'

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
		printf '%s\n' 'Usage: make split-pr PR=https://github.com/OWNER/REPO/pull/123 [OUTPUT=DIRECTORY] [MODEL=gpt-6.1-sol] [MAX_INPUT_TOKENS=16384]' >&2; \
		exit 1; \
	}
	bun run build
	@if test -z "$$OUTPUT"; then \
		pr_number=$$(cd apps/cli && node --input-type=module -e 'import { parsePullRequestUrl } from "@daphne/pr-review"; process.stdout.write(String(parsePullRequestUrl(process.env.PR ?? "").number));') || exit 1; \
		mkdir -p outputs || exit 1; \
		OUTPUT="outputs/split_pr_$${pr_number}"; \
	fi; \
	bun run cli -- split-pr --pr "$$PR" --output "$$OUTPUT" --model "$$MODEL" --max-input-tokens "$$MAX_INPUT_TOKENS"

split-pr-eval:
	@test -n "$$CASE" && test -n "$$ARTIFACT" || { \
		printf '%s\n' 'Usage: make split-pr-eval CASE=PATH ARTIFACT=PATH [OUTPUT=NEW_FILE]' >&2; \
		exit 1; \
	}
	@bun run --silent build
	@if test -n "$$OUTPUT"; then \
		bun run --silent eval -- split-pr eval --case "$$CASE" --artifact "$$ARTIFACT" --output "$$OUTPUT"; \
	else \
		bun run --silent eval -- split-pr eval --case "$$CASE" --artifact "$$ARTIFACT"; \
	fi

split-pr-eval-all:
	@bun run --silent build
	@set -- apps/eval/datasets/split-pr/cases/*.json; \
	test -f "$$1" || { \
		printf '%s\n' 'No gold JSON cases found.' >&2; \
		exit 1; \
	}; \
	mkdir -p outputs || exit 1; \
	run_dir=$$(mktemp -d outputs/split-pr-eval-all.XXXXXX) || exit 1; \
	printf 'Fresh model runs: %s\n' "$$run_dir"; \
	status=0; \
	for case_file do \
		case_name=$${case_file##*/}; \
		case_name=$${case_name%.json}; \
		reference="outputs/split_$${case_name}/run.json"; \
		fresh="$$run_dir/$$case_name/run.json"; \
		printf '\n%s\n' "$$case_name"; \
		pr_url=$$(node -e 'const run = require(process.argv[1]); if (typeof run.pr !== "string") process.exit(1); process.stdout.write(run.pr)' "./$$reference") || { status=1; continue; }; \
		bun run --silent cli -- split-pr --pr "$$pr_url" --output "$$run_dir/$$case_name" --model "$$MODEL" --max-input-tokens "$$MAX_INPUT_TOKENS" || { status=1; continue; }; \
		node -e 'const fs = require("node:fs"); const [reference, fresh] = process.argv.slice(1).map((path) => JSON.parse(fs.readFileSync(path, "utf8"))); const keys = ["repositoryUrl", "baseCommit", "targetCommit", "headCommit"]; if (keys.some((key) => !reference.identity?.[key] || reference.identity[key] !== fresh.identity?.[key])) { console.error("PR code changed since the gold capture; refusing to score."); process.exitCode = 1; }' "$$reference" "$$fresh" || { status=1; continue; }; \
		bun run --silent eval -- split-pr eval --case "$$case_file" --artifact "$$fresh" --reference "$$reference" --output "$$run_dir/$$case_name/eval.json" || status=1; \
	done; \
	exit "$$status"

split-pr-langfuse-upload:
	@test -n "$$RUN_DIR" || { \
		printf '%s\n' 'Usage: make split-pr-langfuse-upload RUN_DIR=outputs/split-pr-eval-all.XXXXXX' >&2; \
		exit 1; \
	}
	@bun run --silent build
	@bun run --silent eval -- split-pr upload --run-dir "$$RUN_DIR"

# Interchangeable model providers

## Goal and scope

Implement the approved chat plan with provider-only Makefile commands. OpenAI remains the default; Anthropic uses the same workflow contracts. Work is isolated from unrelated edits in the source checkout.

## Implementation

- [x] Extract a small `ModelClient` contract in `packages/llm`, retain OpenAI behavior, and add Anthropic generation, counting, replay, structured output, usage, and response validation using native fetch.
- [x] Resolve the chosen provider and its manually maintained default model once per command; keep API credentials in app composition. Carry provider/model through workflows, observations, artifacts and eval readers without changing domain validation.
- [x] Replace Makefile model selection with `PROVIDER=openai|anthropic`; keep the Codex evaluation judge separately configured. Update command help and package documentation.
- [x] Run existing checks and temporary offline assertions for new transport behavior, then independently review the complete diff. Add no repository tests unless existing tests require adjustment for the change.

## Decisions and review focus

- Keep the existing request fields and replayable output contract; adapters own provider wire conversion. Workflows do not inspect provider-specific payloads.
- Preserve raw provider responses, exact evidence, completed work, cancellation, per-call deadlines, and no transport retries.
- Old saved OpenAI artifacts retain their meaning. New artifacts identify their provider; readers validate raw responses with that provider's decoder.
- Defaults are manually maintained strings, as requested: `gpt-6.1-sol` and `claude-opus-5-5`. Do not reuse another provider's token count or send an Anthropic model to the Codex judge.
- Explicit model selection in existing library calls can remain for reproducibility. Makefile callers need only choose a provider.

## Progress

Worktree created from committed HEAD. The source checkout's unrelated edits were left untouched. Pinned Node 24.22.0 and Bun 1.4.3 are available under `/private/tmp/daphne-intentions-runtimes`; frozen installation succeeded after granting worktree write access.

Baseline `bun run check` passed (49 tests, 7 files). The user chose static model defaults instead of discovery. Anthropic does not echo prompts, so intention turns now retain the actual instructions for later evaluation.

Final `bun run check` passed: formatting, all workspace typechecks, lint, and 49 tests across 7 files. Temporary offline assertions passed for both providers: split corrections, writer/reviewer acceptance, saved-artifact validation, legacy OpenAI loading, native tool/thinking replay, schema/count consistency, usage, cancellation and failure handling. Existing tests changed only for the new factory mock and provider artifact field. Make command forwarding was checked with dry runs. Independent review found no actionable issues. Live provider compatibility and semantic quality were not exercised.

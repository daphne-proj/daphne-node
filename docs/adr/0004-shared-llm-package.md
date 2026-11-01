# ADR 0004: Shared LLM transport and usage parsing

- Status: accepted for the user-authorized rename and usage extraction
- Date: 2026-10-27

## Problem

`@daphne/review-agent` contains provider transport rather than a review workflow. Its name obscures reuse by other model-backed features. Meanwhile, eval interprets OpenAI's raw usage fields, so another application would have to duplicate that provider-specific parsing.

## Decision

Rename the existing package and folder to `@daphne/llm` and `packages/llm`. Keep one concrete OpenAI adapter with its existing `count`, `generate`, counters and observation callback. Move `normalizeModelUsage` and `TokenUsage` into this package, with local validation and public exports. Resolve the observation's model name from the provider response when available, falling back to the requested model.

Keep usage parsing independent of response acceptance: absent usage returns `null`, invalid supplied usage throws, and the eval recorder catches that error as a reporting issue. Completed generation remains completed, and rejected responses can still report consumed usage. Langfuse recording, its non-overlapping token buckets, artifact serialization and experiment accounting stay in eval. No telemetry, application or other workspace dependency enters the LLM package.

Prompts, schemas, capacity configuration, conversation identity/lifetime and semantic acceptance remain with their workflows. Context-engine continues to accept a counter callback without importing the provider. Update package imports, build references and lint restrictions together so the rename preserves enforced ownership.

### Conversation protocol amendment — 2026-10-31

The intentions writer and planned reviewer need identical count/generate/tool continuation mechanics. Export `runModelConversation` from LLM to manage exact request counting, capacity checks, full provider-output replay and sequential tool callbacks. It borrows the existing client, signal, request settings and a caller-owned history; it adds no provider abstraction, dependency, run budget, call quota or retry policy. Semantic split keeps its existing generation path and initial count reuse.

The caller synchronously records every completed reply and returns its retained turn reference. The helper returns that exact reference for a terminal reply and passes it to tool execution for diagnostic linkage. Recording failures propagate rather than being swallowed as telemetry failures. Completed replies are recorded before subsequent cancellation checks; terminal candidates remain available to the outer evaluator, while cancellation prevents further tools. Domain evidence, delivery receipts, role/candidate identity and artifacts remain in intentions. This separates reusable protocol from acceptance policy without duplicating conversation history.

## Consequences and alternatives

There is no compatibility wrapper under the old package name; all workspace consumers move together. Request bodies, generation settings, count reuse and artifact shapes remain unchanged. Workflow error reclassification is a separate change because CLI categories and saved error names currently depend on `ModelError`.

Splitting counting from generation would separate shared request preparation and failure handling. Adding a generic provider framework is unnecessary while there is one implemented provider. Revisit configuration and provider interfaces when a real caller needs another setting or provider.

See the [package overview](../../packages/llm/README.md) for the public APIs and official provider documentation. This refactoring does not establish Rust behavior parity.

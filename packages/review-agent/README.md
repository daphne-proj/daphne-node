# Review agent

`@daphne/review-agent` owns model calls. Its current implementation is a concrete OpenAI Responses adapter used by the semantic-split workflow.

## What belongs here

- Provider HTTP requests, request deadlines, cancellation and safe provider errors.
- Token counting and generation from the caller's supplied instructions, input and optional response schema.
- Provider response validation, answer extraction and preservation of reasoning/assistant output items for replay.
- Counters for attempted count and generation requests.

`createOpenAI` returns `count`, `generate` and `calls`. The package also exports `ModelError` and the `ModelRequest`/`ModelReply` types. Credentials, model and cancellation signal are passed explicitly.

Answer text excludes assistant commentary. Complete output items, including commentary and phase metadata, remain available for replay; messages without a phase retain their existing answer behavior.

## Boundaries

| Responsibility                                                                    | Owner                              |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| Prompts, grouping history, coverage checks, repair evidence and correction limits | `semantic-split`                   |
| Context rendering, packing and fragmentation                                      | `context-engine`                   |
| PR workflow and Git cleanup                                                       | `pr-review`                        |
| Git access and source evidence                                                    | `git-source` and `review-evidence` |
| Environment loading, output and artifact persistence                              | The calling app                    |

This package has no workspace dependencies. It returns replayable output; the domain workflow decides what to retain and whether to request another turn. See [architecture](../../docs/architecture.md).

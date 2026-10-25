# PR intentions agent

## Agreed flow

Explain a PR to its reviewer through an ordered series of intention cards: title, before, after, why, and source evidence. Intentions describe the overall change and may share evidence. They are independent of semantic chunks; the semantic splitter remains unchanged.

Use one agent in `@daphne/intentions`. Give it the complete supported diff and PR description, then let it inspect either revision through existing read-only tools. Start with the eight `daphne-proj/pr-review-test` examples. Measure explanation quality, tokens and latency before introducing more orchestration.

## Architecture

Follow [ADR 0002](../../adr/0002-context-engine-boundary.md), [ADR 0003](../../adr/0003-reusable-pr-split-workflow.md), and [workspace architecture](../../architecture.md).

| Owner                  | Responsibility                                                                                                             |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `pr-review/intentions` | Resolve PR metadata, acquire pinned revisions, collect the diff, lend tool execution, and close Git after investigation.   |
| `git-source`           | Immutable snapshots, comparison and exact repository reads. BASE is the merge base, not the target branch tip.             |
| `review-evidence`      | List, inspect, search and source-read tools, including line-based surrounding reads; source provenance and pagination.     |
| `context-engine`       | Retain supplied evidence, reject conflicts, and assemble bounded packets. It receives no Git handle or retrieval callback. |
| `intentions`           | Investigation policy, prompts, provider-tool definitions, conversation history, card schema and citation validation.       |
| `review-agent`         | Provider transport, token counting, validated function calls and replayable model output.                                  |
| CLI / evaluation app   | Configuration, files, presentation, measurements and evaluation.                                                           |

Libraries import public exports. Intentions uses context-engine and review-agent at runtime and evidence contracts as types; its caller supplies tool execution. PR acquisition's root export stays metadata-only. Add no reverse dependencies or generic agent framework.

## Evidence and outcomes

Before/after claims cite supplied code or explicit change metadata, including added/deleted files. A reason is author-stated with a PR-description citation, inferred with supporting evidence, or unknown. Exact citations establish where evidence came from; human evaluation determines whether it supports the explanation.

Retain the full change inventory, hunk-to-evidence mapping, tool results, notices and completed model turns. Only evidence actually delivered to the model is citable. Search previews require a source read before they become code evidence. Resolve displayed snippets from source bytes rather than asking the model to reproduce code.

Add `read_source_lines(side, path, startLine, lineCount)` alongside the existing byte reader. The agent can request any changed or unchanged file in either pinned revision and expand its reads after searching. Review-evidence converts one-based lines into exact byte ranges; context-engine retains the supplied result. Preserve raw source text and expose window location separately. Reuse bounded responses and cursors, report EOF clamping, and return recoverable guidance for out-of-range starting lines. This is a retrieval improvement; RCI's utility remains unproven and will be assessed from observed navigation failures.

An empty PR returns no cards without a model call. Unsupported content and unavailable optional context remain visible limitations. Missing required diff evidence, exceeded budgets, invalid final output, cancellation and provider failures produce a failed result with collected work. Never silently truncate the diff or label failed work complete. Preserve investigation and cleanup errors separately.

## Approach and limits

The selected approach is one agent with a full initial diff and targeted tools. A diff-only request cannot investigate relevant unchanged code. Multiple agents add coordination and synthesis work that the current examples do not justify. RCI/PCG, context compaction, recursive summaries, UI implementation and automated semantic scoring are deferred.

The implementation plan proposes explicit budgets and bounded correction behavior. Existing 64 KiB packet and 4 MiB retention defaults stay unchanged; larger configured limits must propagate through assembly and snapshot validation. Diff paging and semantic-split behavior stay unchanged.

Success means useful, distinct cards whose before/after explanations are accurate and whose reasons are appropriately qualified. Existing split pair labels do not measure this. New tests are not authorized by the repository instructions; existing checks and manual acceptance remain required, with that verification gap reported.

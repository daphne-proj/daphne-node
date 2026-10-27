# Libraries

Each library's README summarizes its purpose, public APIs, main types, dependencies and flow.

| Package                                      | Responsibility                                                                              |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [PR review](pr-review/README.md)             | Resolve GitHub PR metadata and orchestrate split and intentions workflows with Git cleanup. |
| [Git source](git-source/README.md)           | Pin repository snapshots, list changes, read exact blobs and search committed files.        |
| [Review evidence](review-evidence/README.md) | Materialize source excerpts with provenance and expose bounded repository tools.            |
| [Context engine](context-engine/README.md)   | Retain supplied evidence, build bounded packets and split diff context into pages.          |
| [Semantic split](semantic-split/README.md)   | Group changes by intention, validate coverage and coordinate bounded corrections.           |
| [Intentions](intentions/README.md)           | Investigate PR changes and validate before/after/reason cards with citations.               |
| [LLM](llm/README.md)                         | Count model input, generate replies and validate provider responses.                        |

The [CLI](../apps/cli/README.md) composes these libraries for users; [eval](../apps/eval/README.md) evaluates frozen cases and saved outputs. Import compiled public exports, not another workspace's source files.

See [architecture](../docs/architecture.md) for ownership and [CONTRIBUTING.md](../CONTRIBUTING.md) for package conventions.

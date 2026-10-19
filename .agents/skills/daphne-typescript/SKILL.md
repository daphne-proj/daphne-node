---
name: daphne-typescript
description: Use when implementing, refactoring, or reviewing TypeScript, Node ESM, Bun workspace configuration, or package boundaries in Daphne Node.
---

# Daphne TypeScript reference

Read [TypeScript quality](../../../docs/agents/typescript-quality.md) for the repository's coding conventions. For package/config changes, read [contributing](../../../CONTRIBUTING.md) and [architecture](../../../docs/architecture.md).

| Task                                      | Reference                                                    |
| ----------------------------------------- | ------------------------------------------------------------ |
| Compiler, Node/Bun, dependencies, exports | `CONTRIBUTING.md` and `docs/adr/0001-node-bun-typescript.md` |
| Test design and commands                  | `docs/agents/testing.md`; load the `vitest` skill as needed  |
| Rust behavior or serialized contracts     | Load `daphne-migration-parity`                               |

Resolve these paths from the repository root. Use the commands defined in `package.json`; `bun run check` is the full local gate. Repo policy is maintained in these linked documents, not duplicated in this skill.

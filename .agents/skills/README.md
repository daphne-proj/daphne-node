# Repository skills

| Skill                     | Activation                   | Purpose                                             |
| ------------------------- | ---------------------------- | --------------------------------------------------- |
| `daphne-typescript`       | TypeScript/tooling work      | Routes to local TS, Bun, Node, and package policies |
| `daphne-migration-parity` | Migration/compatibility work | Routes to baseline and behavioral parity references |
| `vitest`                  | Test work                    | Pinned upstream Vitest API reference                |
| `shape`                   | Explicit only                | Pressure-test an unresolved concept                 |
| `external-research`       | Explicit only                | Separate external evidence from interpretation      |
| `disposable-prototype`    | Explicit only                | Settle a decision with a bounded experiment         |
| `decisions-to-spec`       | Explicit only                | Turn resolved decisions into a specification        |
| `proposal-audit`          | Explicit only                | Review a proposal or implementation critically      |

The five existing reasoning workflows retain their `agents/openai.yaml` activation settings and shared [context contract](references/context-contract.md). Their existing evaluations are in [evals](evals/README.md).

The local TS/migration skills are small reference routers; repository policy stays in `docs/agents/` and `docs/migration/`. Vitest is vendored from `antfu/skills` with its MIT license. The source commit and SHA-256 hashes of every imported file are in [skills-sources.json](../skills-sources.json). Do not load every skill at once or copy the Rust skill into this TypeScript repository.

To review reference routing, check that a TypeScript/config task finds `daphne-typescript`, a Rust parity task finds `daphne-migration-parity`, and a test task finds `vitest`; follow each linked policy before answering. New API references must agree with installed versions. For example, `bun run test` selects this repository's Vitest script, and byte-offset migration must consult the parity document rather than using JavaScript string offsets directly.

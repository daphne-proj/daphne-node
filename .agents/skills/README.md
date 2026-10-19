# Repository skills

| Skill                             | Activation                                      | Purpose                                                          |
| --------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| `daphne-typescript`               | TypeScript/tooling work                         | Routes to local TS, Bun, Node, and package policies              |
| `daphne-code-readability`         | Changed TS code and readability reviews         | Focused clarity pass preserving behavior                         |
| `codebase-design`                 | Module contract design and architecture changes | Small public interfaces, information hiding, and change locality |
| `daphne-migration-parity`         | Migration/compatibility work                    | Routes to baseline and behavioral parity references              |
| `typescript-types`                | Type modelling                                  | Inference, unknown values, assertions, and type imports          |
| `typescript-discriminated-unions` | Variant modelling                               | Mutually exclusive states and exhaustive handling                |
| `property-based-testing`          | Invariant/parity testing                        | Generators, reference comparisons, and counterexamples           |
| `vitest`                          | Test work                                       | Pinned upstream Vitest API reference                             |
| `shape`                           | Explicit only                                   | Pressure-test an unresolved concept                              |
| `external-research`               | Explicit only                                   | Separate external evidence from interpretation                   |
| `disposable-prototype`            | Explicit only                                   | Settle a decision with a bounded experiment                      |
| `decisions-to-spec`               | Explicit only                                   | Turn resolved decisions into a specification                     |
| `proposal-audit`                  | Explicit only                                   | Review a proposal or implementation critically                   |

The five existing reasoning workflows retain their `agents/openai.yaml` activation settings and shared [context contract](references/context-contract.md). Their existing evaluations are in [evals](evals/README.md).

The local TS/migration skills are small reference routers; repository policy stays in `docs/agents/` and `docs/migration/`. Vitest is vendored from `antfu/skills` with its MIT license. The source commit and SHA-256 hashes of every imported file are in [skills-sources.json](../skills-sources.json). Do not load every skill at once or copy the Rust skill into this TypeScript repository.

To review reference routing, check that a TypeScript/config task finds `daphne-typescript`, a Rust parity task finds `daphne-migration-parity`, and a test task finds `vitest`; follow each linked policy before answering. New API references must agree with installed versions. For example, `bun run test` selects this repository's Vitest script, and byte-offset migration must consult the parity document rather than using JavaScript string offsets directly.

The three additional skills were installed through the Skills CLI; `skills-lock.json` records their source paths and installer hashes. Their upstream commit revisions were not recorded by that installer. Local file hashes and license paths are recorded in `.agents/skills-sources.json`; upstream license notices are in `.agents/licenses/`. Their content is preserved as installed and excluded from formatting. Repository runtime, test-runner, and migration policies continue to take precedence. Installing the property-testing skill does not add `fast-check` or change the test runner.

`daphne-code-readability` is locally authored guidance, not a vendored upstream skill. It routes to the readability policy and is required for changed TypeScript implementation/refactoring by `AGENTS.md`. Its prose complements the enforced ESLint rules; it does not replace formatter, type, or behavior checks.

`codebase-design` is vendored unchanged from a pinned `mattpocock/skills` commit, including its two supporting references and agent metadata. The MIT license is in `.agents/licenses/mattpocock-skills.txt`; `.agents/skills-sources.json` records the revision and file hashes. Use it with `docs/architecture.md` when designing module contracts. Daphne terminology and explicit task constraints remain authoritative; the skill does not require renaming our APIs, adding speculative adapters, deleting existing tests, or running parallel design exploration for every change.

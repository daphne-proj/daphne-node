---
name: daphne-migration-parity
description: Use when porting Rust behavior to TypeScript in Daphne, comparing cross-runtime outputs, or reviewing migration fixtures and compatibility claims.
---

# Daphne migration references

Read [the parity checklist](../../../docs/migration/parity.md) before implementing or reviewing a port. Read [the migration sequence](../../../docs/migration/README.md) for dependency order and `docs/migration/reference.json` for the pinned source and baseline status.

The parity document covers JSON, identifiers, UTF-8/UTF-16 positions, collections, incomplete evidence, Git/filesystem behavior, async work, and persistence. Select the boundaries touched by the current slice. It also defines the evidence required before recording the slice as migrated.

Resolve paths from this repository. For target test layout and offline execution, read [testing](../../../docs/agents/testing.md); use the `vitest` skill for API details.

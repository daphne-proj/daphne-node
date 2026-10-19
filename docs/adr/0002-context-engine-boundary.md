# ADR 0002: Separate PR acquisition from reusable context

- Status: accepted
- Date: 2026-10-19

## Problem

The first workflow starts with a GitHub PR URL, but context retrieval and assembly must also work for callers that already have repository locations and revisions. Accepting `ResolvedPullRequest` in Git acquisition would couple that API to the first caller's transport.

## Decision

Use the already planned `@daphne/pr-review` package for URL parsing, GitHub metadata, authentication and HTTP limits/errors. It returns validated repository URLs and exact target/head commit IDs. It has no runtime dependencies and reads no environment variables.

Introduce `@daphne/context-engine` in Task 2, when its first Git-backed behavior exists. It owns repository/revision input contracts, immutable snapshots, retrieval, retained evidence and bounded assembly. The host explicitly copies the relevant values from PR metadata into those input contracts. Neither package imports the other in this slice, including types.

The CLI owns argument parsing, environment configuration, the overall acquisition deadline, cancellation and output. The PR package bounds each metadata request; later Git acquisition will also bound its own operation. Sharing a caller signal preserves an overall deadline without sharing configuration or a base class.

Keep Git access inside context-engine initially, but keep evidence retention and assembly independent of Git implementations. RCI/PCG retain indexing and qualified semantic navigation ownership. This slice introduces no indexes, provider framework or model loop.

## Alternatives

- Keeping PR acquisition in context-engine would expose GitHub-specific inputs/configuration through the reusable package.
- Keeping HTTP logic in the CLI would put reusable acquisition behavior in an application.
- A generic acquisition package or provider registry has no current need. The existing pr-review ownership is sufficient.
- A provider SDK would add a dependency for one metadata endpoint. Native Node fetch provides the required cancellation and streaming controls.

## Consequences and limits

The package boundary makes ownership explicit and adds one workspace manifest/build reference. Typed values are still validated at external boundaries. Static import restrictions supplement source review; they do not prove every runtime dependency.

The resolver rejects redirects, noncanonical URLs, private repositories and unavailable head repositories. It constructs trusted URLs instead of following response-provided clone links. It bounds body consumption and returns sanitized errors; raw response bodies, tokens and caller abort reasons are not attached to errors.

Only PR metadata resolution is implemented in Task 1. It does not prove that commits can be fetched, calculate a merge base or establish Rust compatibility. The planned context engine remains a Git-backed comparison engine, not a universal storage or single-revision abstraction.

## Revisit when

A concrete additional host/provider needs shared acquisition orchestration, a second consumer needs standalone Git access, or a single-revision workflow requires a different context-session contract. Revisit the relevant interface then, preserving source identity and the PR-independent context boundary.

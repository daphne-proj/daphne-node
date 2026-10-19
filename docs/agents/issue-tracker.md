# Issue tracker

During migration, issues and specifications remain on `daphne-proj/daphne`. This repository's Git remote is `daphne-proj/daphne-node`; do not infer the issue tracker from that remote.

Use explicit repository selection, for example `gh issue view 123 --repo daphne-proj/daphne --comments` or `gh issue list --repo daphne-proj/daphne`. Publish or comment only when authorized. For multiline bodies, write the exact text to a file and use `--body-file`.

Reference the originating issue and Rust baseline in migration changes. See [triage-labels.md](triage-labels.md) for label roles. Moving the tracker requires an explicit project decision.

# Rust-to-TypeScript parity reference

Before a port, record the source commit, entry points, callers, fixtures, output formats, and error behavior. Capture expected results from Rust before replacing the behavior. Keep this evidence attached to the slice or issue.

| Boundary          | What to check                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------- |
| JSON              | Field spelling, enum tags, null versus omitted fields, integer range, ordering if observable |
| Identity/hash     | Byte encoding, canonicalization, algorithm, stable IDs; never substitute a convenient hash   |
| Source positions  | UTF-8 bytes versus UTF-16 code units, CRLF, Unicode, invalid encodings                       |
| Collections       | Rust ordered/unordered behavior, explicit output sorting, tie-breaks, duplicate handling     |
| Evidence          | Missing, unknown, unsupported, invalid, and empty are distinct states                        |
| Filesystem/Git    | Path quoting, symlinks, unusual names, revision validation, subprocess failures              |
| Async/external IO | Cancellation, timeouts, retry scope, bounded concurrency, resource cleanup                   |
| Persistence       | Schema/version compatibility, atomicity, partial writes, recovery                            |

Keep raw fixtures byte-for-byte. Any normalization must name the nondeterministic field and be justified; it must not hide a meaningful difference. Include successful, malformed, missing-data, Unicode, and boundary-value cases relevant to the slice.

Compare exact deterministic outputs where contractual, plus invariants and failure semantics. TypeScript compilation proves type consistency, not runtime input validity or Rust compatibility. A mismatch must be fixed or accepted as an explicit product/architecture decision before the slice is called migrated.

At completion report source revision, cases compared, checks run, unresolved differences, and dependencies still running in Rust. Update `reference.json`'s migrated list only after those checks pass.

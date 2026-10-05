# Marketplace record preservation — 2026-10-05

This record preserves existing project history before the Agent Boards provider work. It is a snapshot, not a new completion or acceptance decision.

- Source: original Marketplace checkout, branch `fix/ao-local-nats-autostart`, Git HEAD `2f37fcbb63992f6624d1267c2c97dc7529c8c411` plus its existing uncommitted records.
- Destination baseline: develop `4697a2e01422241a9224bed9feb364a584ef0fcd`; preservation branch `chore/preserve-marketplace-records-20261005`.
- Captured at: 2026-10-05T07:48:29.724670+00:00.
- Preserved: 288 task records, evidence files and historical retirement files; 33 knowledge documents, event-history and tracked rollup files. Total: 321 files, 16192750 bytes.
- Every copied original is byte-identical to the captured source and was checked against the destination baseline before replacement. Source files were checked again after copying; detected drift: 0 files.
- Snapshot digest: `81dbf64c931fa0392c5d6fead7ab429ff2b4d5696dbb96b2e8cbf0d99df13bdc`. Computed as SHA-256 of the sorted original path and SHA-256 pairs, each encoded as `path`, a NUL byte, the file digest and a newline. This evidence note is excluded from that digest.
- Knowledge JSON and each nonblank JSONL record parsed successfully. Other JSON evidence was syntax-checked without rewriting it.
- A bounded private-key, known-token, credential-URL and credential-value scan found no candidates. This is a limited pattern check, not a guarantee that all historical prose is suitable for every audience.

The historical `history/marketplace-copy-20261004` records remain intact, including colliding historical ADR identities and retirement provenance. Task status, acceptance, timestamps, comments, links and evidence were not rewritten. Preservation does not upgrade any old test, review, runtime or delivery claim.

Task policy (`config.json`), AO sessions, agent tooling, dashboard assets, ignored task indexes/events/state, caches and nested checkouts are outside this preservation change. They require their own reviewed handling. No task CLI mutation, migration, service operation or Git mutation was performed by the copying worker.

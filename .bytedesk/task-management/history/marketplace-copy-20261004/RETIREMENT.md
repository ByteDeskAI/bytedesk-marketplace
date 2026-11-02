# Marketplace copy retirement

The duplicate `/home/ryan/Documents/GitHub/bytedesk-marketplace (copy)` was retired on 2026-10-04 after its agent sessions were idle and its background writers were stopped. The real repository remains `/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace`.

## Integrated work

- Imported 13 knowledge decisions and their distinct history; knowledge reindex and validation passed for 49 concepts.
- Preserved 10 older ADRs and one process-compose plan in this historical directory. Nine ADR IDs conflict with current decisions; these originals are historical evidence, not active decisions.
- Restored PR 150 to TM-186 and retained the historical worker-exited comments in TM-205 and TM-235. Current status and acceptance fields were unchanged.
- Preserved all 61 Git references under `refs/archive/marketplace-copy-20261004/`, including the stash. Every source reference was checked against its preserved SHA. All source local branch tips already existed in the real repository.
- Kept the real repository's current tool configuration. The copy's differences were obsolete paths or older graft launch syntax. Nested worktree changes were generated tool configuration, preserved in the full archive.

## Preservation and verification

All 24 imported documents matched source SHA-256 hashes. The full archive includes Git storage, the nested worktree, ignored files, task logs, repeated automated comments and runtime history. It matched the source byte-for-byte immediately before deletion. Runtime records were not replayed over newer canonical task state.

Recovery archive and removal evidence: `/home/ryan/Backups/marketplace-copy-final-20261004-005304/`. The archive is `checkout.tar`; verify with `sha256sum -c SHA256SUMS` from that directory. Restoring the original location recreates the nested worktree's original absolute Git references; do not extract over an existing checkout.

The copy folder and Gateway project `proj-44ddc3ba44cae446` were removed. The canonical project `proj-e24d014a541601c1` remains. The retired pool, supervisor, dashboard and finished terminal sessions were stopped; the other process-compose services kept their original PIDs. Five obsolete copy-specific Claude plugin registrations were removed.

Imported changes remain local and uncommitted alongside existing work. The repository design-pattern check reports existing project metadata, review-evidence and stale-worktree-path errors; this cleanup did not change those configuration files.

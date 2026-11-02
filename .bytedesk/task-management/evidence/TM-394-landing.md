# TM-394 landing

- PR #198 merged to main at 3a9b4112dc57b5d5c8c3f2dce0b45507a15c3ca2 (head 469dd905).
- Review: R1 CHANGES_REQUESTED, R2 APPROVE at 278c916d, delta APPROVE at 9d0a5f73 (safe-git routing). Record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/198#issuecomment-6072994647
- CI green; local suite 1260/3 with the 3 identical on main (TM-306 env).
- Root cause of the /tmp-backed worktree: an ad-hoc command during the v0.2.2 release (2026-08-26), not shipped code.
- Follow-ups: TM-420 (unmounted mount point), TM-421 (clear verb + staging hardening).

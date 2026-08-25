---
name: design-system-doctor
description: Diagnose a ByteDesk design-system consumer by checking managed-file integrity, product selection, runtime token wiring, design inheritance, agent instructions, and CI. Use when adoption, sync, or build integration is unhealthy.
---

# Design System Doctor

Resolve the plugin root as two directories above this `SKILL.md`. From the
consumer root, run `node <plugin>/scripts/design-system-sync.mjs --doctor`.

Treat the result by category:

- `DRIFT`: run `--dry-run`, review the plan, then sync; never repair managed
  files by hand.
- Managed configuration errors: restore the recorded app and metadata through
  the sync workflow rather than inventing state.
- Runtime adapter errors: wire the managed CSS, stamped Go inline, or native
  JSON mapping appropriate to the detected runtime.
- `DESIGN.md` or `AGENTS.md` errors: restore shared → profile → local reading
  order without copying upstream prose.
- CI errors: add an installed-runtime `--check` gate to pull requests.

After fixes, rerun both `--doctor` and the consumer's relevant build. Report
remaining findings and their exact fix; do not silently downgrade failures.

# TM-392 landing

- PR #194 (tm/TM-392-project-scope-guard) merged into fix/ao-local-nats-autostart at 2a4a694d5dc716cf2c73896d854b3dabaf6742bf, at the reviewed head 3890fbfc.
- Scope follows Ryan's 2026-10-05 decision (asked by the marketplace lead): AGENTS.md wins, and no tool edits another repo's settings. The original criteria for auto-repair and AGENTS.md exceptions were superseded. The lead-startup criteria were split out to TM-398.
- AC1 (guard precision): the PreToolUse guard is deleted, so no Bash command is gated by text matching any more. The false positive cannot recur. A test asserts that hooks.json has no PreToolUse gate.
- Independent review: APPROVE. Record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/194#issuecomment-5995048657
- The reviewer found no surviving caller of the deleted scripts, including `.teamcity/`, `scripts/git-hooks/`, other plugins and `dist/`. The old installed hook blocked (exit 1) while the check script was present and allowed the commit (exit 0) once it was gone.
- Checks: test:unit exit 0 (1041/0/4); build:check exit 0; CI green (check, unit-build-contracts, Strict installed-cache contract, test-build-install).
- Rollout: machines whose plugin copy has not updated keep the old hook until `claude plugin update agent-orchestration@bytedesk` runs, or `ao-topology git-hook uninstall` removes it.
- Follow-up: the help text at topology/cli.mjs:151 is updated after PR #192.

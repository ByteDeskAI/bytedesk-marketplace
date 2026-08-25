---
name: design-system-sync
description: Preview and apply an update to an already-managed ByteDesk design-system payload, including checksum verification, stale-file cleanup, and profile protection. Use when updating a consumer; not for first adoption or submodule migration.
---

# Design System Sync

Resolve the plugin root as two directories above this `SKILL.md`, then work from
the consumer repository root.

1. Confirm `.context/design-system/.design-system.json` exists and names the
   intended product. Do not switch profiles as part of a routine update.
2. Run `node <plugin>/scripts/design-system-sync.mjs --dry-run`. Summarize the
   source revision and every add/change/delete operation. Unexpected profile or
   broad deletion changes require investigation before applying.
3. Run the sync without `--dry-run`. Replacement is atomic and removes stale
   managed files; do not copy payload files manually.
4. Run `--check`, followed by the consumer's smallest relevant build or token
   gate. Review the Git diff, including local adapter changes prompted by the
   new upstream contract.
5. Commit the managed update and any necessary consumer adapter changes together.

Exit codes are `0` healthy, `1` content drift, `2` consumer configuration error,
and `3` tool or payload failure. Do not mask a nonzero exit.

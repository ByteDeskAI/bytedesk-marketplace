---
name: design-system-migrate
description: Plan and perform a reviewed migration from a legacy ByteDesk design-system submodule or unmanaged copy to the checksummed managed plugin payload. Use when `.context/design-system` is a Git checkout, gitlink, or hand-maintained vendor tree.
---

# Design System Migrate

Resolve the installed plugin root and start with its executable preflight:

`node <plugin>/scripts/design-system-init.mjs migrate --app <slug> --dry-run`

Before removing a submodule, gitlink, or directory, show the exact targets and
obtain explicit user authorization. Stop if the legacy checkout has uncommitted
work or its source revision cannot be recorded.

After authorization, rerun with `--apply`. The executable:

1. Record the old source SHA and product slug in the migration diff or PR.
2. Removes only the verified submodule registration/gitlink or clean tracked
   manual snapshot; dirty legacy content is a hard stop.
3. Installs the checksummed managed payload.
4. Updates imports, local design/agent inheritance, `.envrc`, and CI to the same
   `.context/design-system` managed path. Remove redundant vendored token copies.
5. Runs doctor and prints the review diff. Run the consumer build and confirm Git records
   ordinary managed files rather than a gitlink.

Migration does not authorize a profile switch or unrelated design changes.

---
name: design-system-migrate
description: Plan and perform a reviewed migration from a legacy ByteDesk design-system submodule or unmanaged copy to the checksummed managed plugin payload. Use when `.context/design-system` is a Git checkout, gitlink, or hand-maintained vendor tree.
---

# Design System Migrate

Start with a read-only preflight: inspect `.gitmodules`, the gitlink status,
local changes inside the submodule, current source SHA, selected profile, token
imports, `.envrc`, CI, and any files outside the mount derived from it.

Before removing a submodule, gitlink, or directory, show the exact targets and
obtain explicit user authorization. Stop if the legacy checkout has uncommitted
work or its source revision cannot be recorded.

After authorization:

1. Record the old source SHA and product slug in the migration diff or PR.
2. Remove only the verified submodule registration, gitlink, and module metadata;
   do not use broad recursive cleanup.
3. Run the installed sync runtime with `--app <slug> --dry-run`, review it, then
   apply. The runtime intentionally refuses to overwrite a Git checkout.
4. Update imports, local design/agent inheritance, `.envrc`, and CI to the same
   `.context/design-system` managed path. Remove redundant vendored token copies.
5. Run `--doctor`, `--check`, and the consumer build. Confirm Git now records
   ordinary managed files rather than a gitlink.

Migration does not authorize a profile switch or unrelated design changes.

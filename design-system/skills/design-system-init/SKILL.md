---
name: design-system-init
description: Adopt the ByteDesk design system in an existing repository by selecting its product profile, installing the managed payload, and wiring design context, tokens, agents, and CI. Use for first-time adoption; use design-system-migrate for an existing submodule.
---

# Design System Init

Work from the consumer repository root. Resolve the installed plugin root as two
directories above this `SKILL.md`; do not assume a provider-specific cache path.

1. Resolve the installed plugin root, then run:

   `node <plugin>/scripts/design-system-init.mjs --app <slug> --dry-run`

   Omit `--app` only when the repository or package name exactly matches one
   available profile. The executable refuses ambiguous identity and runtime
   detection instead of guessing.
2. Review the complete managed payload, instruction, runtime-adapter, consumer
   config, and CI plan. Apply with the same command without `--dry-run`.
3. The executable preserves product-local prose outside its marker blocks,
   vendors a standalone CI integrity checker, runs doctor, and prints the Git
   status/stat as a ready-to-review adoption diff.
4. Run the consumer's build or test command, then commit the managed payload and
   integration files. Builds never depend on the machine-local plugin cache.

For an existing submodule or manual snapshot, use the migration skill and the
same executable's `migrate` command.

Never edit managed files. Upstream changes belong in `ByteDeskAI/design-system`.

---
name: design-system-init
description: Adopt the ByteDesk design system in an existing repository by selecting its product profile, installing the managed payload, and wiring design context, tokens, agents, and CI. Use for first-time adoption; use design-system-migrate for an existing submodule.
---

# Design System Init

Work from the consumer repository root. Resolve the installed plugin root as two
directories above this `SKILL.md`; do not assume a provider-specific cache path.

1. Inspect the repository runtime and its product identity. If the product slug
   is ambiguous, show the profile directories under `<plugin>/payload/profiles/`
   and ask the user—never guess a sibling product.
2. Run `node <plugin>/scripts/design-system-sync.mjs --app <slug> --dry-run`.
   Review the exact destination and add/change/delete plan, then run the same
   command without `--dry-run`.
3. Make the repository root `DESIGN.md` inherit, in order,
   `.context/design-system/DESIGN.md` and the selected profile. Add the same
   reading order to `AGENTS.md`. Keep only consumer-specific exceptions locally.
4. Wire the runtime adapter described by the managed `tokens/README.md`: CSS and
   Tailwind imports for web, generated stamped CSS for Go-embedded UIs, or JSON
   token mappings for native code.
5. Add a pull-request CI step running the installed sync runtime with `--check`.
6. Run `--doctor`, fix each actionable finding outside the managed directory,
   and rerun until healthy. Tell the user to commit `.context/design-system/`
   because builds do not have a plugin layer.

Never edit managed files. Upstream changes belong in `ByteDeskAI/design-system`.

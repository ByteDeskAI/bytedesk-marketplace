---
name: design-system-scaffold
description: Create a new ByteDesk Next.js site with canonical token imports, product identity, consumer adapters, and a starter upstream profile, then install the managed design payload. Use for greenfield sites; use design-system-init for an existing repository.
---

# Design System Scaffold

The zero-dependency scaffold lives in a checkout of `ByteDeskAI/design-system`;
the installed plugin provides delivery and validation. Resolve the plugin root
as two directories above this `SKILL.md`.

1. Settle the lowercase kebab-case slug, display name, and one existing product
   accent (`platform`, `gateway`, `vault`, `store`, `workforce`,
   `agent-browser`, `agent-memory`, or `capture`). Never invent an accent.
2. From the canonical source checkout run:

   `node scaffold/create.mjs <target> <slug> --accent <product> --name "<name>" --no-submodule`

   Use `--no-profile` only when an approved profile already exists. Do not use
   `--force` without reviewing the exact existing target files.
3. From the generated repository run the installed sync runtime with
   `--app <slug>`, then install dependencies and run the production build.
4. Replace starter profile prompts with real product decisions in the upstream
   source, catalog the profile, validate, publish, and resync the generated site.
5. Run `--doctor` and commit `.context/design-system/` with the consumer adapter.

The scaffold is a wrapper, not finished product content. Continue implementation
under the shared foundation, selected profile, and local adapter. Consume
`--bd-*`, keep identity separate from semantic state, honor reduced motion, and
never edit the managed delivery tree.

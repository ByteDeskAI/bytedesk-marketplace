---
name: design-system-tokens
description: Author or review canonical ByteDesk design-token changes across DTCG JSON, CSS custom properties, Tailwind mappings, accessibility notes, and consumer contracts. Use only for shared token decisions in the design-system source repository.
---

# Design System Tokens

Work in the canonical design-system repository and read `DESIGN.md` plus
`tokens/README.md` first.

1. Confirm the value is shared across products. Product-only semantic aliases
   belong in the owning profile or consumer token root.
2. Change `tokens/bytedesk.tokens.json` first. Preserve DTCG-style type, value,
   and decision-relevant descriptions.
3. Update `tokens/css/bytedesk.css` and `tokens/tailwind/theme.css` to remain
   equivalent. Preserve product scoping, runtime theme boundaries, contrast
   guidance, and reduced-motion behavior.
4. Search consumers and profiles for contract impact. Do not introduce raw
   literals as a migration shortcut.
5. Run the repository validator and all tests. Review cross-runtime fixtures,
   update `CHANGELOG.md`, and publish only from a clean committed revision.

Do not edit a consumer's managed token files; sync the published payload.

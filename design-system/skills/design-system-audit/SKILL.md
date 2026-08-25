---
name: design-system-audit
description: Audit a consumer UI or implementation against the inherited ByteDesk foundation, selected product profile, canonical tokens, accessibility rules, and local exceptions. Read-only unless the user separately asks for fixes.
---

# Design System Audit

1. Establish authority in order: managed `DESIGN.md`, selected profile, then the
   consumer root `DESIGN.md`. Record the managed source SHA.
2. Run the installed runtime with `--check` and `--doctor`. A corrupted or
   miswired design system is a prerequisite failure, not a visual observation.
3. Inspect the implementation for invented visual literals, wrong product
   identity, inaccessible contrast or focus, color-only state, missing reduced
   motion, broken responsive behavior, and divergence from profile-specific
   component/content rules.
4. Separate shared-system gaps from consumer violations. Recommend an upstream
   token/profile change only when the owning authority is genuinely shared.
5. Report findings by severity with file and line evidence, the violated rule,
   and a concrete correction. Include verified strengths briefly so the review
   is calibrated.

Do not modify source during an audit. If the user asks to fix findings, apply the
narrowest changes and rerun the relevant gates.

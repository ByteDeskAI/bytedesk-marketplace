---
name: design-system-agents
description: Route ByteDesk profile architecture, token/accessibility audits, consumer migrations, and implementation reviews to four governed specialist roles. Use when Codex cannot load plugin-native agents, when the user asks which specialist should handle design-system work, or when executing one of those roles inline.
---

# Design-system specialist roles

Use this as the provider-portable fallback for the plugin's four native agent
roles. Do not copy or install agent files into the consumer.

1. Read `../../agent-catalog.json` relative to this skill.
2. Select exactly one role from its trigger and safety metadata:
   - authority, inheritance, or profile ownership → `profile-architect`;
   - tokens, WCAG, contrast, focus, or motion → `token-accessibility-auditor`;
   - adoption, submodule, snapshot, or migration → `consumer-migration-specialist`;
   - implementation, diff, pull request, or design drift → `design-system-reviewer`.
3. Read the matching `../../agents/<name>.md` as the canonical role contract.
4. Discover the design kit with the bundled `design-system` MCP tools. If MCP
   is unavailable, use `bin/bd-design list` and `inspect` from the installed
   plugin; do not invent or hard-code an inventory.
5. Follow the selected role's allowed actions, non-goals, evidence rules, and
   required output headings exactly.

Read-only roles must not mutate files. The migration role remains read-only for
inspection and dry-run requests. Mutation requires an explicit user request to
migrate and a separately reviewed dry-run; apply only through the canonical
`design-system-migrate` workflow.

When intent genuinely spans roles, complete the highest-risk role first and
name the next role instead of blending their authority or safety boundaries.

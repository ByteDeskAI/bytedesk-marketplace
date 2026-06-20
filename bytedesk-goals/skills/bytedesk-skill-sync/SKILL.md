---
name: bytedesk-skill-sync
description: >-
  Keep Codex/Grok skill state (.agents/skills) in parity with the canonical
  Claude skills (.claude/skills). Use when a skill was edited under
  .claude/skills and Codex/Grok need the update, when "sync skills to .agents",
  "skill parity", "port the skill to codex/grok", "update agents skills", or
  after landing any change to a skill the agents also use. Reports drift
  (--check) or mirrors it (--apply). Root docs (CLAUDE.md/AGENTS.md) are
  report-only because AGENTS.md carries intentional Codex/Grok divergences.
user-invokable: true
argument-hint: "[check|apply]"
allowed-tools:
  - Bash
  - Read
---

## Mission

Ryan runs Claude **and** Codex **and** Grok in this repo. `.claude/skills` is the
source of truth; `.agents/skills` is the Codex/Grok mirror. Editing a skill once
shouldn't mean hand-copying it into `.agents` — this skill reconciles them.

## Procedure

1. See the drift (read-only, safe):
   ```bash
   skill-sync            # --check report
   skill-sync --json
   ```
   It prints, per skill name:
   - **missing** — in `.claude/skills`, absent from `.agents/skills`
   - **stale** — a `.claude` file is missing/differs in `.agents`
   - **agents-only** — in `.agents` only; *kept as-is*, never deleted
   - **externally-managed (symlinked)** — `.agents` entries that are symlinks to
     marketplace sources (e.g. `stripe-*`); *skipped*, never mirrored or followed

2. Review the stale list. Most are safe (the `bytedesk-*` + workflow skills).
   **Before applying, check whether any `.agents` SKILL.md has intentional
   Codex/Grok-specific wording you'd clobber** — `AGENTS.md` itself diverges from
   `CLAUDE.md` on purpose, so a skill could too. If a skill's `.agents` copy is
   intentionally different, leave it (the mirror would overwrite it).

3. Apply the mirror when the drift is just stale/missing canonical content:
   ```bash
   skill-sync --apply
   ```
   **Additive + non-destructive:** it copies each `.claude` file over its
   `.agents` counterpart and creates missing ones, but never deletes agent-only
   files (runtime `state/`, agent-specific scripts) and never touches symlinked
   marketplace entries.

## Boundaries

- **Root docs are report-only.** skill-sync flags when `CLAUDE.md` ≠ `AGENTS.md`
  but never overwrites `AGENTS.md` — it carries intentional Codex/Grok guidance
  (e.g. release-via-Office-chat). Reconcile those by hand: `diff CLAUDE.md AGENTS.md`.
- **No deletions.** Agent-only skills and files are preserved; removing a skill
  from `.agents` is a manual decision.
- Run after landing a skill change so the next Codex/Grok session sees it.

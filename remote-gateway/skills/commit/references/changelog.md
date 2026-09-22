# Changelog entry guide (this repo)

Source of truth: repo-root `CHANGELOG.md`.  
Embed for production: `src/embedded_changelog.md` (always `cp` after edit).

## Shape

```markdown
# Changelog

All notable changes to **bytedesk-remote-gateway** are documented in this file.
...

---

## [YYYY-MM-DD]

### Added

- feat(scope): **Short title** — one-line operator-facing detail

### Changed

- feat(scope): description of behavior change

### Fixed

- fix(scope): description of the bug and fix

---

## [older-date]
...
```

## Rules

1. **Newest date first** (immediately under the intro `---`).
2. Reuse today’s `## [YYYY-MM-DD]` if it already exists; do not invent a second
   section for the same day.
3. Prefer one dense bullet per user-visible theme. Split only when Added vs
   Fixed clearly differ.
4. Lead with conventional prefix used in git subjects: `feat(…)`, `fix(…)`,
   `ops(…)`, `chore(…)`, etc.
5. Bold a short product phrase when the entry is a feature operators will scan
   for (`**Resizable desk panes**`).
6. No agent/tool names in changelog bullets.
7. After every edit: `cp CHANGELOG.md src/embedded_changelog.md`.

## Mapping from git diff → section

| Diff theme | Section |
|------------|---------|
| New UI/API capability | Added |
| Behavior or layout change | Changed |
| Bug fix / regression | Fixed |
| Deleted endpoint/UI | Removed |
| Skill/docs-only scaffolding | Added or Changed under `chore(skills)` / `docs` |

## Example (projects resize)

```markdown
## [2026-08-11]

### Added

- feat(projects): **Resizable left/right panes** — drag file-tree and git/files/assistant dock widths; persist per project in localStorage (`bd.gateway.projects.chrome.*`)
```

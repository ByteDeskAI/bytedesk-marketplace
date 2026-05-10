# Version enforcement before commit

Before creating any commit that ships changes to a plugin under `<repo>/`, decide whether a version bump is required and apply it. This is a **gitflow-style semver** policy: the size of the bump is determined by the *kind* of change, not by branch shape.

The rule applies to the `fleet` plugin today and to any future plugin added under the marketplace. Do **not** skip the bump just because the change is small — the version is what `claude-sessions-web`'s reuse-or-reload check (BDM-44) and the marketplace listing rely on.

## When a bump is required

A bump is required for any commit that touches:

- `<plugin>/` directory contents — bash CLI, hooks, skills, monitors, web dashboard server, web SPA, systemd units, docs that ship in the plugin
- `fleet/web/server/dist/` (committed bundle) — even if only the build artifact changed
- `fleet/.claude-plugin/plugin.json` itself — implies a metadata change

A bump is **not** required for repo-only files that don't ship in the plugin: top-level `CLAUDE.md`, `.claude/rules/`, `.claude/settings.json`, root `README.md`, repo-level `.gitignore`. Use judgment — when in doubt, bump.

## Choosing the bump size

| Bump | When | Examples |
|---|---|---|
| **major** (`X.0.0`) | Breaking change to a plugin's public surface, OR the user explicitly says "bump major". | Removing a CLI flag, renaming a slash command, changing the meta-file schema, splitting a plugin in two. |
| **minor** (`X.Y.0`) | A new plugin is added to the marketplace, OR a plugin gains a new major piece of functionality that didn't exist before, OR the user explicitly says "bump minor". | A new top-level command, a new skill, a new dashboard page, a new monitor, new MCP integration, a new wire-shape (e.g. a new HTTP endpoint family). |
| **patch** (`X.Y.Z`) | Default for everything else — bug fixes, polish, refactors, doc updates, dep bumps, config tweaks, performance work, small additions to existing surfaces. | The user-bubble color change, an additional tool visualizer in an existing registry, a faster reconcile loop, a typo in CHANGELOG. |

If the user explicitly says "bump major" / "bump minor" / "bump patch", honor that override even if the heuristic says otherwise.

## What to update in lockstep

Every bump must update **all five** of these markers in a single commit. Mismatches break the reuse-or-reload check + the marketplace listing.

For `fleet` specifically:

| File | Field |
|---|---|
| `fleet/.claude-plugin/plugin.json` | `"version"` |
| `.claude-plugin/marketplace.json` | top-level `"version"` AND `plugins[*].version` for the matching plugin |
| `fleet/web/package.json` | `"version"` |
| `fleet/web/server/server.go` | `const buildVersion = "vX.Y.Z-<tag>"` — keep the trailing `-<tag>` (e.g. `-bdm44`) so it advances even when only the patch number is unchanged. |
| `fleet/CHANGELOG.md` | new section under `## [X.Y.Z] — <date>` with **Added / Changed / Fixed / Removed / Build** subsections as relevant. Date is today (use `currentDate` from your context). |

For a future plugin under `<plugin>/`: same five-marker structure; only the file paths change.

## Workflow

1. **Pull latest first.** Background sessions / other branches may have already shipped a bump; using a stale version would either overwrite their work or land on an outdated baseline. Stash WIP if you have uncommitted changes.
   ```bash
   # If you have uncommitted local changes:
   git stash push -m "version-bump-rebase"
   # Always:
   git fetch origin main
   git pull --ff-only origin main
   # Then restore WIP:
   git stash pop   # only if you stashed
   ```
   If `git pull --ff-only` fails (you have local commits ahead of `origin/main`), rebase: `git pull --rebase origin main`. Do NOT skip this step — landing a version that's already on `main` produces a no-op tag and a broken reuse-or-reload check.

2. After pulling, check current versions:
   ```bash
   grep -E '"version"|buildVersion' \
     fleet/.claude-plugin/plugin.json \
     fleet/web/package.json \
     fleet/web/server/server.go \
     .claude-plugin/marketplace.json
   ```
3. Decide the bump category using the table above (compare against what's now on disk, post-pull).
4. Update all five markers + write the CHANGELOG entry.
5. Run typecheck / build / tests so the new version compiles into the binary.
6. Commit with a message that calls out the version bump (e.g. `fleet: release vX.Y.Z — short summary`).
7. The CHANGELOG block should reference Jira ticket keys (`BDM-N`) for traceability and group bullets under Added/Changed/Fixed/Removed/Build per Keep a Changelog.
8. `git push origin main` — re-pull if the push is rejected (someone else committed during steps 4–7) and re-bump if their commit also bumped.

## When to skip

You may skip the bump only when:

- The commit is **purely repo-level** (no `<plugin>/` content, no `dist/` change, no plugin manifest change). Examples: editing `CLAUDE.md`, adding/editing `.claude/rules/*`, adding to `.gitignore`.
- The user explicitly says "no version bump" / "skip bump".
- The commit is a fixup of the *same* version's content within seconds of a prior bump (e.g. correcting a typo in the CHANGELOG entry that's already in the staged commit) — but prefer `git commit --amend` in that case.

## Why this rule exists

`claude-sessions-web` decides whether to reuse a running dashboard or preempt + take over by comparing the running server's `/api/version` against its own `buildVersion` (BDM-44). Forgetting to bump `buildVersion` makes the new binary look identical to the old one, the launch flow short-circuits "reuse", and the new code never runs. Pair that with stale `marketplace.json` and `/plugin update` decides nothing is new — the user keeps running the old plugin.

The full set has to advance together for reuse-or-reload, marketplace updates, and `npm`/`go` build hashes to all line up.

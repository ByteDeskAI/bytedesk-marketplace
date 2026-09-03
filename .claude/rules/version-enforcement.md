# Version enforcement before commit

Before creating any commit that ships changes to a plugin under `<repo>/`, decide whether a version bump is required and apply it. This is a **gitflow-style semver** policy: the size of the bump is determined by the *kind* of change, not by branch shape.

The rule applies to the `fleet` plugin today and to any future plugin added under the marketplace. Do **not** skip the bump just because the change is small — the version is what `claude-sessions-web`'s reuse-or-reload check (BDM-44) and the marketplace listing rely on.

## When a bump is required

A bump is required for any commit that touches:

- `<plugin>/` directory contents — bash CLI, hooks, skills, monitors, web dashboard server, web SPA, systemd units, docs that ship in the plugin
- `fleet/web/server/dist/` (committed bundle) — even if only the build artifact changed
- `fleet/.claude-plugin/plugin.json` itself — implies a metadata change

**The marketplace top-level `version` bumps on EVERY commit that touches any `<plugin>/` directory — no exceptions.** This holds even when the plugin itself carries no version marker (see *Versionless plugins* below). It is the only thing a remote client compares; a plugin dir can change 25 times, and if `.claude-plugin/marketplace.json`'s top-level `version` never moves, `/plugin marketplace update` reports "already at the latest version" and every external install keeps serving stale code. Local installs never show this — a `directory`-source marketplace is read live off disk, so the bug is invisible on the authoring machine.

A bump is **not** required for repo-only files that don't ship in the plugin: top-level `CLAUDE.md`, `.claude/rules/`, `.claude/settings.json`, root `README.md`, repo-level `.gitignore`. Use judgment — when in doubt, bump.

## Choosing the bump size

| Bump | When | Examples |
|---|---|---|
| **major** (`X.0.0`) | Breaking change to a plugin's public surface, OR the user explicitly says "bump major". | Removing a CLI flag, renaming a slash command, changing the meta-file schema, splitting a plugin in two. |
| **minor** (`X.Y.0`) | A new plugin is added to the marketplace, OR a plugin gains a new major piece of functionality that didn't exist before, OR the user explicitly says "bump minor". | A new top-level command, a new skill, a new dashboard page, a new monitor, new MCP integration, a new wire-shape (e.g. a new HTTP endpoint family). |
| **patch** (`X.Y.Z`) | Default for everything else — bug fixes, polish, refactors, doc updates, dep bumps, config tweaks, performance work, small additions to existing surfaces. | The user-bubble color change, an additional tool visualizer in an existing registry, a faster reconcile loop, a typo in CHANGELOG. |

If the user explicitly says "bump major" / "bump minor" / "bump patch", honor that override even if the heuristic says otherwise.

## What to update in lockstep

Every bump must update **all** of a plugin's version markers in a single commit. Mismatches break the reuse-or-reload check + the marketplace listing.

**No plugin carries a version on the Claude side.** As of 2026-09-03 all 18 plugins have no `"version"` key in `<plugin>/.claude-plugin/plugin.json` and none in their `.claude-plugin/marketplace.json` entry — verified across the whole marketplace. That is the intended state (see *Versionless plugins* below): it lets each plugin resolve to its git commit SHA. **Never add a `version` to either of those two files.** Earlier revisions of this rule listed them as markers for `fleet` and `design-patterns`; that was stale and the tables below are corrected.

The semvers that DO exist live in the other ecosystems' manifests and in build strings, because Codex, Grok, Kimi and npm consumers resolve a real version rather than a SHA.

For `fleet` (all three live markers currently read `1.16.2`):

| File | Field |
|---|---|
| `.claude-plugin/marketplace.json` | top-level `"version"` — **always**, for any plugin change |
| `fleet/.codex-plugin/plugin.json` | `"version"` |
| `fleet/web/package.json` | `"version"` |
| `fleet/web/server/server.go` | `const buildVersion = "vX.Y.Z-<tag>"` — keep the trailing `-<tag>` (e.g. `-bdm51`) so it advances even when the patch number is unchanged. |
| `fleet/CHANGELOG.md` | new section under `## [X.Y.Z] — <date>` with **Added / Changed / Fixed / Removed / Build** subsections as relevant. Date is today (use `currentDate` from your context). |

For `design-patterns` (a Python plugin — no `web/` SPA or Go server; all three live markers currently read `0.9.2`):

| File | Field |
|---|---|
| `.claude-plugin/marketplace.json` | top-level `"version"` — **always**, for any plugin change |
| `design-patterns/.codex-plugin/plugin.json` | `"version"` |
| `design-patterns/lib/pattern_mcp_server.py` | `SERVER_INFO = {... "version": "X.Y.Z"}` |
| `design-patterns/lib/workbench_views.py` | the `vX.Y.Z` display string |
| `design-patterns/CHANGELOG.md` | new section under `## [X.Y.Z] — <date>` with **Added / Changed / Fixed / Removed / Build** subsections as relevant. Date is today (use `currentDate` from your context). |

Other plugins carry non-Claude semvers too — `design-system` at `1.5.4` across `.codex-plugin`, `.grok-plugin`, `kimi.plugin.json` and `package.json`; `teamcity-mcp` at `0.2.0` across `package.json`, `manifest.json`, `gemini-extension.json` and `server.ts`; `agent-orchestration` at `package.json` `0.2.0` while `src/mcp.mjs` advertises `0.2.3`; the seven `platform-*` plugins and `bytedesk-goals`/`omnigent-dev`/`structurizr` at `.codex-plugin` `0.1.1`. **Before bumping any plugin, grep for its actual markers rather than trusting this list** — these drift, and several are stale today:

```bash
grep -rnE '"version"|buildVersion|SERVER_INFO' <plugin>/ \
  --include='*.json' --include='*.go' --include='*.py' --include='*.ts' --include='*.mjs' \
  | grep -vE 'node_modules|/evals/|/dist/|package-lock'
```

Filter the results before believing them. Eval workspaces and run artifacts record the version of the *tool that produced them* — `bytedesk-designer` has 14 `state.json` files reading `"version": "codex-cli 0.146.0"`, none of which is a plugin marker. A marker is a version this repo is responsible for advancing; anything stamped by an external tool is data.

For any other future plugin under `<plugin>/`: replicate whichever of these markers the plugin actually has — the invariant is that every version-carrying file the plugin ships, plus its `marketplace.json` entry, advance together in one commit.

### Versionless plugins

"Versionless" here means **Claude-side only**, and it is true of every plugin in this marketplace without exception: no `version` in `<plugin>/.claude-plugin/plugin.json`, none in the `marketplace.json` entry. That is deliberate — a pinned entry version freezes the plugin at that string, so the absence lets it resolve to the git commit SHA and every commit becomes a new version automatically. Do **not** add a `version` to either file for any plugin, ever.

Be precise about the distinction: a plugin can be Claude-side versionless and still carry a real semver for another ecosystem. `structurizr`, `bytedesk-goals`, `omnigent-dev` and the seven `platform-*` plugins all declare `0.1.1` in `.codex-plugin/plugin.json` while being versionless to Claude. Some plugins — `task-management`, `bytedesk-designer`, `agentconf`, `plugin-rsync`, `design-patterns`' Claude manifest — genuinely carry no version anywhere on the Claude path.

Versionless does not mean bump-free. For a plugin with no ecosystem semver of its own, the required markers are:

| File | Field |
|---|---|
| `.claude-plugin/marketplace.json` | top-level `"version"` — **always** |
| `<plugin>/CHANGELOG.md` | new `## [Unreleased]` / dated section, if the plugin keeps one |

Nothing else. The top-level marketplace version is the whole gate, which is exactly why forgetting it is silent.

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
   # Top-level marketplace version (the always-bump field), then the plugin's own markers.
   # NOTE: fleet/.claude-plugin/plugin.json has no version key — do not add one.
   grep -E '^  "version"' .claude-plugin/marketplace.json
   grep -rnE '"version"|buildVersion' \
     fleet/.codex-plugin/plugin.json \
     fleet/web/package.json \
     fleet/web/server/server.go
   ```
3. Decide the bump category using the table above (compare against what's now on disk, post-pull).
4. Update every marker the grep found + write the CHANGELOG entry.
5. Run typecheck / build / tests so the new version compiles into the binary.
6. Commit with a message that calls out the version bump (e.g. `fleet: release vX.Y.Z — short summary`).
7. The CHANGELOG block should reference Jira ticket keys (`BDM-N`) for traceability and group bullets under Added/Changed/Fixed/Removed/Build per Keep a Changelog.
8. **Before pushing, verify the marketplace version actually moved.** This is the check that catches the silent failure:
   ```bash
   # Any plugin dir touched since the last top-level marketplace version bump?
   # -G, not -S: a bump keeps the occurrence count identical, so -S misses it.
   # The 2-space indent pins it to the top-level field, not a plugin entry's.
   last=$(git log -1 --format=%H -G'^  "version"' -- .claude-plugin/marketplace.json)
   git log --oneline "$last"..HEAD --name-only | grep -oE '^[a-z][a-z0-9-]*/' | sort -u
   ```
   Output must be empty. Anything listed is a plugin whose changes remote clients cannot see — bump the top-level `version` before you push.
9. `git push origin main` — re-pull if the push is rejected (someone else committed during steps 4–7) and re-bump if their commit also bumped.

## When to skip

You may skip the bump only when:

- The commit is **purely repo-level** (no `<plugin>/` content, no `dist/` change, no plugin manifest change). Examples: editing `CLAUDE.md`, adding/editing `.claude/rules/*`, adding to `.gitignore`.
- The user explicitly says "no version bump" / "skip bump".
- The commit is a fixup of the *same* version's content within seconds of a prior bump (e.g. correcting a typo in the CHANGELOG entry that's already in the staged commit) — but prefer `git commit --amend` in that case.

## Why this rule exists

`claude-sessions-web` decides whether to reuse a running dashboard or preempt + take over by comparing the running server's `/api/version` against its own `buildVersion` (BDM-44). Forgetting to bump `buildVersion` makes the new binary look identical to the old one, the launch flow short-circuits "reuse", and the new code never runs. Pair that with stale `marketplace.json` and `/plugin update` decides nothing is new — the user keeps running the old plugin.

The full set has to advance together for reuse-or-reload, marketplace updates, and `npm`/`go` build hashes to all line up.

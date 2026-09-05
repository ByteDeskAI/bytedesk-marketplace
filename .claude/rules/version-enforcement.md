# Versioning for this marketplace

How versions work for Claude Code plugins, what this marketplace does, and what you must do
before committing. The rules here are grounded in the official documentation, not in local
convention — where the two disagree, the docs win and this file gets corrected.

Sources: [plugins-reference](https://code.claude.com/docs/en/plugins-reference#version-management),
[plugin-marketplaces](https://code.claude.com/docs/en/plugin-marketplaces),
[discover-plugins](https://code.claude.com/docs/en/discover-plugins).

## The official model

**`version` is optional everywhere.** The JSON schemas require only `name` in
`<plugin>/.claude-plugin/plugin.json`, and only `name`, `owner`, `plugins` in
`.claude-plugin/marketplace.json`. Nothing here is schema-invalid for omitting it.

**Declaring a `version` PINS the plugin.** Verbatim: "If set (here or in `plugin.json`), the
plugin is pinned to this string and users only receive updates when it changes." Push new commits
without bumping the string and existing users keep the cached copy.

**Omitting it resolves the version instead.** Resolution order:

1. `version` in `<plugin>/.claude-plugin/plugin.json`
2. `version` in the plugin's `marketplace.json` entry
3. **git-based sources → the resolved commit SHA**
4. `archive` sources → the archive's `sha256`
5. `npm` sources → the resolved npm version
6. `command` sources → a hash of the command's output

**Omitting is the documented best practice for us.** Verbatim: "For git-based sources, if you omit
`version`, Claude Code uses the source's resolved commit SHA, so users get an update whenever that
commit changes; this is the simplest setup for internal or actively developed plugins."

**Never declare `version` in both places.** "Claude Code always uses the `plugin.json` value
without warning, so a stale manifest version can mask a version you set in `marketplace.json`."

**The top-level `marketplace.json` `version` is manifest metadata.** The docs describe it only as
"Marketplace manifest version" and it appears nowhere in the resolution order above. **It does not
gate whether consumers receive updated plugin content — do not treat it as a release gate.**
Bumping it is harmless bookkeeping; forgetting it breaks nothing. An earlier revision of this file
claimed the opposite, and was wrong.

## What this marketplace does

All 18 plugins are **Claude-side versionless**: no `version` in
`<plugin>/.claude-plugin/plugin.json`, none in their `marketplace.json` entry. Every plugin
resolves to the marketplace repo's commit SHA, so every pushed commit is a new version and
consumers update automatically.

**This is correct and deliberate. Do not add a `version` to either of those two files.** Doing so
pins the plugin and silently stops consumers from receiving commits.

Plugins may still carry a real semver for *other* ecosystems (Codex, Grok, Kimi, npm, MCP server
identity), which resolve a version string rather than a SHA. Claude-side versionless and
Codex-side `0.1.1` are not in conflict — they are different consumers.

## Validation

`claude plugin validate ./<plugin>` **passes** (with a warning) for a versionless plugin, and so
does `claude plugin validate .` for the marketplace. That warning — "No version specified.
Consider adding a version following semver" — is advisory, and following it would pin the plugin.

**Do not use `--strict` as a gate in this repo.** It promotes that advisory warning to an error, so
it fails on all 18 plugins as a direct consequence of our deliberate choice. Use plain `validate`;
treat the version warning as expected and everything else as real.

## When a version bump is required

Only for a plugin's **own ecosystem semver** — the markers it actually ships. There is no
Claude-side version to bump.

A bump is required when a commit changes a plugin's shipped content *and* that plugin declares a
semver for another ecosystem. Not required for repo-level files (`CLAUDE.md`, `.claude/rules/`,
`.claude/settings.json`, root `README.md`, `.gitignore`).

| Bump | When |
|---|---|
| **major** | Breaking change to the plugin's public surface, or the user says "bump major". |
| **minor** | New major functionality — a new command, skill, dashboard page, monitor, MCP integration, endpoint family — or the user says "bump minor". |
| **patch** | Default for everything else: fixes, polish, refactors, docs, deps, config, perf. |

Explicit user instruction always overrides the heuristic.

### Markers, by plugin

Every marker a plugin ships must advance together in one commit.

For `fleet` (all three currently `1.16.2`):

| File | Field |
|---|---|
| `fleet/.codex-plugin/plugin.json` | `"version"` |
| `fleet/web/package.json` | `"version"` |
| `fleet/web/server/server.go` | `const buildVersion = "vX.Y.Z-<tag>"` — keep the `-<tag>` (e.g. `-bdm51`) so it advances even when the patch number does not. |
| `fleet/CHANGELOG.md` | new `## [X.Y.Z] — <date>` section (Added / Changed / Fixed / Removed / Build). Date is today (`currentDate`). |

For `design-patterns` (Python; all three currently `0.9.2`):

| File | Field |
|---|---|
| `design-patterns/.codex-plugin/plugin.json` | `"version"` |
| `design-patterns/lib/pattern_mcp_server.py` | `SERVER_INFO = {... "version": "X.Y.Z"}` |
| `design-patterns/lib/workbench_views.py` | the `vX.Y.Z` display string |
| `design-patterns/CHANGELOG.md` | new dated section as above. |

Others carry ecosystem semvers too — `design-system` `1.5.4` across `.codex-plugin`,
`.grok-plugin`, `kimi.plugin.json`, `package.json`; `teamcity-mcp` `0.2.0` across `package.json`,
`manifest.json`, `gemini-extension.json`, `server.ts`; `agent-orchestration` `package.json` `0.2.0`
while `src/mcp.mjs` advertises `0.2.3`; `structurizr`, `bytedesk-goals`, `omnigent-dev` and the
seven `platform-*` plugins at `.codex-plugin` `0.1.1`. **Grep for a plugin's real markers rather
than trusting this list** — it drifts:

```bash
grep -rnE '"version"|buildVersion|SERVER_INFO' <plugin>/ \
  --include='*.json' --include='*.go' --include='*.py' --include='*.ts' --include='*.mjs' \
  | grep -vE 'node_modules|/evals/|/dist/|package-lock'
```

Filter before believing. Eval workspaces and run artifacts record the version of the *tool that
produced them* — `bytedesk-designer` has 14 `state.json` files reading `"codex-cli 0.146.0"`, none
a marker. A marker is a version this repo advances; anything stamped by an external tool is data.

A plugin with no ecosystem semver — `task-management`, `bytedesk-designer`, `agentconf`,
`plugin-rsync` — needs only its `CHANGELOG.md` entry, if it keeps one.

## Workflow

1. **Pull first.** `git fetch origin main && git pull --ff-only origin main` (stash WIP, or
   `git pull --rebase origin main` if you have local commits).
2. Grep the plugin's real markers (command above) against what is now on disk.
3. Pick the bump size from the table.
4. Update every marker found + write the CHANGELOG entry referencing `TM-nnn` / `EP-nnn` keys, grouped per
   Keep a Changelog.
5. Run typecheck / build / tests so the version compiles in.
6. Commit with a message naming the bump (`<plugin>: release vX.Y.Z — summary`).
7. `git push origin main` — re-pull and re-bump if rejected.

## When consumers report stale plugin content

Do not reach for a version bump. For versionless plugins there is nothing to bump, and the
top-level marketplace version does not gate delivery. Check, in order:

1. **Did they update the plugin, not just the marketplace?** Different operations.
   `/plugin marketplace update` refreshes the catalog; `claude plugin update <plugin>@bytedesk`
   updates an installed plugin, and needs a restart to apply.
2. **Is auto-update off?** Background auto-update (random delay up to ten minutes after startup)
   is **enabled by default only for official Anthropic marketplaces**. Third-party and local
   marketplaces default to **disabled**, so consumers must update explicitly.
3. **Is the content actually published?** Diff a fresh clone of the remote default branch against
   local; confirm the commits are on `origin/main`.
4. **Is their plugin cache stale?** Clear `~/.claude/plugins/cache/` and re-run the marketplace
   update.

A `directory`-source marketplace — how this repo is registered on the authoring machine — is read
live off disk, so the author always sees the newest code and cannot reproduce a consumer's
staleness locally. Never conclude delivery is fine because it works here.

## When to skip

- Purely repo-level commits (no plugin content, no plugin manifest change).
- The user says "no version bump" / "skip bump".
- A fixup of the same version's content seconds after a bump — prefer `git commit --amend`.

## Why this rule exists

Pinning is silent. Declare a `version`, forget to bump it, and consumers keep the cached copy with
no error anywhere — the plugin simply stops updating. Omitting the field is what keeps this
marketplace's commits flowing automatically, and re-adding one "for tidiness" is the single most
damaging edit anyone can make to these manifests.

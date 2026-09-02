# Installing into another repository

What a consumer repo needs, in the order it needs it. The setup below assumes a **local
directory marketplace**: a clone of `bytedesk-marketplace` sitting next to your repo, the
way every ByteDesk consumer is wired. The GitHub path (`/plugin marketplace add
ByteDeskAI/bytedesk-marketplace`) differs in step 1's source block and in what `<plugin>`
resolves to; the order and the contracts are the same.

Steps 1 through 4's bootstrap, gate, doctor and Codex hook file ran as written against a
scratch repo with a clean `HOME` (TM-082 — transcript attached to that task's evidence).
The `codex mcp add` / `grok mcp add` registrations are the README's capability matrix,
measured against the installed CLIs, not re-run here. Where a claim could not be run, it
says so.

## 1. Register the marketplace

Handwrite `.claude/settings.json` in the consumer repo:

```json
{
  "extraKnownMarketplaces": {
    "bytedesk": {
      "source": { "source": "directory", "path": "../bytedesk-marketplace" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "task-management@bytedesk": true
  }
}
```

- The path is **relative to the repo's main checkout** — a git worktree resolves it through
  `--git-common-dir`, so one file serves every worktree. Never an absolute path: that bakes
  one machine's home directory into a file every clone shares.
- The marketplace key must be `bytedesk`. The project launchers look the declaration up by
  that name (`lib/launcher.mjs`), and `task-management@bytedesk` must match the marketplace's
  `.claude-plugin/marketplace.json`. Enabling the plugin without registering the marketplace
  leaves a clone pointing at nothing.
- A project-scope marketplace is **inert until the workspace is trusted** — Claude Code
  prompts on trust instead of installing silently. A first session showing no plugin is not
  a broken install; trust the workspace and restart the session.
- The `claude plugin …` CLI reads only the user-level marketplace registry, never project
  settings, so it cannot confirm or repair this setup. The check that works is step 3's
  `tm doctor`.
- The interactive alternative (`/plugin marketplace add …`, `/plugin install …`) is
  user-scope: one machine, nothing committed, nothing for teammates to clone.

## 2. The git contract

Commit `.claude/settings.json`. It is shared project config — the file that tells a clone
which plugins it needs. Ignore only the machine-local paths:

```gitignore
.claude/plugins/
.claude/worktrees/
.claude/telemetry/
.claude/settings.local.json
```

A blanket `.claude/` ignore drops the settings file with it, silently.

## 3. Bootstrap the store

One command per machine, run from anywhere in the repo — the same relative path as step 1:

```bash
node ../bytedesk-marketplace/task-management/bin/tm init
```

A directory marketplace has no separate installed copy: the source checkout **is** the
plugin, so bootstrap calls the source bin directly. (Inside Claude Code,
`${CLAUDE_PLUGIN_ROOT}/bin/tm init` is the same verb.) Everything after bootstrap uses the
project launcher the bootstrap wrote — that is the whole reason this step exists.

`tm init` is idempotent. It writes:

- the store at `.bytedesk/task-management/` (`epics/`, `tasks/`, `adrs/`, `plans/`,
  `templates/`, `evidence/`)
- `config.json` — `boardId` derived from the origin remote, `owner` from your git user, so
  a clone knows which project the board belongs to and a write from the wrong repo is
  refused rather than silently accepted
- the store's `.gitignore` and `.gitattributes`, plus `.bytedesk/.gitignore` for
  `worktrees/` (they sit next to the store, where a store-local rule cannot see them)
- the six project launchers under `.bytedesk/task-management/bin/` (`tm`, `tm-hook`,
  `tm-dashboard`, plus `.cmd` twins for Windows)

The store's own `.gitignore` splits the shared record from the machine:

| Committed | Per-machine (ignored) |
|---|---|
| the markdown, `config.json`, `templates/`, `evidence/`, the contract files | `index.json` (derived cache), `state.json` (claims), `agents.json`, `pool.pid`, `events*.jsonl` (this host's audit log), `bin/` (the launchers), `dashboard.*`, `port.assigned`, `state.lock*`, `.tm-tmp-*` |

The launchers are regenerated per host, deliberately: they embed no machine-specific path,
so rewriting them costs nothing and there is nothing to merge. The consequence that bites:
**a fresh clone of a repo that already has a board has no launchers** — run the same
`node … init` once after cloning. A Claude session does this on its own for an initialized
store: SessionStart rewrites stale launchers after a plugin update. Two doctor warnings a
clone can legitimately carry: `unclaimed-wip` for work another machine left in progress
(claims are per-machine, in the ignored `state.json`) and `board-renamed` when the clone's
origin remote does not match the recorded `boardId` — identity is derived from git, not
declared, so `tm config boardId` cannot paper over it.

If a broader ignore rule already swallows the store (say `.bytedesk/` in the repo's
`.gitignore`), init says so on stderr: git status stays clean, the board works, and not one
task ever reaches a second clone. Narrow that rule; the store's own `.gitignore` already
covers the per-machine files.

Post-install check:

```bash
.bytedesk/task-management/bin/tm doctor    # wants: no problems found (exit 1 on an error-level finding)
.bytedesk/task-management/bin/tm where     # JSON: which plugin source the launcher resolved
```

In `tm where`'s output, `launcherSourceKind` names the resolution path that won. For this
setup the healthy answer is `"project marketplace"` — the launcher read step 1's
declaration and resolved `<main checkout>/../bytedesk-marketplace/task-management`.
Resolution order: per-command env override → `TM_PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → the
project marketplace declaration → Codex plugin cache → Claude install registry → Grok
registry. A launcher that cannot resolve exits 127 and names the project; it never guesses
an ancestor directory.

First content — the create gate is live, so body and criteria are part of the incantation,
not a follow-up:

```bash
.bytedesk/task-management/bin/tm epic new "First epic"      # a board needs an epic before it takes tasks
.bytedesk/task-management/bin/tm task new "first task" --body "what and why" --ac "the check that closes it"
```

An explicit create without `--body` and at least one `--ac` is refused (config
`requireOnCreate`); harness mirrors are exempt.

## 4. Wire the harnesses

The store, CLI, MCP server and dashboard are harness-agnostic; hooks and MCP registration
are not. `<plugin>` below is `../bytedesk-marketplace/task-management` — the same relative
path as step 1.

| Harness | MCP server | Hooks |
|---|---|---|
| Claude Code | rides the plugin (`.mcp.json`, `${CLAUDE_PLUGIN_ROOT}`) | ride the plugin (`hooks/hooks.json`) |
| Codex CLI | `codex mcp add task-management -- <plugin>/bin/tm-mcp` | `.codex/hooks.json`, committed — below |
| Kimi Code | `.kimi-code/mcp.json` — below | `[[hooks]]` in `~/.kimi-code/config.toml` — no repo-local hooks file |
| Grok | `grok mcp add task-management -- <plugin>/bin/tm-mcp` | none — no hook surface |

**Claude Code** — nothing to wire. Step 1 is the whole job: hooks and the MCP server
resolve through the host-provided plugin root and never depend on PATH.

**Codex** — its hooks call the project launcher (`.codex/hooks.json` has no plugin-root
substitution), so bootstrap first, then:

```bash
grep -v '^//' ../bytedesk-marketplace/task-management/hooks/codex-hooks.example.json > .codex/hooks.json
```

Commit the result. Codex runs hooks from the repository, so the project-relative command
needs no PATH entry or absolute path; on a fresh clone the committed hooks outlive the
launchers, which is why step 3 is per-machine. One behavioral note: Codex passes a hook
**no environment variables** — the session id arrives on the payload's `session_id` and the
hook adopts it as `TM_SESSION_ID`. Claims and gates attribute correctly only because of
that.

**Kimi** — two files. Hooks (there is no repo-local hooks file, so this is user-level):

```bash
cat ../bytedesk-marketplace/task-management/hooks/kimi-hooks.example.toml >> ~/.kimi-code/config.toml
```

The example's commands are the project launcher — Kimi runs hook commands with the
session's project directory as cwd, so no PATH entry or absolute path is needed. Like
Codex, Kimi exports no session variable; the payload's `session_id` becomes
`TM_SESSION_ID`. MCP goes in the project-level `.kimi-code/mcp.json`:

```json
{ "mcpServers": { "task-management": { "command": "../bytedesk-marketplace/task-management/bin/tm-mcp" } } }
```

There is no `tm-mcp` project launcher (launchers exist for `tm`, `tm-hook` and
`tm-dashboard` only), so the MCP entry names the plugin bin directly. Kimi lists
project-level servers in its workspace-trust prompt — the same posture as Claude's step 1.
If `/mcp` shows the server down, the relative `command` is the first suspect: Kimi's docs
do not pin what a relative path resolves against (checked 2026-09-02), and the per-machine
fallback is `~/.kimi-code/mcp.json` with an absolute path.

**Grok** — `grok mcp add task-management -- ../bytedesk-marketplace/task-management/bin/tm-mcp`
is all that exists: no hook surface, so no session-start briefing, no Stop gate, no
automatic commit linking. The board still works — drive it with the CLI and the MCP tools,
and claims still hold, because they read `GROK_SESSION_ID` rather than a hook.

## 5. Updating

This marketplace's internal plugins carry **no `version`** — not in
`.claude-plugin/plugin.json`, not in the marketplace entry — so the version resolves to the
git commit SHA and **every marketplace commit is a new version**. Updating is pulling:

```bash
git -C ../bytedesk-marketplace pull
```

- Launcher-driven surfaces (the CLI, Codex and Kimi hooks — anything through
  `.bytedesk/task-management/bin/`) resolve straight into the source checkout, so a pull is
  live immediately. No cache is involved.
- Claude's installed copy refreshes with `/plugin update` (or the next session, with
  `autoUpdate`); the SessionStart after an update rewrites the project launchers and tops
  up the store's git contract. A pinned version would make every commit invisible until
  someone bumped it — `/plugin update` reporting "already at the latest version" over a
  stale cache is the failure the missing pin exists to prevent.
- What stale actually looks like: `tm where` reporting `launcherSourceKind` `"Codex plugin
  cache"` or `"Claude user plugin"` where step 1 says `"project marketplace"` — the
  declaration resolution failed and the launcher fell through to a cache — or behavior that
  predates a change you know landed. `tm doctor` reports stale launchers as
  `project-launchers`; `tm doctor --fix` rewrites them.

Rules this setup inherits from the marketplace, restated because each was a silent failure
once: no version pins on internal plugins; no absolute paths in committed files; a plugin
never symlinks content from outside the marketplace — the install skips it without an
error, so the linked content is simply absent.

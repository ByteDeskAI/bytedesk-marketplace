# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo identity

`bytedesk-marketplace` is a Claude Code plugin marketplace. It ships two plugins: **`fleet`** — parallel multi-session Claude orchestration with hierarchical authorization — and **`design-patterns`** — a source-neutral design-pattern advisor (Python MCP server, 120+ entry Markdown catalog, slash commands, skills, dynamic workbench). The marketplace is consumed by `/plugin marketplace add ByteDeskAI/bytedesk-marketplace`.

This repo was extracted from `ByteDeskAI/bytedesk-platform` (PRs #346 / #347). Status is `v0.1.0` pre-release; breaking changes are expected until v1.0.0.

- Issue tracker: Jira project **BDM** (`bytedesk.atlassian.net`)
- Spec/docs space: Confluence space id **15171589 (BDM1)**
- Sibling repo `bytedesk-platform` uses **BDP** for both — never mix the keys.

## Source-of-truth rule (load-bearing)

Edit only files under this repo (`~/Documents/GitHub/bytedesk-marketplace/`). Installed/cached plugin copies under `~/.claude/plugins/` — e.g. `~/.claude/plugins/fleet/`, and the former standalone `~/.claude/plugins/marketplaces/bytedesk-design-patterns/` — are downstream snapshots; edits there are silently overwritten when the user runs `/plugin update`. Never edit an installed path.

## Common commands

Tests are plain `bash` scripts that self-isolate via `mktemp -d` + `HOME` override. No build step.

```bash
# Hook unit tests (PreToolUse merge guard, PostToolUse event emitter)
bash fleet/hooks/tests/test-pr-merge-guard.sh
bash fleet/hooks/tests/test-event-emitter.sh

# Daemon / CLI tests (event dispatch, events subcommand)
bash fleet/tests/test-event-dispatch.sh
bash fleet/tests/test-events-cli.sh

# Run all
for f in fleet/hooks/tests/*.sh fleet/tests/*.sh; do bash "$f" || break; done

# Static check the bash sources
shellcheck fleet/bin/* fleet/hooks/*.sh

# Out-of-band install (symlinks bin/ into ~/.local/bin, copies systemd units).
# Idempotent. Users run this once after `/plugin install fleet@bytedesk` if
# they want the systemd lifecycle instead of the plugin-managed monitor.
fleet/install.sh
```

After editing any of `fleet/bin/claude-sessions`, `fleet/bin/spawn-claude-feature`, or the systemd units, re-run `fleet/install.sh` to re-link / re-copy. Symlinks for the bin scripts are stable across edits; systemd unit copies are not, so install.sh's `daemon-reload` is required.

## Architecture

### Two layers

1. **Marketplace** (`.claude-plugin/marketplace.json`) — declares the plugin entries (`./fleet`, `./design-patterns`). Adding a plugin = adding an entry here + a sibling top-level dir.
2. **Plugins** (`fleet/`, `design-patterns/`) — each a self-contained Claude Code plugin. The `fleet/` layout matches the plugin manifest schema:
   - `.claude-plugin/plugin.json` — plugin manifest
   - `bin/` — user-facing scripts (the CLI lives here, not in skills)
   - `hooks/hooks.json` + `hooks/*.sh` — PreToolUse / PostToolUse Bash hooks, wired by manifest
   - `monitors/monitors.json` — registers the notify daemon as a `lifecycle: plugin-active` monitor (lives or dies with the plugin being enabled)
   - `skills/<name>/SKILL.md` — slash commands (`/fleet:spawn`, `/fleet:review`, `/fleet:tournament`, `/fleet:chain`, `/fleet:wait`, `/fleet:cleanup`, `/fleet`)
   - `systemd/` — alternative OS-level service units for the notify + ttyd web daemons (alternative to the plugin-managed monitor)
   - `docs/RULES.md` + `docs/adr/0001-hierarchical-authorization.md` — the authorization taxonomy the hooks implement
   - `tests/` and `hooks/tests/` — bash test fixtures

Hook commands in `hooks.json` reference `${CLAUDE_PLUGIN_ROOT}/...` — that's the variable Claude Code substitutes to the installed plugin path at runtime. Don't hardcode paths.

### Per-user state lives outside the repo

All session state — meta files, append-only logs, JSONL events, rules, results — lives at `~/.claude-sessions/<TICKET>.{meta,log,events}` and `~/.claude-sessions/rules/`. The plugin scripts are stateless wrappers around that directory. Do not introduce state inside the plugin checkout.

### Hierarchical authorization (ADR-0001)

This is the central design. Every gated action falls into four classes:

| Class | Auth rule |
|---|---|
| Local-blast (edits, commits, lints) | No gate |
| PR-level (open/comment/review/merge/label) | Depth-aware: depth 0 → human in transcript; depth ≥ 1 → inherited from spawn |
| Repo-destructive (force push, branch delete, history rewrite) | Always require human, regardless of depth |
| External (production deploy, secret rotation, outbound msg) | Always require human + per-action explicit auth |

Mechanics: `spawn-claude-feature` sets `CLAUDE_SESSION_DEPTH` in the child's env (0 for root, 1 for child, 2 for grandchild, capped at 2 by default via `--max-depth`). Hooks in PR-level class read that var and short-circuit at depth ≥ 1. Hooks in repo-destructive / external classes ignore depth entirely.

When adding a new gate, declare its class first, then apply the matching rule. Don't invent ad-hoc auth checks.

### Hook contract

- **PreToolUse** (`pr-merge-guard.sh`) is a *gate*. Exit `0` allows; exit `2` blocks and surfaces stderr to Claude. Must **fail safe** (block) when state required for the decision (transcript, env var, `gh` resolution) is missing.
- **PostToolUse** (`event-emitter.sh`) is *observability only*. Always exit `0`, even on internal failure — blocking tool execution because of an event-logging error is the wrong tradeoff. Errors swallow into `~/.claude-sessions/<TICKET>.events.err`.
- Both hooks read PreToolUse/PostToolUse JSON from stdin via `jq`. Matchers in `hooks.json` are tight (`"matcher": "Bash"`) so unrelated tool calls don't pay hook latency.
- Only `spawn-claude-feature` writes `CLAUDE_SESSION_DEPTH` — it's the authoritative source. Don't read or set the var elsewhere.

### Event observability

PostToolUse classifies Bash commands into kinds (`review_comment`, `review_summary`, `merge`, `pr_opened`, `commit_pushed`) and appends one JSONL line per event to `~/.claude-sessions/<TICKET>.events`. The `claude-sessions notify` daemon (run as a plugin monitor or as a systemd user unit) tails event files and dispatches via configurable sinks (desktop, bell, fifo, slack). Adding a kind requires three coordinated edits: `event-emitter.sh` classification, the test fixture, and the daemon's default `notify.config.toml`.

## The `design-patterns` plugin

`design-patterns/` is a self-contained **Python** plugin (no build step), onboarded from `ByteDeskAI/design-pattern-references` (BDM-52). Layout:

- `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.mcp.json`, `.codex-mcp.json` — Claude + Codex manifests and MCP server registration
- `bin/patterns` (CLI) and `bin/patterns-mcp` (MCP stdio launcher) — plain Python; both `sys.path`-insert `lib/`
- `lib/pattern_*.py` + `lib/workbench_*.py` — the MCP server (`pattern_mcp_server.py`), catalog/intelligence/graph/context/inference/scanner helpers, and the dynamic workbench
- `data/` — the source-neutral Markdown catalog (patterns, playbooks, recipes, smells, frameworks, languages, scorecards, snippets, taxonomy)
- `commands/`, `skills/`, `agents/` — 10 slash commands, 6 skills, the `pattern-architect` agent
- `site/` — prebuilt static HTML catalog (committed artifact; regenerated by `scripts/generate_site.py`)
- `tests/`, `evals/`, `docs/`, `scripts/` — folded in from the source repo root so the plugin is self-contained; path constants resolve relative to `design-patterns/`, not the marketplace root
- `LICENSE` + `NOTICE` — the plugin is **Apache-2.0** while the marketplace root is MIT, so the subdir carries its own license

Checks (plain Python, stdlib only):

```bash
python3 design-patterns/scripts/validate_catalog.py    # catalog + manifest validation
python3 design-patterns/scripts/run_evals.py           # golden eval checks
python3 -m unittest discover -s design-patterns/tests  # unit tests
```

Cross-session "pattern memory" — a persistent project journal the plugin reads and writes — is being added on top of this baseline (BDM-52).

## Working on this repo

- The CLI / launcher in `fleet/bin/` is hand-written bash. `claude-sessions` is ~1000 lines and is `source`-able by tests via a main guard — preserve that guard if you refactor.
- Skill markdown files use YAML frontmatter with `name`, `description`, `user-invokable`, `argument-hint`, `allowed-tools`. The `description` is matched against user phrasing; rewrite carefully — phrasings like "kick off these tickets" or "fleet status" are deliberate hooks.
- Skill names in `SKILL.md` files still use the unprefixed form (`fleet-spawn`); the slash-command form is namespaced (`/fleet:spawn`). Migration to `fleet:spawn` in the `name:` field is tracked as BDM-2.
- The two known limitations baked in: (1) plugins can't ship rule files, so `docs/RULES.md` is documentation-only — projects wanting it as a Claude-loaded rule must `cat` it into their own `.claude/rules/`. (2) `~/.claude-sessions/` is created by `install.sh`, not by the plugin manifest.

## Reference docs

- `fleet/docs/adr/0001-hierarchical-authorization.md` — depth/auth class rules.
- `fleet/docs/adr/0002-plugin-data-directory.md` — `${CLAUDE_PLUGIN_DATA}` layout.
- `fleet/docs/adr/0003-web-dashboard-architecture.md` — fleet web dashboard design.
- `fleet/docs/research/0001-plugin-manifest-lifecycle.md` — manifest lifecycle research.
- `fleet/docs/research/0002-claude-code-jsonl-format.md` — **transcript jsonl event catalog** (what `~/.claude/projects/<…>/<uuid>.jsonl` contains; consult before parsing). Companion rule at `.claude/rules/parsing-claude-jsonl.md` is auto-loaded into Claude Code sessions in this repo.
- **`.claude/rules/version-enforcement.md`** — gitflow-style semver policy. Auto-loaded; read it before any commit that touches a plugin directory. **Every plugin commit must bump all of that plugin's version markers** + write a CHANGELOG entry — `fleet` has five (`plugin.json`, `marketplace.json` ×2, `package.json`, `server.go` `buildVersion`); `design-patterns` has four (`plugin.json` ×2, `pattern_mcp_server.py` `SERVER_INFO`, `workbench_views.py`) plus its `marketplace.json` entry. Major/minor/patch picked per the table in the rule, with explicit "bump major/minor" overrides.

---
id: "TM-082"
kind: "task"
status: "done"
created: "2026-09-02T15:35:18.640Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Write the installing-into-other-local-repositories guide and verify it by doing it"
epic: "EP-012"
acceptance: [{"text":"one canonical install doc exists and is linked from the README (docs table or install section)","done":true,"at":"2026-09-02T16:21:30.462Z"},{"text":"covers marketplace registration (relative path, enabledPlugins, trust prompt), the git contract for .claude/settings.json, tm init bootstrap, per-harness MCP+hooks wiring, and updating/stale-cache behavior","done":true,"at":"2026-09-02T16:21:30.567Z"},{"text":"verified by executing the guide in a scratch repo to a working board with tm doctor clean; evidence attached","done":true,"at":"2026-09-02T16:21:30.663Z"},{"text":"no contradictions with the marketplace rules in the root AGENTS.md (no version pins, no absolute paths, no symlinked content from outside the marketplace)","done":true,"at":"2026-09-02T16:21:30.763Z"}]
evidence: [".bytedesk/task-management/evidence/TM-082-tm-082-verification.log",".bytedesk/task-management/evidence/TM-082-tm-081-082-suite.log"]
commits: []
blockedBy: []
blocks: []
actor: "main"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T16:21:31.326Z"
labels: ["ready-for-agent"]
closed: "2026-09-02T16:21:31.322Z"
---

A complete, verified install guide for adding the task-management plugin to any other local repository — the consumer side of the marketplace. Today this knowledge is scattered: the marketplace rules live in the root AGENTS.md, `Installing without Claude Code` covers a slice, and per-harness hook/MCP setup is split across the README matrix and hooks/ examples. A repo maintainer should need exactly one document.

Content the guide must cover, in install order:
1. **Marketplace registration** — the consumer repo's `.claude/settings.json` registers the marketplace by RELATIVE path (`"path": "../bytedesk-marketplace"`, resolves against the main checkout; never absolute — it bakes one machine's home dir into a shared repo) and declares `enabledPlugins` as `"task-management@<marketplace>": true`. Note the workspace-trust prompt behavior (project-scope marketplaces stay inert until trusted).
2. **Git contract** — `.claude/settings.json` is committed, never gitignored; only the machine-local paths are ignored (`.claude/plugins/`, `.claude/worktrees/`, `.claude/telemetry/`, `.claude/settings.local.json`).
3. **Bootstrap** — `tm init` from the installed plugin writes the project launchers under `.bytedesk/task-management/bin/`; what the store's .gitignore contract covers; `tm doctor` as the post-install check.
4. **Per-harness wiring** — the MCP registration + hooks setup for each supported harness (Claude `.mcp.json`/plugin hooks, Codex `.codex/hooks.json`, Kimi `~/.kimi-code/config.toml` + `.kimi-code/mcp.json`, Grok MCP-only), each pointing at the project-relative launchers.
5. **Updating** — internal plugins carry no version: every marketplace commit is a new version and consumers update via the plugin update command; what a stale cache looks like and how `tm where` shows what a launcher actually resolved.

Where it lives: a top-level README "Installing into a repository" section (rewriting/extending the current `Installing without Claude Code` block) or docs/install.md linked from the README docs table — author's call, one canonical place.

VERIFY BY DOING: create a scratch repo in /tmp, register the marketplace by relative path, and follow the guide keystroke-by-keystroke to a working board (`tm init`, a task created, `tm doctor` clean) for the Claude path, and as far as each other harness's locally-verifiable steps go. Any step that doesn't work as written is a bug in the guide OR the plugin — fix and re-verify.
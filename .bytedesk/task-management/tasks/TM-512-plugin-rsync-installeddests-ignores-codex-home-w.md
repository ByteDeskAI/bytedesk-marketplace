---
id: "TM-512"
kind: "task"
status: "open"
created: "2026-10-09T05:10:22.022Z"
board: "bytedeskai/bytedesk-marketplace"
title: "plugin-rsync: installedDests ignores CODEX_HOME while trust-codex-hooks honours it"
epic: "EP-028"
acceptance: [{"text":"installedDests uses CODEX_HOME when set; a sync with CODEX_HOME refreshes that cache and runs trust; the test fails on the old code","done":false},{"text":"The four review-232 LOW leftovers (sameTree node_modules, acquireLock owner and stale/stale race with a test, Grok repair by directory, node -e filter) are fixed or explicitly documented","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@main"
session: "fd2b831f"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
filedBy: {"board":"bytedeskai/bytedesk-marketplace","agent":"b2a5592e","task":"TM-485"}
labels: ["decision:intake","needs-triage"]
triagedBy: "auto"
triageMissing: ["label decision:intake"]
updated: "2026-10-09T05:34:33.710Z"
comments: [{"author":"main","ts":"2026-10-09T05:34:33.168Z","text":"Also fold in the LOW leftovers from review-232's delta review of PR #232 (2cbe08a9). L1: sameTree (plugin-rsync:355) skips node_modules/ and .git/, so a modified hook loading a file under node_modules can still be trusted. L2: acquireLock leaves the fresh lock owner-less between mkdirSync and writeFileSync (~270-272); on Linux the rename-back (~260) can replace a third run's new lock; no test drives the stale/stale interleaving. L3: fixGrokInstalls matches the marketplace by its marketplace.json name, not its directory. L4: 'node -e \"<code>\" /path' passes the untrusted-hook filter."}]
---

Found during TM-485 rework (EP-028). plugin-rsync/bin/plugin-rsync installedDests (~line 129-133) discovers Codex caches only under $HOME/.codex/plugins/cache/bytedesk, while trustCodexHooks and its lock use CODEX_HOME (codexHomeOf). On a machine with CODEX_HOME set, a sync never refreshes the Codex cache and never triggers hook trust. Fix: use codexHomeOf(home) in installedDests; test with CODEX_HOME set and no ~/.codex.
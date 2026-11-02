---
id: "TM-496"
kind: "task"
status: "open"
created: "2026-10-09T02:00:44.917Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: committed dist/ bundles make every AO merge to main conflict with every open AO PR"
epic: "EP-028"
acceptance: [{"text":"A merge of main into an AO PR branch never conflicts on dist/*.cjs or ROADMAP-SOURCES.json (gitattributes merge driver), and build:check still fails CI when the committed bundle is stale","done":false},{"text":"One documented script updates a PR from main (merge, rebuild, refresh sources, verify released CHANGELOG sections unchanged) and is used by the integration workers","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-09T02:00:44.938Z"
---

2026-10-08/09: each AO merge to main (#221, #222-226, #229, the 0.16.1 release) turned every open AO PR DIRTY with conflicts only in agent-orchestration/dist/cli.cjs and dist/mcp.cjs (and sometimes ROADMAP-SOURCES.json), forcing a hand rebuild + full test rerun per PR per merge (#198 needed four rounds). dist/ must stay committed (consumers install by git SHA with no build step). Fix: .gitattributes 'agent-orchestration/dist/*.cjs merge=ours' (and ROADMAP-SOURCES.json) so a generated-file conflict never blocks a merge, plus a documented, scripted 'update-pr' path (merge main, npm ci, build, roadmap:refresh-sources, build:check) and CI failing on a stale bundle (build:check already enforces). Also note: git silently moved a PR's [Unreleased] CHANGELOG entry into a just-released section with no conflict (rebase-4, #198) — the update script should verify released sections are byte-identical to main.
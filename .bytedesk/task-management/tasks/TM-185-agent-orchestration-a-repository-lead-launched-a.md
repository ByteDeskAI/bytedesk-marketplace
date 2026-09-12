---
id: "TM-185"
kind: "task"
status: "done"
created: "2026-09-11T20:36:42.980Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a repository lead launched as a run's orchestrator shows the orchestrator icon on its run pane but the lead icon in presence"
epic: "EP-019"
acceptance: [{"text":"Decide which icon a repository lead shows while coordinating a run, and record it in PRESENCE-ROLE-ICON-ADDENDUM.md","done":true,"at":"2026-09-11T21:32:36.957Z"},{"text":"Run-pane options, run.json, CLI rows and presence give the same roleIcon for that agent, proven by one test that reads all of them","done":true,"at":"2026-09-11T21:32:37.114Z"}]
evidence: [".bytedesk/task-management/evidence/TM-185-LEAD-RUN-ICON.md"]
commits: ["a080ba8"]
blockedBy: []
blocks: []
actor: "main"
session: "8e87dbc7-3321-4e05-8648-b64d7c6319bb"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent","plugin:agent-orchestration"]
triagedBy: "auto"
updated: "2026-09-11T21:42:47.432Z"
comments: [{"author":"main","ts":"2026-09-11T20:38:12.762Z","text":"Being fixed inside TM-168 rather than deferred: the mismatch breaks TM-168's identical-icon criterion and came from the lead's brief (run agents used the declared role only). W5 (ep168-w5-surfaces) is adding repoRole lead for the registered lead's run agent in launch.mjs runAgentVisual and the status/session/role readers, with a red run. Close TM-185 with that commit as evidence."},{"author":"main","ts":"2026-09-11T21:32:37.284Z","text":"Fixed in tm/TM-168-surfaces 78cae6c, merged into tm/EP-019-leads-icons at 665ace6. Integration at 665ace6 (clean, TMUX isolated): topology unit suite 446/446; real-tmux topology-role-icon-tmux 1/1 including the registered lead's run pane at the lead icon; all five contract files green. Ships with agent-orchestration v0.9.0."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-185-LEAD-RUN-ICON.md":{"source":"/tmp/claude-1000/-home-ryan-Documents-GitHub-ByteDeskAI-bytedesk-marketplace/8e87dbc7-3321-4e05-8648-b64d7c6319bb/scratchpad/TM-185-LEAD-RUN-ICON.md","sha256":"64d46ea8cc1ec20bd1f66fb087f6f654c2a7eb002a10e616392254f2a731c8ea","bytes":2337,"at":"2026-09-11T21:32:36.687Z"}}
closed: "2026-09-11T21:32:37.445Z"
---

Found by W5 during TM-168 (2026-09-11). roleVisual gives a repository lead the lead icon everywhere so its terminal and GUI views agree, and presence (W6) applies that via repoRole. W5's run-pane decoration (launch.mjs runAgentVisual) uses only the run's declared role, so a library lead launched into a run as orchestrator gets the orchestrator icon on that run pane and in run.json/CLI rows, while its presence entry shows the lead icon. TM-168 requires the identical icon on terminal title bars and GUI agent views; browser acceptance of a lead coordinating a run would see different characters.
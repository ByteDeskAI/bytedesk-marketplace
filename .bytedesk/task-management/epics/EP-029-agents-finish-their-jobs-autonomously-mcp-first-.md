---
id: "EP-029"
kind: "epic"
status: "open"
created: "2026-10-09T05:19:11.533Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Agents finish their jobs autonomously: MCP-first coordination and no capability dead ends"
actor: "main"
session: "253de95a-5b3d-4702-b941-9b7ba0507f01"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-10-10T00:36:32.878Z"
comments: [{"author":"main","ts":"2026-10-09T07:12:40.076Z","text":"Ryan, 2026-10-09: when the in-flight work is complete and tested, merge everything to main and push, then RELEASE agent-orchestration (next version after 0.16.1) through the normal release path. In flight at the time: #251 TM-520, #253 TM-507, #242 TM-478, #245 TM-426, #249 TM-522, #252 TM-521, #235 TM-427, then TM-525 and TM-505 after TM-427. Final step: fast-forward the main checkout, sync caches from clean HEAD, and verify local, origin/main and caches agree."},{"author":"main","ts":"2026-10-09T17:45:06.504Z","text":"Release done (2026-10-09): agent-orchestration v0.17.0 merged as #256 at 3f3fe7ce (review-256 APPROVE, host-run checks AO 1339/0, tm 1704/0, plugin-rsync 50/0, CI green). Verified: local main = origin/main = 3f3fe7ce, 0 unpushed; every plugin synced from a clean HEAD worktree (676 ok); 344 cache files compared with HEAD, 0 mismatches; the installed CLI exposes 'reviewer withdraw'. design-system caches are not synced from here (git-subdir source in ByteDeskAI/design-system), as expected."},{"author":"main","ts":"2026-10-10T00:36:32.868Z","text":"Patch release done (2026-10-09): agent-orchestration v0.17.1 merged as #259 at 0c23733c, fixing the 0.17.0 lead-ring regression (TM-529, #257). Verified: local = origin/main = 0c23733c, 0 unpushed; all plugins synced from a clean HEAD worktree (688 ok; design-system expected, since it is git-subdir sourced); 350 cache files compared with HEAD, 0 mismatches."}]
---

Ryan, 2026-10-09: agents keep stalling because they lack the permissions or tools their role needs (for example, faro has no Bash, so it cannot read mail or run checks, and its blocked verdict deadlocks rework). They also coordinate by shelling out to the ao-topology CLI, not through MCP tools. Two audits (2026-10-09) are saved in .bytedesk/task-management/evidence/EP-autonomy/: audit-mcp.md (MCP inventory, the per-role launch flags, and staged design T1-T8) and audit-transcripts.md (15 problems from 83 transcripts over 48 h). Root cause: every topology role runs with --strict-mcp-config and no MCP config, and agent.mcp is never read, so leads, reviewers and topology workers have zero MCP servers. Goal: every role reaches every operation it needs through MCP tools bound to its own identity, with the security intent kept (the reviewer gets no Bash and no write tools), and no workflow state leaves a task with no verb to move it forward.
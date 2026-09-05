---
id: "TM-089"
kind: "task"
status: "open"
created: "2026-09-05T04:00:58.881Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Decide and migrate the resource path convention"
epic: "EP-014"
acceptance: [{"text":"Decision recorded: all five resource types move to .bytedesk/agent-orchestration/, or agents live apart with the reason stated","done":false},{"text":"If moving, a fallback read on the old path exists so an existing repo does not break silently","done":false},{"text":"design-system's gitignore entry is updated to match","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: ["TM-092"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:07:02.727Z"
type: "spike"
comments: [{"author":"main","ts":"2026-09-05T04:07:02.723Z","text":"Decision (owner, 2026-09-05): move all five resource types together — templates, skills, roles, providers and the new agents — from <repo>/.orchestration/ to <repo>/.bytedesk/agent-orchestration/, with a fallback read on the old path so an existing repo does not break silently. Rationale: splitting agents from their four siblings would leave two conventions inside one plugin permanently. Known breaking surface: design-system carries an .orchestration/runs/ gitignore entry added 2026-09-04."}]
---

topology/ resolves templates, skills, roles and providers from <repo>/.orchestration/, while the rest of the ecosystem uses .bytedesk/<plugin>/ (task-management, knowledge). Putting the new agent library at .bytedesk/agent-orchestration/agents/ either splits agents from their four sibling resource types or moves all five together. Moving all five with a fallback read on the old path is the coherent option and is a breaking change for any repo already carrying .orchestration/ - design-system has an .orchestration/runs/ gitignore entry added 2026-09-04.
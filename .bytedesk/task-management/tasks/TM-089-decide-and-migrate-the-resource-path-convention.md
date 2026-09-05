---
id: "TM-089"
kind: "task"
status: "done"
created: "2026-09-05T04:00:58.881Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Decide and migrate the resource path convention"
epic: "EP-014"
acceptance: [{"text":"Decision recorded: all five resource types move to .bytedesk/agent-orchestration/, or agents live apart with the reason stated","done":true,"at":"2026-09-05T07:31:32.811Z"},{"text":"If moving, a fallback read on the old path exists so an existing repo does not break silently","done":true,"at":"2026-09-05T07:31:32.932Z"},{"text":"design-system's gitignore entry is updated to match","done":true,"at":"2026-09-05T07:31:33.052Z"}]
evidence: [".bytedesk/task-management/evidence/TM-089-two-projects.sh"]
commits: ["8f135ad","85b7619"]
blockedBy: []
blocks: ["TM-092","TM-100"]
actor: "main"
session: "b0124774-6c67-41ff-9359-e1a31565e734"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:32:49.023Z"
type: "spike"
comments: [{"author":"main","ts":"2026-09-05T04:07:02.723Z","text":"Decision (owner, 2026-09-05): move all five resource types together — templates, skills, roles, providers and the new agents — from <repo>/.orchestration/ to <repo>/.bytedesk/agent-orchestration/, with a fallback read on the old path so an existing repo does not break silently. Rationale: splitting agents from their four siblings would leave two conventions inside one plugin permanently. Known breaking surface: design-system carries an .orchestration/runs/ gitignore entry added 2026-09-04."},{"author":"main","ts":"2026-09-05T07:31:32.677Z","text":"AC3 resolved differently than written. The design-system repo no longer carries an .orchestration/runs/ gitignore entry — it is absent from its .gitignore as of ed9244a, so there was nothing to update. The replacement is stronger than a per-consumer entry: util.mjs ensureRunsIgnored() writes a .gitignore containing '*' into <repo>/.bytedesk/agent-orchestration/runs/ the first time a run is created there, so run artifacts stay out of history in EVERY consumer, including one that adopts orchestration after its .gitignore was written. Verified in the live harness: after a real run in project-1, 'git status --porcelain --untracked-files=all' reports zero paths under agent-orchestration/runs/. Migration also covered three shipped templates (design-studio, brand-identity-tournament, logo-design) which hardcoded the old runs path, plus docs/topology.md, README.md and four SKILL.md files."}]
closed: "2026-09-05T07:31:33.273Z"
---

topology/ resolves templates, skills, roles and providers from <repo>/.orchestration/, while the rest of the ecosystem uses .bytedesk/<plugin>/ (task-management, knowledge). Putting the new agent library at .bytedesk/agent-orchestration/agents/ either splits agents from their four sibling resource types or moves all five together. Moving all five with a fallback read on the old path is the coherent option and is a breaking change for any repo already carrying .orchestration/ - design-system has an .orchestration/runs/ gitignore entry added 2026-09-04.
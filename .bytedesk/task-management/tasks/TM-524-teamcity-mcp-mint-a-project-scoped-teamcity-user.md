---
id: "TM-524"
kind: "task"
status: "open"
created: "2026-10-09T05:29:38.860Z"
board: "bytedeskai/bytedesk-marketplace"
title: "teamcity-mcp: mint a project-scoped TeamCity user and token per repository lead (operator credential step after TM-522)"
epic: "EP-029"
acceptance: [{"text":"Each repo with a lead has a profile whose token's user holds a role on that project only","done":false},{"text":"A raw REST trigger with that token against another project's config returns 403","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "@main"
session: "fd2b831f"
branch: "tm/TM-522-teamcity-mcp-repository-leads-have-no-supported-"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/worktrees/TM-522-teamcity-mcp-repository-leads-have-no-supported-"
labels: ["ready-for-human"]
triagedBy: "human"
updated: "2026-10-09T05:29:38.880Z"
---

TM-522 added lead mode and per-repo profiles (~/.config/teamcity-mcp/repos/<repo>.env). The MCP guard refuses other projects and deploy configs, but the token itself is the real boundary. Create a TeamCity user per lead whose only role is Project developer on that repo's project, mint its token, and write the profile. This creates credentials, so it is an operator action. Machine today uses operator basic auth for every session.
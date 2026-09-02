---
id: "TM-083"
kind: "task"
status: "done"
created: "2026-09-02T18:13:17.767Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Expose Fable 5.1 and design-image capability through orchestration"
epic: "EP-013"
acceptance: [{"text":"A live orchestration doctor/capability probe reports an exact Fable 5.1 Claude endpoint.","done":true,"at":"2026-09-02T18:27:08.824Z"},{"text":"The orchestration spawn API can select the approved exact endpoint without arbitrary command or model injection.","done":true,"at":"2026-09-02T18:27:08.893Z"},{"text":"The Pi session can invoke orchestration through the MCP protocol and reports spawned session URLs verbatim.","done":true,"at":"2026-09-02T18:27:08.976Z"},{"text":"Codex image generation is positively probed before the design run, otherwise execution stops with a clear refusal.","done":true,"at":"2026-09-02T18:27:09.044Z"}]
evidence: [".bytedesk/task-management/evidence/TM-083-TM-083-fable-image-orchestration-evidence.md"]
commits: []
blockedBy: []
blocks: ["TM-084"]
actor: "main"
session: "01a062eb-2024-7368-bdb3-ad3fcf853ad4"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-02T18:27:09.121Z"
labels: ["ready-for-agent"]
touches: ["agent-orchestration/**"]
closed: "2026-09-02T18:27:09.118Z"
---

Refresh the vendored agent-orchestration catalogue and host path so this Pi orchestrator can select Claude Fable 5.1 exactly, run Codex GPT-5.6 Sol, and fail closed when image generation is unavailable. Preserve trusted-catalog routing and MCP-only provider execution.

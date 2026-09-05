---
id: "TM-087"
kind: "task"
status: "done"
created: "2026-09-05T04:00:27.335Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Spike: can a gateway tab id be pinned by the caller?"
epic: "EP-014"
acceptance: [{"text":"decodeTerminalTabRequest is read and the answer recorded: caller-supplied tab id accepted, or not","done":true,"at":"2026-09-05T04:08:05.011Z"},{"text":"If not accepted, the two fallback options are written up with the code paths each would touch","done":true,"at":"2026-09-05T04:08:05.135Z"},{"text":"Finding is recorded in the knowledge store so the next agent does not re-derive it","done":true,"at":"2026-09-05T04:08:28.446Z"}]
evidence: [".bytedesk/task-management/evidence/TM-087-1788581284880.log"]
commits: ["km:architecture/gateway-tab-ids-are-server-minted","8f135ad"]
blockedBy: []
blocks: ["TM-097"]
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:08:51.482Z"
type: "spike"
comments: [{"author":"main","ts":"2026-09-05T04:08:05.257Z","text":"Recommendation for TM-097: option 1 — honour req.Session in the builder. Smallest diff, and it makes ensureTmuxSession's existing has-session reuse the adopt path rather than adding new surface."}]
closed: "2026-09-05T04:08:28.557Z"
---

The pre-create-then-register pattern for showing orchestrator-spawned tmux sessions in the remote gateway depends on POST /terminal/api/tabs accepting a caller-supplied tab id. ensureTmuxSession (src/terminal_runtime_tabs.go:724) runs has-session first and reuses an existing session rather than spawning, so if the id can be pinned we pre-create the session and register a tab against it. If the id is server-generated, the options narrow to adding an adopt endpoint or letting the gateway create the session and injecting into it. Read decodeTerminalTabRequest and launch_request_builder.go in bytedesk-remote-gateway. This is a read-only spike; it gates the gateway integration design, not the whole epic.
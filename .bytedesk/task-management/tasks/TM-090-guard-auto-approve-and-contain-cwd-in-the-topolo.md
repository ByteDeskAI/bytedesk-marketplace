---
id: "TM-090"
kind: "task"
status: "open"
created: "2026-09-05T04:00:59.023Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Guard auto_approve and contain cwd in the topology layer"
epic: "EP-014"
acceptance: [{"text":"cwd and run_dir are checked against the consumer root; escaping paths are refused with a clear error","done":false},{"text":"A spec requesting auto_approve produces a visible warning at launch naming the agents affected","done":false},{"text":"Launching with auto_approve requires explicit operator consent rather than proceeding silently","done":false},{"text":"A test covers a spec that attempts cwd outside the repo and one that requests auto_approve","done":false}]
evidence: []
commits: ["8f135ad"]
blockedBy: []
blocks: []
actor: "main"
session: "a7da6c38-57d4-464b-b856-ebdb3dd72e1b"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T04:08:51.460Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/spec.mjs"]
labels: ["architecture"]
---

A spec is JSON and templates load from <repo>/.orchestration/templates/. auto_approve: true appends --dangerously-skip-permissions (siblings: --full-auto, --yolo, --always-approve, --allow-all-tools). cwd is uncontained: absolutize -> expandHome resolves ~ and any absolute path with no startsWith(consumer) check, so /, ~ and ../../other-repo all launch there. Every guard checked is absent: no confirmation prompt, no allowlist, dry-run is opt-in only, no --yes, no git-clean check, and the warnings array never mentions auto_approve. Mitigating today: auto_approve defaults false (spec.mjs:120 coerces with === true) and no shipped template sets it, so the dangerous configuration is opt-in and nothing ships opted-in. docs/topology.md states the intended boundary - the agents' own permission prompts are the safety boundary - which this flag removes with nothing in code objecting.
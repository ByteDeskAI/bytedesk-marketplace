---
id: "TM-090"
kind: "task"
status: "done"
created: "2026-09-05T04:00:59.023Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Guard auto_approve and contain cwd in the topology layer"
epic: "EP-014"
acceptance: [{"text":"cwd and run_dir are checked against the consumer root; escaping paths are refused with a clear error","done":true,"at":"2026-09-05T07:32:09.524Z"},{"text":"A spec requesting auto_approve produces a visible warning at launch naming the agents affected","done":true,"at":"2026-09-05T07:32:09.660Z"},{"text":"Launching with auto_approve requires explicit operator consent rather than proceeding silently","done":true,"at":"2026-09-05T07:32:09.818Z"},{"text":"A test covers a spec that attempts cwd outside the repo and one that requests auto_approve","done":true,"at":"2026-09-05T07:32:09.979Z"}]
evidence: [".bytedesk/task-management/evidence/TM-090-topology-launch.test.mjs"]
commits: ["8f135ad","85b7619"]
blockedBy: []
blocks: []
actor: "main"
session: "b0124774-6c67-41ff-9359-e1a31565e734"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-05T07:32:49.029Z"
touches: ["agent-orchestration/topology/lib/launch.mjs","agent-orchestration/topology/lib/spec.mjs"]
labels: ["architecture"]
comments: [{"author":"main","ts":"2026-09-05T07:32:09.401Z","text":"All four AC met. Containment: spec.mjs containPath() refuses a cwd or run_dir outside the invoking repo (TOPOLOGY_PATH_ESCAPES_REPO), covered by unit tests in topology-spec.test.mjs and by the live harness. Consent: launchRun refuses a spec carrying auto_approve unless --allow-auto-approve is passed, on the dry-run path too, and the warning names the affected agents. Note the escape hatch was a dead flag when found — spec.mjs read context.allowOutside but nothing ever set it; --allow-outside and --allow-auto-approve are now wired in cli.mjs and both directions are asserted."}]
closed: "2026-09-05T07:32:10.317Z"
---

A spec is JSON and templates load from <repo>/.orchestration/templates/. auto_approve: true appends --dangerously-skip-permissions (siblings: --full-auto, --yolo, --always-approve, --allow-all-tools). cwd is uncontained: absolutize -> expandHome resolves ~ and any absolute path with no startsWith(consumer) check, so /, ~ and ../../other-repo all launch there. Every guard checked is absent: no confirmation prompt, no allowlist, dry-run is opt-in only, no --yes, no git-clean check, and the warnings array never mentions auto_approve. Mitigating today: auto_approve defaults false (spec.mjs:120 coerces with === true) and no shipped template sets it, so the dangerous configuration is opt-in and nothing ships opted-in. docs/topology.md states the intended boundary - the agents' own permission prompts are the safety boundary - which this flag removes with nothing in code objecting.
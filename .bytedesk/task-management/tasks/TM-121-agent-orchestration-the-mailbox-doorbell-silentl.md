---
id: "TM-121"
kind: "task"
status: "done"
created: "2026-09-07T01:54:34.967Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: the mailbox doorbell silently fails to submit"
epic: "EP-017"
acceptance: [{"text":"sendText delivers the submit key as its own read, proven by a probe that logs one line per stdin chunk","done":true,"at":"2026-09-07T01:57:24.315Z"},{"text":"The regression test fails against the batched form","done":true,"at":"2026-09-07T01:57:24.465Z"},{"text":"Launch cost is re-measured and the added tmux calls are accounted for","done":true,"at":"2026-09-07T01:57:24.600Z"}]
evidence: [".bytedesk/task-management/evidence/TM-121-chunk-probe.mjs"]
commits: ["3ff291d"]
blockedBy: []
blocks: []
actor: "main"
session: "4e1d7087-d606-432e-9341-3ce779b4baf8"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-07T01:57:24.845Z"
closed: "2026-09-07T01:57:24.841Z"
---

The pointer that tells an agent it has mail is typed into its pane and then never submitted. The message file is written correctly, so nothing is lost and nothing errors — the agent simply looks idle, the conductor's wait runs to its timeout, and the run reads as an agent ignoring its mail. Hit three times in one showcase run (astra-image-pipeline), on the Claude adapter and the Codex adapter alike; each time a human pressing Enter in the pane unstuck it.

Cause, measured on tmux 3.4 with a probe that logs one line per stdin read rather than inferred: sendText batched the text and its submit key into ONE tmux invocation using the ';' separator, so tmux wrote both at once and the pane's program read them as a single chunk. Every modern TUI reads one chunk containing a newline as a PASTE of multiline text, and inserts it into the composer instead of submitting.

  batched   -> CHUNK 1: 'text\\r'
  separate  -> CHUNK 1: 'text'   CHUNK 2: '\\r'

Two separate invocations split the chunk with NO delay between them — the split follows the write boundary, not timing. Confirmed against a reader deliberately blocked for 300ms on its first chunk: still two chunks. The batching was introduced for launch latency (three sendText calls per agent, 60 of 134 tmux calls for ten agents), so the optimisation bought speed at the cost of the doorbell.
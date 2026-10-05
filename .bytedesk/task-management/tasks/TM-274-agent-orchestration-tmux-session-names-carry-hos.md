---
id: "TM-274"
kind: "task"
status: "done"
created: "2026-10-01T17:25:12.740Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: session names [team--]node--repo--role--persona with identity in metadata (ADR-0030)"
epic: "EP-023"
acceptance: [{"text":"every tmux session ao creates is named [team--]node--repo--role--persona with '--' separators and slugged segments; no numeric collision suffix exists in the code","done":true,"at":"2026-10-02T13:10:25.692Z"},{"text":"each session carries a ULID and agent/role/repo/node/team as tmux options; every reader identifies agents from that metadata (an arbitrarily named session with the options is identified; an ao-looking name without them and not legacy-shaped is not)","done":true,"at":"2026-10-02T13:10:26.130Z"},{"text":"an agent can hold only one live session; a second spawn of a live agent is refused with the holding session named (the handoff flow replaces this refusal in its own task)","done":true,"at":"2026-10-02T13:10:26.534Z"},{"text":"persona allocation goes through a registry interface; the local implementation guarantees uniqueness per repo under concurrent spawns (tested with parallel allocators) and adds a surname when first names run out","done":true,"at":"2026-10-02T13:10:26.969Z"},{"text":"node name from AO_NODE_NAME / ao config / short hostname and repo from the origin remote, with tests for a dotted hostname, a folder with spaces and parentheses, no remote, and legacy ao-<id> sessions still recognised","done":true,"at":"2026-10-02T13:10:27.430Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: ["ADR-0030","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/153"]
blockedBy: []
blocks: ["TM-279","TM-280"]
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
triagedBy: "human"
updated: "2026-10-02T13:55:21.014Z"
comments: [{"author":"main","ts":"2026-10-02T03:10:23.494Z","text":"PR #144 (0.13.0, base #143). Fast-forwarded locally to 4a4af11c; installed plugin 4a4af11c5443; services restarted, supervisors stable (pids unchanged over several minutes); legacy ao-fd2b831f still resolved. Role cap 48 / name limit 160 per user. Suite isolated: 878/874/0/4, default tmux sessions 15→15. Not live with a provider CLI."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:28.237Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."}]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:27.884Z"}}
closed: "2026-10-02T13:10:28.703Z"
links: [{"type":"duplicated by","id":"TM-270"}]
---

Implements ADR-0030 parts 1-2 and the local half of part 3. Name: [team--]node--repo--role--persona, '--' separator, each segment slugged to [a-z0-9-] and capped. node = AO_NODE_NAME, else ao user config node name, else short hostname. repo = slug of the git origin remote repository name (owner in metadata); folder name only without a remote. team = from workflow/run/--team, omitted when absent. persona = agent's stable first name; surname added when the first-name pool for the scope is exhausted. Every session records a global ULID plus agent/role/repo/node/team as tmux session options; all readers (parseSessionName, presence, observer, lead, reviewer, roles, census, startup, delivery) resolve identity from metadata. Legacy ao-<id> and <id>-<spawn> sessions still recognised. One live session per agent. Persona allocation goes through a registry interface whose implementation here is a local file lock (repo/solo scope); the NATS KV team registry and the re-spawn handoff are separate tasks.
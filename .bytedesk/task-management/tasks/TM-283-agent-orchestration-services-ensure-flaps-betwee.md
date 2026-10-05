---
id: "TM-283"
kind: "task"
status: "done"
created: "2026-10-02T03:37:49.236Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: services ensure flaps between equivalent plugin copies and lets an older session downgrade the managed services"
epic: "EP-023"
acceptance: [{"text":"two copies of the same build (different paths) produce no pointer change and no restart on alternating ensure calls (test records restart calls)","done":true,"at":"2026-10-02T13:10:32.404Z"},{"text":"an ensure from an older package version does not re-point or restart while the newer pointer's root exists; it re-points when that root is gone (tests)","done":true,"at":"2026-10-02T13:10:32.834Z"},{"text":"a newer version re-points and restarts exactly once","done":true,"at":"2026-10-02T13:10:33.250Z"}]
evidence: [".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md"]
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-02T19:00:42.209Z"
comments: [{"author":"main","ts":"2026-10-02T03:45:16.831Z","text":"Shipped locally at 46b33ea4 (0.13.2); live ensure from cache/source/other cache → no changes. PR opened (base #145)."},{"author":"@dc778cb2","ts":"2026-10-02T13:10:34.092Z","text":"Closed by Bastion TM-006 (lead dc778cb2): PR merged into fix/ao-local-nats-autostart (head 35488ce2, not yet main). Each criterion verified against merged code and recorded evidence; see .bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md."},{"author":"@dc778cb2","ts":"2026-10-02T19:00:42.204Z","text":"FOLLOW-UP (2026-10-02): the services pointer was captured by a worker worktree — the TM-276 worker ran 'services ensure' from its task worktree, and TM-283's fingerprint rule kept that path for the identical build. The installed plugin cache must win over a checkout/worktree for the same fingerprint, and dispatched workers must not run services ensure. Repointed by hand by the marketplace session."}]
knowledge: ["/runbooks/ao-rollout-lessons-managed-services-naming-multi.md"]
evidenceSources: {".bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md":{"source":"/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace/.bytedesk/task-management/evidence/TM-006-closure-audit-2026-10-02.md","sha256":"1ff3962db490e740ae7b2844b8938497b7ea480dc6fdab98c647a1adde72ef5b","bytes":5647,"at":"2026-10-02T13:10:33.645Z"}}
closed: "2026-10-02T13:10:34.459Z"
---

Observed 2026-10-02 after shipping 0.13.1: current.json alternated between the installed cache (…/agent-orchestration/60a3328828f4) and the directory-marketplace source tree (…/bytedesk-marketplace/agent-orchestration), because Claude sessions run ao from the source tree. pluginSha() takes the folder basename for a cache and the build fingerprint for a checkout, so two copies of the same build look different and every SessionStart ensure restarts all managed processes. Worse, last-writer-wins: a session still running an older plugin root re-points the services at older code (e.g. pre-0.13 sessions would downgrade naming/reconnect fixes). Fix: identify a plugin by its build fingerprint + package version, keep the existing pointer when the fingerprint matches (no restart, no flap), never re-point to an older version while the current pointer's root still exists, and restart only when the effective code changed.
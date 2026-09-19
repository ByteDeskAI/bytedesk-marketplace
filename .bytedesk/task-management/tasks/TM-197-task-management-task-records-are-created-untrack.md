---
id: "TM-197"
kind: "task"
status: "open"
created: "2026-09-13T19:22:53.473Z"
board: "bytedeskai/bytedesk-marketplace"
title: "task-management: task records are created untracked and silently stay local"
epic: "EP-019"
acceptance: [{"text":"A newly created task record is tracked, or the store reports the tracked-vs-on-disk gap so it cannot go unnoticed","done":false},{"text":"The check is a tracked-vs-on-disk pass, not a reference walk, since a record with no reference is invisible to reference auditing","done":false},{"text":"Evidence logs land durably despite *.log being gitignored in consumer repos","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
labels: ["plugin:task-management","ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:47.784Z"
---

Measured in ByteDeskAI/bytedesk-remote-gateway: 329 task records on disk, 308 tracked on
origin/develop. 21 records existed ONLY on that machine, covering the whole recent body of
work - TM-306 through TM-322 - including tasks already closed, merged and cut over. The code
had survived on the remote; the record of what it was and why had not.

THE GAP IS CONTINUOUS, NOT A BACKLOG. After a sweep closed it at 329/329, a session filed one
new task and it reopened at 330/329 within minutes. Every record is created untracked and
stays local until someone happens to commit the store, so a one-time sweep fixes that day
and nothing after it.

## Why a reference audit cannot find this

An audit that walks evidence references finds DANGLING references - a citation whose target
is gone. This is the opposite: records with no reference at all, because the record itself
never left the machine. The same repo has 116 dangling references (historical, pre-dating
evidenceSources) and they are a different problem entirely. Finding this class needs a
tracked-vs-on-disk pass.

## Related, same root

Evidence artifacts hit it twice over. In that repo:
- Run artifacts under .bytedesk/agent-orchestration/runs/*/artifacts/ are gitignored and die
  with their worktree, so a citation into them dangles the moment the tree is collected.
- Copying them out is NOT enough: the copies are still untracked, and *.log is gitignored
  repo-wide, so they need `git add -f`. 37 evidence logs there are already tracked that way,
  so the convention exists but is invisible to anyone who does not already know it.
- And the thing doing the citing must be tracked too. One commit landed four log files but
  neither the evidence file explaining them nor the task record marking the task done - on a
  fresh clone, logs present, nothing saying what they were, no record of completion.

So the rule an author needs is three checks, not one:
  1. What does the evidence cite? Paths inside a worktree die with it.
  2. Is what it cites tracked? *.log is ignored repo-wide and needs -f.
  3. Is the thing doing the citing tracked, and the task record with it?

Found by a worker session that checked its own evidence before releasing its worktree, then
checked the fix and found the layer under it.

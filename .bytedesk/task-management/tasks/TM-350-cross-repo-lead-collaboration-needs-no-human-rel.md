---
id: "TM-350"
kind: "task"
status: "open"
created: "2026-10-05T10:55:44.090Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Cross-repo lead collaboration needs no human relay: upstream tickets, delivery, release propagation, auto-resume"
acceptance: [{"text":"A consumer lead files an upstream bug with one command; the upstream store gets the ticket and the upstream lead gets a notice, with no human relay.","done":false},{"text":"Cross-repo lead mail is delivered when both leads are live; held mail falls back to a supported channel automatically; non-roster worker sessions can receive mail for their task.","done":false},{"text":"Closing the upstream ticket with a merge SHA notifies subscribed consumers and resolves the cross-repo dependency; the consumer task unblocks and its lead is woken.","done":false},{"text":"Update activation is automated where possible, and the remaining required reloads are reported precisely; an end-to-end test replays today's TM-347 flow with no human step.","done":false}]
evidence: []
commits: ["https://github.com/ByteDeskAI/bytedesk-marketplace/pull/new/tm/TM-388-plugin-rsync-json-activation-report","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/186","https://github.com/ByteDeskAI/bytedesk-marketplace/pull/196"]
blockedBy: ["TM-347","TM-348","TM-349"]
blocks: []
actor: "main"
session: "4095d405-92ce-4bc7-89d0-b8b887cf255e"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["needs-triage"]
triagedBy: "auto"
updated: "2026-10-08T23:33:45.024Z"
triageMissing: ["epic"]
priority: "high"
type: "story"
comments: [{"author":"main","ts":"2026-10-05T10:56:07.990Z","text":"Lead triage (fd2b831f, 2026-10-05): accepted. This is epic-sized (5 parts) and part 1 crosses a trust boundary: a consumer writing into the upstream store needs an authority rule (ADR) before code. Sequenced after TM-347..349, which edit the same CLI and management files. Next: design and decomposition into child tasks, then dispatch the independent parts in parallel."},{"author":"main","ts":"2026-10-05T15:23:33.049Z","text":"Follow-up to file when the WIP gate frees: two cross-repo blocker models now coexist after the TM-400 round-2 sync (PR #221): TM-382 foreignBlockers[] (tm dep owner/repo#TM-n, resolved by tm upstream-resolved --landed) and main's TM-381 foreign 'blocked by' links (tm ticket --from-task, removed by the merged event). Both sit behind one dependenciesMet and one foreignRef parser. TM-383 (upstream file) and TM-385 (release watch) must build on ONE of them: decide which (likely TM-381's ticket path, since it already covers filing + merged event) and retire the other."}]
---

Requested by Ryan (operator), 2026-10-05, through the bytedesk-agent-browser lead (Ines, c1b0c1fd). Ryan's words: this should all be automated between leads and the fixing repo, so they can collaborate with no human intervention.

What happened today (TM-347, TM-348, TM-349): each step needed a person.
1. Filing: the consumer lead wrote into the marketplace task store by hand and then messaged the marketplace lead. No verb exists for this.
2. Delivery: 'mailbox send' cross-repo was held with leads_not_ready, so the message only arrived through a Claude cross-session message. Mail to a non-roster worker session (Codex 01a10af6) is held as unknown_recipient, so its only channels were task comments and typing into its tmux pane.
3. Release: the consumer cannot learn when the fix lands. It relies on the upstream lead remembering to message it, and on Ryan running plugin-rsync or /reload-plugins.
4. Resume: blocked consumer tasks (agent-browser TM-010, TM-030) have no machine-readable link to the upstream ticket, so nothing wakes the consumer lead to run 'manage rework' or re-admit.

Wanted:
- Filing: 'ao-topology upstream file --repo <dir> --title --body --priority --ac... [--blocks <local TM-id>]'. It creates the ticket in the upstream store, records a cross-repo dependency on the local task, and delivers a notice to the upstream lead.
- Delivery: cross-repo mail reaches a live, probe-responsive lead without manual enrollment. When the standing mailbox is not ready, fall back automatically to the session channel. Non-roster worker sessions working on a repo's task can register as mail recipients (for example as the task thread owner).
- Release events: when an upstream ticket closes with a merge commit, notify every subscribed consumer lead, with the ticket, merge SHA and the reload actions needed.
- Activation: a consumer can apply the update with no human. Note that ao-topology and tm already run straight from the marketplace checkout, so CLI changes are live once merged there. Only hooks, skills and MCP need a reload; automate whatever can be (plugin-rsync, cache refresh) and report exactly what still needs a session reload.
- Auto-resume: when the upstream dependency resolves, the consumer's blocked task unblocks and its lead is woken. Re-admit, rework or dispatch then follow under the existing gates.

Limits (keep them): auto-mode refuses credential sharing, settings and permission edits, and spawning unrestricted agents. Those stay human decisions; the automation must surface them, not work around them.
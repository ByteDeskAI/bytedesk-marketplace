# TM-384 landing

- PR #196 (tm/TM-384-mail-fallback) merged into fix/ao-local-nats-autostart at 8d88a92afd4fece59d1f5e2417bc7c049baa942e, at head 2e028278.
- Implementation commit: e978da5f. Commit 2e028278 is the lead's integration merge with PR #194. Only dist conflicted, and the reviewed source files are blob-identical.
- Independent review: APPROVE. Record: https://github.com/ByteDeskAI/bytedesk-marketplace/pull/196#issuecomment-5995560308
- AC1: mail held as leads_not_ready to a live lead rings the lead pane after one recovery backoff, at most once per window. The outcome is recorded as `lead_ring` on the record.
- AC2: `task:<TM-id>` resolves to the bound worker. A same-repo sender reaches it directly; a cross-repo sender needs delegationAllows, otherwise the mail goes to the lead.
- AC3: a non-roster Codex worker receives its `task:<id>` mail, covered by a test. The bell is injected; no test touches tmux.
- Checks on the merged tree: test:unit exit 0 (1045/0/4), build:check exit 0, plugin validate exit 0, CI green.
- Follow-ups: TM-403 (cross-repo delegation name match), TM-402 (wakeLead tmux server).

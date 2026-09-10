# EP-018 — a governed orchestration, run end to end

**It ran.** `bytedesk-tmux-manager`, isolated tmux socket, three agents, two stages, both answered,
torn down to nothing. This is the fourth attempt; the three before it are the reason it works, and
each failure is now a fixed defect rather than a note.

## What happened

```
lead ensure          -> registered, and RESPONSIVE after the probe rang it
reviewer ensure      -> registered, and RESPONSIVE after the probe rang it
launch --spec …      -> ep018-demo-20260909-225744-4jjz, three panes: conductor, scribe, checker
send conductor->scribe   -> ring: submitted ("the pointer was typed and the composer is empty again")
wait --message 005       -> the scribe replied, in its own words, from README.md
send conductor->checker   -> ring: submitted
wait --message 006        -> the checker verified the claim against the file, quoting the lines
census                   -> 5 agents: lead idle, reviewer idle, orchestrator working, 2 workers
stop --run …             -> session gone, files kept
```

The scribe's reply, unedited:

> This repository is `bytedesk-tmux-manager`: a free ByteDesk Gateway plugin that manages tmux on
> the host … It is the ADR 0024 pilot: `internal/tmuxctl` and `internal/tmuxmgr` are
> gateway-independent, `cmd/tmux-manager/main.go` exists only for the spawned form …

The checker's, which is better than the demo deserved — my message truncated the scribe's sentence
mid-word, and it noticed:

> Agree: README.md line 15 reads "## It is the ADR 0024 pilot" … The scribe's sentence is cut off
> mid-word at "are gatewa", so I verified the claim it was evidently making … rather than a
> completed sentence.

## The four defects that stood between attempt 1 and attempt 4

| # | defect | where it was found |
|---|---|---|
| 1 | **TM-155** — a repository Claude has never been trusted in shows a folder-trust modal, and nothing says so | run 1, `bytedesk-bench` |
| 2 | **TM-151** — a ready composer rendering a placeholder hint reads as not-ready, so the role is never REGISTERED and every launch refuses | run 2, measured on live panes: shipped pattern 0, fixed 12 |
| 3 | **TM-157a** — the readiness probe was file-only with a 1s window and nothing woke an idle agent, which has no next boundary to poll at | run 3 |
| 4 | **TM-157b** — the pane-observed ack was an exact string match, and Claude prefixes its output with `● `, so a perfectly obedient answer could never match | run 3, seen as `● AO_REVIEWER_READY <nonce>` while the check said unresponsive |

Two more fell out of run 4 itself:

- **The proof was thrown away after every call.** Responsiveness was re-proven from scratch each
  time, so a launch — which needs the lead AND the reviewer responsive in the SAME call — needed two
  independent model turns to land inside one window. They never aligned. An ack is now remembered
  for `AO_RESPONSIVE_TTL_MS`, bound to the six-tuple so a respawn invalidates it. This is the
  epic's own "fewest possible AI turns" applied to the epic's own handshake.
- **The composer question is answerable, and we were not asking it.** A composer holding only
  Claude's dim suggestion text is EMPTY; one bright character means a draft. `capture-pane -e`
  keeps the distinction, `capture-pane -p` destroys it. Both the wake and the bell now take one
  styled look when — and only when — the cheap server-side test says "not empty".

## What this proves about the epic's own design

Everything EP-018 built behaved as specified once the readiness path stopped lying:

- **The launch gate refused before creating anything**, three times, and never left a half-built run.
- **Nothing was ever typed into an unsafe pane.** The trust modal draws `❯ No, exit`; the plugin
  never pressed Enter at it. TM-111 held under every one of these failures.
- **The census was right every time the two disagreed** — five for five now. It called the reviewer
  `idle` while the launcher called it not-ready, and named the trust modal with its remedy
  unprompted. The readiness path re-derives, worse, something the census already knows; that is an
  architecture question and it belongs to Ryan, not to a regex ticket.
- **Delivery reported what it observed**, not what it hoped: `submitted — the pointer was typed and
  the composer is empty again`, per recipient.
- **A refusal named itself.** The first cross-project send held with `source_identity_required`
  rather than delivering, because I had omitted `--from-project`. Correct, and the reason was
  legible enough to fix in one attempt.

## Teardown

Socket-scoped `kill-server`, supervisor stopped, run stopped, `.bytedesk/` removed, repository at
zero dirty files, every state file for the demo repositories deleted, other repositories untouched.

Two sessions on the operator's DEFAULT socket appeared during this window (`ao-eff264fa` 22:52 and a
gateway session 23:03). They are not mine — this demo ran entirely on `/tmp/aodemo5` — and I left
them alone.

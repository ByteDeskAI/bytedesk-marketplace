---
id: "TM-195"
kind: "task"
status: "open"
created: "2026-09-12T19:09:41.417Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: a verdict quoting shell code emits invalid JSON through the reviewer pane"
epic: "EP-019"
acceptance: [{"text":"A verdict whose finding text contains double quotes, or that wraps on a space, is collected intact","done":false},{"text":"The encoding cannot silently corrupt a JSON key, and a malformed response is still rejected rather than repaired","done":false},{"text":"The reviewer instruction and the collector agree on the encoding, with a transition that does not strand a running reviewer","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "58d7cd20-54ac-45c8-84a6-ea82dbebfad2"
labels: ["plugin:agent-orchestration","ready-for-human"]
triagedBy: "human"
updated: "2026-09-13T21:29:47.537Z"
---

Found collecting eight real verdicts from a live reviewer. Two of the eight could not be
parsed, and the cause is the transport, not the reviewer's judgement.

The reviewer is deliberately write-free (--restricted --safe-mode, no Write/Edit, no shell),
so its only return channel is text on its own tmux pane: `AO_REVIEW <nonce> {json}`. A TUI
pane hard-wraps at its width BEFORE tmux can see it, and bare JSON does not survive that
round trip.

## Two failure modes, both observed

1. UNESCAPED QUOTES. A reviewer of CI scripts quotes shell constantly, and the emitted JSON
   then contains raw double quotes inside a string:

       "resolution":"rm -f "$GW_TMPDIR_LINK" before the ln, ..."
       "summary":"... sets GOMAXPROCS="${GOMAXPROCS:-1}", so ..."

   That is invalid JSON at the source. No rejoin can rescue it and the collector correctly
   rejects it - but the verdict is lost and the reviewer is not told why.

2. SPACE LOST ON A WRAP BOUNDARY. tmux cannot distinguish the TUI's padding from a real
   space that fell exactly at the wrap column, so rejoining either loses that space
   ("a TeamCity buildcancelled") or invents one. Inventing is worse: a wrap landing mid-key
   turns {"severity" into {"s everity", which is still valid JSON with a silently wrong key.
   The collector now concatenates without a separator for that reason - prose corruption is
   visible, structural corruption is not - but the loss is real.

## Why the obvious fixes do not work

- `capture-pane -J` does not help: the TUI wraps before tmux sees the text, so there are no
  soft-wrapped lines to rejoin.
- Writing the response to a file would require giving the reviewer write capability, which
  destroys the property the design exists to protect.

## Suggested direction

Encode the payload so the channel cannot corrupt it - base64 of the JSON has no quotes to
escape and no spaces to lose, so both failure modes disappear at once and the collector can
still reject anything that does not decode. It changes the contract, so the reviewer
instruction (reviewer.mjs, the AO_REVIEW line) and the collector must move together, and a
reviewer already running under the old instruction needs a transition.

Partial mitigations already landed on fix/reviewer-collect-reassembles-wrapped-json:
rejoining wrapped lines at all, reading the whole scrollback rather than a fixed window,
and never inventing a separator.

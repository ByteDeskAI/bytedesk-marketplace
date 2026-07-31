---
id: "TM-047"
kind: "task"
status: "open"
created: "2026-07-31T07:35:31.222Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The MCP handshake tells every client its version is 'dev'"
epic: "EP-005"
acceptance: [{"text":"A client sees a version that identifies the code it is talking to","done":false},{"text":"Whatever it reports is consistent with how this plugin is versioned — by commit","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T07:35:56.578Z"
---

## Problem
`initialize` answers `"version":"dev"` to every client. That is the honest fallback — the Claude
manifest carries no `version` on purpose, because this plugin versions by commit SHA — but "dev" is
useless to the thing asking. A client cannot tell one build from another, which is the entire
reason the handshake carries a version.

This is the same trap 0.6.0 fixed in the other direction: `SERVER_INFO` used to hardcode `0.3.0`
and lied. `dev` does not lie, it just says nothing.

## Proposal
Report the commit the code came from. `git rev-parse --short HEAD` in the plugin directory answers
it for a source checkout, and an installed copy under `~/.claude/plugins/<sha>/` has the SHA in its
path. Fall back to `dev` only when neither is available, which is then a true statement rather than
a default.

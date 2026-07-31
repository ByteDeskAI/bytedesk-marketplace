---
id: "TM-047"
kind: "task"
status: "done"
created: "2026-07-31T07:35:31.222Z"
board: "bytedeskai/bytedesk-marketplace"
title: "The MCP handshake tells every client its version is 'dev'"
epic: "EP-005"
acceptance: [{"text":"A client sees a version that identifies the code it is talking to","done":true,"at":"2026-07-31T08:43:03.489Z"},{"text":"Whatever it reports is consistent with how this plugin is versioned — by commit","done":true,"at":"2026-07-31T08:43:03.554Z"}]
evidence: [".bytedesk/task-management/evidence/TM-047-mcp.mjs"]
commits: ["475d4fc"]
blockedBy: []
blocks: []
actor: "main"
session: "61c67728-2ff2-46ea-87eb-2a99db9c96bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-07-31T08:43:03.745Z"
comments: [{"author":"main","ts":"2026-07-31T08:43:03.673Z","text":"An installed copy already answered with the SHA from its own path — ~/.claude/plugins/.../<sha>/ — so only a source checkout said 'dev'. It now asks git: describe --always --dirty, which answers v1.3.0-129-g475d4fc-dirty here. The -dirty matters: a client comparing two handshakes should be able to see that the code moved even when the commit did not. 'dev' was honest and useless, which is the mirror of the 0.3.0 literal 0.6.0 removed — that one lied, this one said nothing. Falls back to 'dev' only with no manifest version, no SHA in the path and no git, where it is finally a true statement rather than a default."}]
closed: "2026-07-31T08:43:03.741Z"
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

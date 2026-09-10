---
id: "TM-137"
kind: "task"
status: "open"
created: "2026-09-09T21:32:52.887Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Presence schemaVersion 2: open the role vocabularies for standing designer and image-gen"
epic: "EP-018"
acceptance: [{"text":"The v2 addendum opens repoRole and runRole — preferably by making rendering roleName-driven rather than by enumerating every future role — with its own fixture set and its own countersignature from the gateway coordinator.","done":false},{"text":"A v2-aware consumer still parses v1 correctly, and the version bump lands on both sides in the same negotiated step.","done":false}]
evidence: []
commits: ["4f67d94","20e9df2"]
blockedBy: ["TM-136"]
blocks: []
actor: "main"
session: "e01dd923-50ea-45d8-9911-b9d5faed94bd"
branch: "main"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
updated: "2026-09-10T05:05:52.713Z"
---

Frozen v1 section 3 pins repoRole to lead|reviewer|member and says Team lead is rendered from repoRole===lead and from nothing else, and runRole lacks image-gen. So a standing designer or image-gen collapses to member and the gateway header cannot label it — which is exactly what the operator asked to see. This is a genuine wire-format change and therefore schemaVersion 2, negotiated with the gateway exactly as v1 was. Do not promise the operator a header that labels a standing designer before this lands.
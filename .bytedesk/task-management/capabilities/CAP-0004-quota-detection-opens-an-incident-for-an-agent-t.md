---
id: "CAP-0004"
kind: "capability"
status: "open"
created: "2026-09-10T01:58:15.307Z"
board: "bytedeskai/bytedesk-marketplace"
title: "Quota detection opens an incident for an agent that printed the signature then ended its turn"
area: "product"
impact: "M"
effort: "M"
confidence: "M"
source: "research"
evidence: []
related: []
updated: "2026-09-10T01:58:15.312Z"
---

A false positive TM-135 knowingly ships. An agent that prints a quota signature and then ENDS ITS TURN is alive but not animating, and the words do not scroll away, so defence 1 (the match still present on a second capture 2s later) and defence 2 (the progress test) both pass and an incident opens.

Cost is bounded and was weighed rather than missed: one incident record and one message to the lead, in EVERY consent mode — including auto — because failoverAgent has exactly one caller in the tree (cli.mjs:1089) and the supervise tick cannot take a pane over under any consent value. So the failure mode is noise, never an unwanted provider substitution.

The shape is the one quota.mjs defence 2 already names: an agent working on this feature puts the signature on its own screen. The progress test catches it while the agent is mid-turn and stops catching it the moment the turn ends.

Worth considering: treat 'ended its turn with the signature on screen and no prior incident' as needing the third signal rather than two, or require the signature to appear in a region the agent did not author. Not urgent — the consent gate means a false positive costs one message, which is the property AC9 was written to guarantee.
---
id: "TM-308"
kind: "task"
status: "in_progress"
created: "2026-10-03T01:50:14.096Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: managed NATS port chosen once per machine, stored as nats.port in the developer's ao config; ignore ambient NATS_URL (ADR-0032)"
epic: "EP-019"
acceptance: [{"text":"first managed start on a machine with no nats.port picks a free high port, writes it to the user config, and later starts (including after reboot/process-compose restart) use exactly that port (test with temp HOME/XDG_CONFIG_HOME)","done":false},{"text":"a configured port held by another process is reported with the holder and NATS is not started elsewhere (test)","done":false},{"text":"with NATS_URL set to an unreachable server and no AO_NATS_URL, ao uses managed NATS without a fallback warning or outage report, and logs once that NATS_URL is ignored (test)","done":false},{"text":"existing state.json port is adopted on upgrade when free (test); live on this machine nats.port is written and services status shows nats://127.0.0.1:<nats.port>","done":false}]
evidence: []
commits: ["ADR-0032","744ed614","1926ebb0"]
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-agent"]
triagedBy: "auto"
updated: "2026-10-03T03:53:32.585Z"
comments: [{"author":"main","ts":"2026-10-03T03:09:46.911Z","text":"Shipped #171 (744ed614, 0.15.3) + follow-up #173 (1926ebb0, 0.15.4); main via #172 and the next PR. Live: nats.port 39617 adopted into ~/.config/agent-orchestration/config.json; services status nats://127.0.0.1:39617; port kept across nats and unit restarts; NATS_URL ignored (logged); doctor shows no NATS problem; transport.json free of NATS_URL."}]
---

Implements ADR-0032. Today nats-local.mjs takes an OS-random ephemeral port (listen(0)) and orch-transport treats the generic NATS_URL as a configured source, so a down port-forward (~/.zshenv NATS_URL=nats://localhost:4222) triggers fallbacks and outage reports. Change: nats.port in $XDG_CONFIG_HOME/agent-orchestration/config.json, chosen on first managed start from free ports in a high range that avoids ao's session-host (45000–45032) and process-compose (45100–45199) ranges, validated 1024–65535; reused every start; a taken port is reported (services status, doctor, lead via ADR-0031) and never silently replaced; sources AO_NATS_URL > gateway orch.sock > managed local; generic NATS_URL ignored and logged once; migration adopts the existing state.json port when free. Must also work through services ensure / process-compose (the nats process entrypoint uses the configured port) and on macOS/Windows.
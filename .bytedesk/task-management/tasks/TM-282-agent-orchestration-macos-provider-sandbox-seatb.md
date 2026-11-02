---
id: "TM-282"
kind: "task"
status: "parked"
created: "2026-10-02T02:22:24.508Z"
board: "bytedeskai/bytedesk-marketplace"
title: "agent-orchestration: macOS provider sandbox (Seatbelt) so runs execute on darwin"
epic: "EP-023"
acceptance: [{"text":"on macOS a read-only and a write run both execute inside the sandbox; writes outside the worktree/scratch are denied (verified on a real Mac)","done":false},{"text":"no /dev/shm assumption remains on the darwin path; doctor reports the darwin isolation kind","done":false}]
evidence: []
commits: []
blockedBy: []
blocks: []
actor: "main"
session: "62549d39-62d5-458d-808e-8375ef53518d"
branch: "fix/ao-local-nats-autostart"
worktree: "/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-marketplace"
labels: ["ready-for-human"]
triagedBy: "human"
updated: "2026-10-09T05:23:49.851Z"
comments: [{"author":"main","ts":"2026-10-02T04:16:36.037Z","text":"Prep done on tm/TM-282-ao-darwin-seatbelt (d9ab3b64, 0.15.0): Seatbelt profile + sandbox-exec launch, portable scratch, gate (off unless AO_DARWIN_SANDBOX=seatbelt), Mac kit scripts/verify-darwin-sandbox.mjs + docs/darwin-verification.md. Lead re-ran: darwin/provider tests 29/29; kit on Linux prints FAIL 'host is macOS' and exits 1 (checked without a pipe). Remaining: run the kit on a real Mac (one command: cd agent-orchestration && node scripts/verify-darwin-sandbox.mjs), then flip the default in seatbeltGate."}]
touches: [".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/AGENTS.md",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/CHANGELOG.md",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/README.md",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/bin/tm-hook",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/docs/agent-first.md",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/hooks/tm-hook.sh",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/dispatch/index.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/dispatch/tmux.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/dispatch/topology.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/render.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/worker-guard.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/lib/worker-identity.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/tests/unit/worker-guard.test.mjs",".claude/worktrees/agent-a0035fcc61ff11c0e/task-management/tests/unit/worker-identity.test.mjs",".claude/worktrees/agent-a8a5279aabf195587/agent-orchestration/CHANGELOG.md",".claude/worktrees/agent-a8a5279aabf195587/agent-orchestration/tests/unit/mailbox-receipts.test.mjs",".claude/worktrees/agent-a8a5279aabf195587/agent-orchestration/tests/unit/mailbox-robustness.test.mjs",".claude/worktrees/agent-a8a5279aabf195587/agent-orchestration/topology/lib/mailbox-receipts.mjs",".claude/worktrees/agent-a8a5279aabf195587/agent-orchestration/topology/lib/standing-mailbox.mjs"]
parkedReason: "Parked by the marketplace lead 2026-10-09: no activity for days and no darwin machine in the fleet; freeing a WIP slot for EP-029. Resume when macOS execution is needed."
---

TM-273 gave darwin a worker backend but fails closed: every provider run on macOS is refused with AO_SANDBOX_UNAVAILABLE, because provider-sandbox.mjs / linux-network.mjs are bubblewrap + slirp4netns/pasta (Linux-only) and provider-sandbox.mjs and acpx-driver.mjs use /dev/shm. Build a darwin sandbox strategy (sandbox-exec / Seatbelt profile: filesystem write confined to the run worktree and scratch, network policy matching the Linux contract) and a portable scratch location.
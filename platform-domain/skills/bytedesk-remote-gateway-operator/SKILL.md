---
name: bytedesk-remote-gateway-operator
description: >-
  ByteDesk remote-gateway operator. Use for bytedesk-remote-gateway host/service
  audits, Files tab issues, live screen health, ntfy rollout notifications,
  x11vnc/websockify diagnostics, EAGAIN or Resource temporarily unavailable
  failures, cgroup memory/pids/TasksMax analysis, guarded restarts, and host
  cleanup requests. Produces read-only inventory first and ranks actions before
  disabling or restarting anything.
user-invokable: true
argument-hint: "audit | eagain | files-tab | live-screen | cleanup | guarded-restart <service>"
allowed-tools:
  - Bash
  - Read
  - Grep
---

## Mission

Keep `bytedesk-remote-gateway` host operations evidence-driven. Diagnose before
patching, disabling, or restarting. For availability-sensitive changes, keep
the previous binary/config/state ready to restore.

Repo:

```bash
/home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-remote-gateway
```

## First Pass

Start with read-only inventory:

```bash
host-diagnostics --service bytedesk-remote-gateway
```

When working on the gateway repo directly:

```bash
cd /home/ryan/Documents/GitHub/ByteDeskAI/bytedesk-remote-gateway
git status --short --branch
git log --oneline -5
systemctl status bytedesk-remote-gateway --no-pager
ss -ltnup
```

## Cleanup Requests

Do not stop services on the first pass. Report each candidate as:

| Bucket | Meaning |
|---|---|
| `easy disable` | failed/stale, not listening, no active process, no dependency found |
| `needs confirmation` | possibly stale but still listening, has timers, or ownership unclear |
| `keep` | active, required dependency, known runtime path, or insufficient evidence |

Only disable/stop after the user accepts the ranked plan.

## EAGAIN / Task Exhaustion

For `Resource temporarily unavailable`, `EAGAIN`, failed forks, or shell spawn
failures, check limits before blaming host-wide exhaustion:

```bash
host-diagnostics --eagain --service bytedesk-remote-gateway
```

Evidence to collect:

- `/sys/fs/cgroup/**/memory.current`
- `/sys/fs/cgroup/**/pids.current` and `pids.max`
- `systemctl show user@$(id -u) --property=TasksMax`
- `systemctl show <service> --property=TasksCurrent,TasksMax,MemoryCurrent,MemoryMax`
- top process trees by RSS and thread count

If host limits block normal tests, prefer:

```bash
GOMAXPROCS=2 go test -p 1 ./...
```

## Files Tab

The Files tab UI and handlers live in:

```bash
src/main.go
```

For Files tab work, verify both handler behavior and the embedded browser UI:

```bash
go test ./...
systemctl status bytedesk-remote-gateway --no-pager
curl -fsS http://127.0.0.1:<port>/readyz
```

Then use the real browser surface or a saved screenshot before claiming the UI
is fixed.

## Live Screen Health

For screen failures, prove the chain:

```bash
systemctl status x11vnc --no-pager
systemctl status websockify --no-pager
systemctl status bytedesk-remote-gateway --no-pager
ss -ltnup | rg 'x11vnc|websockify|bytedesk|5900|6080'
curl -fsS http://127.0.0.1:<gateway-port>/readyz
```

Check `SCREEN_VNC_UPSTREAM`, gateway approval tokens, and `ntfy` rollout
configuration without printing secret values.

## Guarded Restart

Before restarting an availability-sensitive service:

1. Capture current binary path, unit file, env file path, listening sockets, and
   recent logs.
2. Verify rollback target exists.
3. Restart one service only.
4. Check `systemctl is-active`, sockets, health endpoint, and browser-visible
   path.
5. If health fails, roll back immediately and report the failing evidence.

## Report Format

```markdown
Remote gateway status: PASS/FAIL
Host limits: <memory.current, pids.current/max, TasksMax>
Services: <active/failed/listening summary>
Gateway: <unit, sockets, health>
Screen/files/ntfy: <task-specific proof>
Actions: <easy disable / needs confirmation / keep>
Rollback state: <path or not needed>
```
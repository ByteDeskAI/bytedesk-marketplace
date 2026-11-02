# TM-242 evidence — standing-agent panes start at the repository root

Base commit: 25bd49b. Claude Code 2.1.282. Date: 2026-09-25.

## 1. Which mechanism works (measured, not assumed)

Probe repo /tmp/tm242probe/repo, cwd sub/agent (with its own .claude/settings.json Stop hook):

| launch | recorded by Stop hook |
|---|---|
| `CLAUDE_PROJECT_DIR=/tmp/tm242probe/repo claude -p ...` from sub/agent | `PD=/tmp/tm242probe/repo/sub/agent` |
| same, CLAUDE_PROJECT_DIR unset | `PD=/tmp/tm242probe/repo/sub/agent` |
| from repo root | `PD=/tmp/tm242probe/repo` |

Claude Code overwrites an exported CLAUDE_PROJECT_DIR with the launch directory. **Exporting is not
enough; the launch directory is the mechanism.**

## 2. Live pane (acceptance criterion 2)

Temporary repo /tmp/tm242-live/repo, Stop hook appends $CLAUDE_PROJECT_DIR to /tmp/tm242-live/stop.txt.
`ao-topology agent new --role lead --cli claude` → cb262ba1; `ao-topology session open cb262ba1` from
this worktree's code. Pane cwd (`#{pane_current_path}`): `/tmp/tm242-live/repo`. Launcher: `cd /tmp/tm242-live/repo`.

stop.txt after the lead's first turn:

```
CLAUDE_PROJECT_DIR=/tmp/tm242-live/repo PWD=/tmp/tm242-live/repo AO_AGENT_DIR=/tmp/tm242-live/repo/.bytedesk/agent-orchestration/agents/cb262ba1
```

The agent directory is still exported (AO_AGENT_DIR) and recorded (session.json agent_dir).
Note: `session open` itself reported TOPOLOGY_SESSION_START because Claude Code's first-run
workspace-trust dialog in a brand-new temp repo held the pane past the readiness wait; accepting it by
hand let the session run. That is a property of an untrusted fresh folder, not of this change.
Session closed afterwards with `session close`.

## 3. Unit suite

`node --test --test-concurrency=1 tests/unit/*.test.mjs`, TMUX unset:
- this change (uncommitted tree listed in commit): 691 tests, 678 pass, 9 fail, 4 skipped.
- clean HEAD 25bd49b in a separate detached worktree: 687 tests, 674 pass, 9 fail.
- The 9 failure names are identical in both (diff empty): control-seam, mcp-contract, runtime-engine,
  service-routing, session-host, session-supervisor files (need node_modules, absent in worktrees), and
  three tm-CLI integration tests. None is caused by this change.
- New guard "a standing agent's pane launches at the repo root…" fails with the fix reverted
  (actual `…/consumer1`, expected `…/repo`) and passes 3/3 with it. It runs on its own -L server with
  TMUX blank and TMUX_TMPDIR set, per tmux-test-isolation.md.
- topology-tmux-launch-cwd.test.mjs covers new-session, new-window and split-window carrying the cwd;
  topology-spec.test.mjs asserts a library agent's cwd (the value all three receive in launchRun) is the repo root.

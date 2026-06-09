"""PM Dashboard Server -- real-time HTTP dashboard for the project-management plugin.

Architecture:
  - ThreadingHTTPServer (stdlib, zero extra deps)
  - PID lock at .pm/dashboard.pid  (first-wins: if a server is already up, exit cleanly)
  - Deterministic port: 7960 + (abs(hash(abs_path)) % 40), persisted in .pm/dashboard.port
  - SSE endpoint /events that tails .pm/events.jsonl and fans out to browsers
  - React SPA (built with Vite + @atlaskit) served from dashboard/dist/

Run directly:
  python3 pm_dashboard_server.py [/path/to/workspace]
Or via the bin/pm-dashboard launcher.
"""
from __future__ import annotations

import atexit
import base64
import fcntl
import hashlib
import http.server
import json
import os
import queue
import select
import shutil
import signal
import struct
import subprocess
import sys
import termios
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Embedded dashboard HTML
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Static file serving from dashboard/dist/ (React + @atlaskit SPA)
# ---------------------------------------------------------------------------

_DIST_DIR: Optional[Path] = None  # set at startup by run()

_MIME: dict[str, str] = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
    '.woff': 'font/woff',
    '.ttf':  'font/ttf',
}

FALLBACK_HTML = b'<html><body><p>Dashboard not built. Run: cd project-management/dashboard &amp;&amp; npm install &amp;&amp; npm run build</p></body></html>'

# ---------------------------------------------------------------------------
# PID lock helpers
# ---------------------------------------------------------------------------

def _read_pid(pid_path: Path) -> int:
    try:
        return int(pid_path.read_text().strip())
    except Exception:
        return 0


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _try_acquire_pid_lock(pid_path: Path) -> bool:
    """First-wins: return True if we acquired the lock, False if a live peer holds it."""
    existing = _read_pid(pid_path)
    if _pid_alive(existing):
        return False
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(os.getpid()) + "\n")
    return True


def _release_pid_lock(pid_path: Path) -> None:
    try:
        if _read_pid(pid_path) == os.getpid():
            pid_path.unlink(missing_ok=True)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Port assignment — static default with optional override
# ---------------------------------------------------------------------------

_DEFAULT_PORT = 7900  # predictable, always the same unless PM_DASHBOARD_PORT is set


def _pick_port(root: Path) -> int:
    """Return the port to bind on.

    Priority:
    1. PM_DASHBOARD_PORT env var (override for CI/tests)
    2. The fixed default (7900)

    The port file is written so other tools can discover it.
    """
    import socket as _socket

    port = int(os.environ.get("PM_DASHBOARD_PORT", _DEFAULT_PORT))

    # If the port is occupied, kill the occupant (last-wins: new server always wins)
    def _port_free() -> bool:
        with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as _s:
            _s.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
            return _s.connect_ex(("127.0.0.1", port)) != 0

    if not _port_free():
        try:
            result = subprocess.run(
                ["lsof", "-ti", f":{port}"],
                capture_output=True, text=True,
            )
            pids = []
            for pid_str in result.stdout.strip().splitlines():
                try:
                    pids.append(int(pid_str))
                    os.kill(int(pid_str), signal.SIGTERM)
                except (ProcessLookupError, ValueError):
                    pass
            # Poll until the port is free (up to 3s), escalating to SIGKILL after 1s
            deadline = time.monotonic() + 3.0
            sigkill_after = time.monotonic() + 1.0
            while not _port_free() and time.monotonic() < deadline:
                if time.monotonic() > sigkill_after:
                    for pid in pids:
                        try:
                            os.kill(pid, signal.SIGKILL)
                        except (ProcessLookupError, PermissionError):
                            pass
                    sigkill_after = float("inf")
                time.sleep(0.05)
        except Exception:
            pass

    (root / "dashboard.port").write_text(str(port) + "\n")
    return port


# ---------------------------------------------------------------------------
# SSE subscriber registry + events.jsonl tailer
# ---------------------------------------------------------------------------

_subscribers: List[queue.Queue] = []
_subscribers_lock = threading.Lock()


def _add_subscriber() -> queue.Queue:
    q: queue.Queue = queue.Queue(maxsize=50)
    with _subscribers_lock:
        _subscribers.append(q)
    return q


def _remove_subscriber(q: queue.Queue) -> None:
    with _subscribers_lock:
        try:
            _subscribers.remove(q)
        except ValueError:
            pass


def _broadcast(message: str) -> None:
    with _subscribers_lock:
        dead = []
        for q in _subscribers:
            try:
                q.put_nowait(message)
            except queue.Full:
                dead.append(q)
        for q in dead:
            _subscribers.remove(q)


def _tail_events(events_path: Path) -> None:
    """Background thread: tail events.jsonl and broadcast to SSE subscribers."""
    while True:
        try:
            if events_path.exists():
                with open(events_path, "r", encoding="utf-8") as f:
                    f.seek(0, 2)  # seek to end
                    while True:
                        line = f.readline()
                        if line:
                            line = line.strip()
                            if line:
                                _broadcast(line)
                        else:
                            time.sleep(0.5)
        except Exception:
            time.sleep(1)


# ---------------------------------------------------------------------------
# WebSocket helpers (pure stdlib, RFC 6455)
# ---------------------------------------------------------------------------

_WS_MAGIC = b"258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


def _ws_handshake(wfile, key: str) -> None:
    accept = base64.b64encode(hashlib.sha1(key.encode() + _WS_MAGIC).digest()).decode()
    wfile.write(
        b"HTTP/1.1 101 Switching Protocols\r\n"
        b"Upgrade: websocket\r\n"
        b"Connection: Upgrade\r\n"
        b"Sec-WebSocket-Accept: " + accept.encode() + b"\r\n\r\n"
    )
    wfile.flush()


def _ws_read_exactly(sock, n: int) -> bytes:
    data = b''
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise ConnectionError("ws closed")
        data += chunk
    return data


def _ws_recv(sock) -> tuple:
    """Receive one WebSocket frame. Returns (opcode, payload)."""
    h = _ws_read_exactly(sock, 2)
    opcode = h[0] & 0x0F
    masked = bool(h[1] & 0x80)
    length = h[1] & 0x7F
    if length == 126:
        length = struct.unpack('>H', _ws_read_exactly(sock, 2))[0]
    elif length == 127:
        length = struct.unpack('>Q', _ws_read_exactly(sock, 8))[0]
    mask = _ws_read_exactly(sock, 4) if masked else None
    payload = bytearray(_ws_read_exactly(sock, length))
    if masked and mask:
        for i in range(len(payload)):
            payload[i] ^= mask[i % 4]
    return opcode, bytes(payload)


def _ws_send(sock, data: bytes, opcode: int = 0x01) -> None:  # 0x01 = text frame; JSON is UTF-8 text
    """Send one unmasked WebSocket frame (server→client)."""
    n = len(data)
    if n < 126:
        header = struct.pack('BB', 0x80 | opcode, n)
    elif n < 65536:
        header = struct.pack('>BBH', 0x80 | opcode, 126, n)
    else:
        header = struct.pack('>BBQ', 0x80 | opcode, 127, n)
    sock.sendall(header + data)


# ---------------------------------------------------------------------------
# Fleet session registry + helpers
# ---------------------------------------------------------------------------

# ticket_id → {state, started, final, is_plan}
_sessions: Dict[str, Dict[str, Any]] = {}
_sessions_lock = threading.Lock()


_PLUGIN_SOURCE   = "project-management@ByteDeskAI/bytedesk-marketplace"  # install source
_PLUGIN_UPDATE   = "project-management@bytedesk"                        # update handle (short form)
_plugin_ensure_lock = threading.Lock()
_plugin_ensured = False  # only run once per server lifetime


def _ensure_plugin_installed() -> None:
    """Install or update the project-management plugin so /pm:plan skill is available.

    Runs at most once per server process. Checks whether the plugin is already
    installed; if not, installs it. Always attempts an update so the spawned
    session gets the latest skill definitions.
    """
    global _plugin_ensured
    with _plugin_ensure_lock:
        if _plugin_ensured:
            return
        _plugin_ensured = True

    claude_bin = shutil.which("claude")
    if not claude_bin:
        print("[pm-dashboard] plugin check: claude CLI not found — skipping", flush=True)
        return

    try:
        print("[pm-dashboard] checking plugin status…", flush=True)

        # Check if plugin is already installed
        result = subprocess.run(
            [claude_bin, "plugin", "list"],
            capture_output=True, text=True, timeout=15,
        )
        already_installed = (
            "project-management@bytedesk" in result.stdout.lower()
            or "project-management@ByteDeskAI" in result.stdout
        )

        if not already_installed:
            print(f"[pm-dashboard] plugin not found — installing {_PLUGIN_SOURCE}…", flush=True)
            install = subprocess.run(
                [claude_bin, "plugin", "install", _PLUGIN_SOURCE],
                capture_output=True, text=True, timeout=60,
            )
            if install.returncode == 0:
                print("[pm-dashboard] plugin installed OK", flush=True)
            else:
                print(f"[pm-dashboard] plugin install failed: {install.stderr.strip()}", flush=True)
        else:
            print(f"[pm-dashboard] plugin found — updating {_PLUGIN_UPDATE}…", flush=True)
            update = subprocess.run(
                [claude_bin, "plugin", "update", _PLUGIN_UPDATE],
                capture_output=True, text=True, timeout=60,
            )
            if update.returncode == 0:
                print("[pm-dashboard] plugin updated OK", flush=True)
            else:
                print(f"[pm-dashboard] plugin update warning: {update.stderr.strip()}", flush=True)

    except Exception as exc:
        print(f"[pm-dashboard] plugin ensure warning: {exc}", flush=True)


def _cleanup_misplaced_files(project_root: Path) -> None:
    """Remove db/event files incorrectly placed in the project root by old versions.

    The old _find_pm_root() fell back to returning the project dir when .pm/
    didn't exist yet, causing pm.db and events.jsonl to land in the wrong place.
    If we now have a proper .pm/ directory alongside these stale root-level files,
    remove the stale ones.
    """
    pm_dir = project_root / ".pm"
    if not pm_dir.is_dir():
        return  # Nothing to clean up
    for stale in ("pm.db", "pm.db-shm", "pm.db-wal", "events.jsonl",
                  "dashboard.pid", "dashboard.port"):
        f = project_root / stale
        if f.exists():
            try:
                f.unlink()
                print(f"[pm-dashboard] removed misplaced {stale} from project root", flush=True)
            except Exception:
                pass


def _auto_init_workspace(pm_root: Path, plugin_root: Path) -> None:
    """Initialize the PM workspace on first boot if it hasn't been set up yet.

    Derives sensible defaults from the project directory name so users get a
    working dashboard immediately without needing to run /pm:init manually.
    Also writes .pm/.gitignore so database files are never accidentally committed.
    """
    sys.path.insert(0, str(plugin_root / "lib"))
    try:
        from pm_store import PMStore
        store = PMStore(str(pm_root.parent))
        if store.is_initialized():
            return  # Already set up — nothing to do

        project_dir = pm_root.parent
        raw = project_dir.name.replace("-", " ").replace("_", " ").replace(".", " ")
        words = [w for w in raw.split() if w]
        project_name = " ".join(w.capitalize() for w in words) if words else "Local Project"
        key_prefix = "".join(w[0].upper() for w in words[:4]) if words else "PM"

        print(f"[pm-dashboard] first boot — initializing '{project_name}' ({key_prefix})…", flush=True)
        store.init_workspace(project_name=project_name, key_prefix=key_prefix)

        # Write .gitignore:
        #   SQLite binary files are always ignored (binary, not git-friendly).
        #   JSONL data files (issues.jsonl, docs.jsonl, config.json) are NOT
        #   ignored — teams can choose to commit their PM data since it is
        #   human-readable. events.jsonl is high-frequency noise; always ignored.
        gitignore = pm_root / ".gitignore"
        if not gitignore.exists():
            gitignore.write_text(
                "# SQLite binary files — never commit\n"
                "pm.db\npm.db-shm\npm.db-wal\n"
                "\n"
                "# SSE event stream — high-frequency, not useful in git\n"
                "events.jsonl\n"
                "\n"
                "# Temp and lock files\n"
                "*.tmp\n*.lock\n"
                "\n"
                "# Dashboard runtime files\n"
                "dashboard.pid\ndashboard.port\n"
                "\n"
                "# JSONL data files (issues.jsonl, docs.jsonl, config.json) are intentionally\n"
                "# NOT ignored — commit them if you want PM data tracked in git.\n"
            )

        print(f"[pm-dashboard] workspace ready. Customize with /pm:init or via the dashboard.", flush=True)
    except Exception as exc:
        print(f"[pm-dashboard] auto-init warning: {exc}", flush=True)


def _write_session_skills(project_root: Path) -> None:
    """Copy skill files from the plugin repo into the session workspace.

    Claude Code scans .claude/skills/ in the project directory for local skills.
    Writing here guarantees the session uses the current file on disk, bypassing
    any stale remote plugin cache from 'claude plugin update'.
    """
    plugin_root = Path(__file__).resolve().parents[1]
    skills_src = plugin_root / "skills"
    if not skills_src.is_dir():
        return

    target_skills = project_root / ".claude" / "skills"
    try:
        for skill_dir in skills_src.iterdir():
            if not skill_dir.is_dir():
                continue
            skill_md = skill_dir / "SKILL.md"
            if not skill_md.exists():
                continue
            dest = target_skills / skill_dir.name
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(skill_md), str(dest / "SKILL.md"))
        print(f"[pm-dashboard] skills synced to {target_skills}", flush=True)
    except Exception as exc:
        print(f"[pm-dashboard] skill sync warning: {exc}", flush=True)


def _write_session_mcp_json(project_root: Path) -> None:
    """Write a .mcp.json with absolute paths into the project root.

    This ensures the pm MCP server starts in any spawned Claude Code session
    even when CLAUDE_PLUGIN_ROOT is not set in the environment (which is the
    case for tmux sessions launched from the dashboard).
    """
    plugin_root = Path(__file__).resolve().parents[1]
    pm_mcp_bin = plugin_root / "bin" / "pm-mcp"
    if not pm_mcp_bin.exists():
        return  # Can't resolve binary — skip

    mcp_config = {
        "mcpServers": {
            "pm": {
                "type": "stdio",
                "command": str(pm_mcp_bin),
            }
        }
    }
    target = project_root / ".mcp.json"
    try:
        target.write_text(json.dumps(mcp_config, indent=2) + "\n")
    except Exception as exc:
        print(f"[pm-dashboard] could not write .mcp.json: {exc}", flush=True)


def _check_prerequisites() -> Optional[str]:
    """Returns error string if required tools are missing, else None.

    Only tmux and the claude CLI are required — no fleet dependency.
    """
    missing = []
    if not shutil.which("tmux"):
        missing.append("tmux — install with: brew install tmux (macOS) or apt install tmux (Linux)")
    if not shutil.which("claude"):
        missing.append("claude CLI — install Claude Code from https://claude.ai/code")
    if missing:
        return "Missing prerequisites:\n" + "\n".join(f"  • {m}" for m in missing)
    return None


_SHELL_NAMES = frozenset({"zsh", "bash", "sh", "fish", "dash", "tcsh", "csh", "ksh"})


def _plan_session_alive(session_name: str) -> bool:
    """Return True if the tmux session has Claude (not a shell) in the foreground pane.

    When Claude exits the pane reverts to a shell prompt; the foreground process
    becomes the shell itself (zsh, bash, etc.).  While Claude runs the pane PID
    resolves to a process whose name is 'claude' or its version string — anything
    that is NOT a known shell name is treated as alive.
    """
    try:
        r = subprocess.run(
            ["tmux", "list-panes", "-t", session_name, "-F", "#{pane_pid}"],
            capture_output=True, text=True,
        )
        if r.returncode != 0:
            return False
        pid_str = r.stdout.strip().splitlines()[0].strip()
        pr = subprocess.run(
            ["ps", "-p", pid_str, "-o", "comm="],
            capture_output=True, text=True,
        )
        comm = pr.stdout.strip().lower()
        return comm not in _SHELL_NAMES
    except Exception:
        return True  # assume alive on error — safer than falsely killing a running session


def _kill_tmux_session(session_name: str) -> None:
    """Kill a tmux session, ignoring errors."""
    try:
        subprocess.run(["tmux", "kill-session", "-t", session_name], capture_output=True)
    except Exception:
        pass


def _detect_session_state(session_name: str) -> str:
    """Heuristic state derived from a live tmux pane.

    Returns one of: starting / working / needs-input / done / error / gone
    """
    if not shutil.which("tmux"):
        return "gone"
    r = subprocess.run(
        ["tmux", "has-session", "-t", session_name],
        capture_output=True,
    )
    if r.returncode != 0:
        return "gone"
    # Capture last 30 lines of the pane
    r = subprocess.run(
        ["tmux", "capture-pane", "-t", session_name, "-p", "-S", "-30"],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return "gone"
    tail = r.stdout.lower()
    raw  = r.stdout
    if any(w in tail for w in ['approve', 'allow', 'permission', 'y/n', '(y/n)', 'yes/no', 'continue?']):
        return "needs-input"
    if any(w in tail for w in ['✓', '✅', 'complete', 'merged', 'finished', 'task complete']):
        return "done"
    if any(w in tail for w in ['error:', 'failed:', 'cannot', 'exception', 'traceback']):
        return "error"
    if any(w in tail for w in ['reading', 'analyzing', 'thinking', 'writing', 'tokens', 'searching']):
        return "working"
    if '❯' in raw:
        return "working"
    return "starting"


_ADR_CREATION_GUIDANCE = """\
## Architecture Decision Records (ADRs)

This project uses ADRs to capture significant architectural choices. Before writing any code:
1. Call `pm_doc_list` with `doc_type="adr"` to retrieve all existing ADRs.
2. Read the full content of any ADR whose title suggests relevance to the current work.
3. Follow patterns and constraints described in Accepted ADRs. Do not contradict them without creating a superseding ADR first.

Create a new ADR (using `pm_doc_create` with `doc_type="adr"`, `doc_status="accepted"`) whenever you make a decision about:
- Choice of library, framework, or tool (e.g. "use Tailwind instead of CSS modules")
- Cross-cutting patterns (authentication approach, error handling strategy, state management)
- API shape or data model that other code will depend on
- Non-obvious trade-offs with lasting consequences
- Any choice a future developer would reasonably make differently without this context

ADR format — always include these sections:
```
## Context
[Why this decision was needed; what problem it solves]

## Decision
[The choice made, stated clearly]

## Consequences
[What becomes easier, what becomes harder, what constraints this imposes]

## Alternatives Considered
[Other options evaluated and why they were rejected]
```

To supersede an existing ADR:
1. Create the new ADR with `doc_status="accepted"`.
2. Update the OLD ADR: set `doc_status="superseded"` and `superseded_by=<new-doc-id>`.
3. Reference the old ADR in the new one's Context section.
"""


def _build_adr_digest(pm_root: Path) -> str:
    """Return a compact ADR digest to inject into execution prompts.

    Returns an empty string if there are no ADRs or the store is unavailable.
    """
    try:
        sys.path.insert(0, str(Path(__file__).parent))
        from pm_store import PMStore  # noqa: F401
        store = PMStore(str(pm_root.parent))
        adrs = store.list_docs(doc_type="adr")
        if not adrs:
            return ""
        lines = ["## Existing ADRs — read before implementing\n"]
        for adr in adrs:
            status = adr.get("doc_status", "") or "no-status"
            superseded_by = adr.get("superseded_by")
            note = f" → superseded by {superseded_by}" if superseded_by else ""
            lines.append(f"- **{adr['id']}** [{status}]{note}: {adr['title']}")
        lines.append(
            "\nCall `pm_doc_get` on any relevant ADR to read its full content before starting work.\n"
        )
        return "\n".join(lines)
    except Exception:
        return ""


def _spawn_claude_session(session_name: str, prompt: str, cwd: Optional[str] = None) -> Optional[str]:
    """Spawn a tmux session running Claude Code with the given initial prompt.

    No fleet dependency — requires only tmux and the claude CLI.
    Returns None on success, or an error string on failure.
    """
    err = _check_prerequisites()
    if err:
        return err

    # Reuse an existing session if present
    if subprocess.run(["tmux", "has-session", "-t", session_name], capture_output=True).returncode == 0:
        return None

    effective_cwd = cwd or str(Path.cwd())

    # Start a detached tmux session running the claude CLI.
    # --dangerously-skip-permissions: all PM sessions run with full tool access so
    # pm_* MCP skills can write tickets, update docs, etc. without permission prompts.
    subprocess.Popen(
        ["tmux", "new-session", "-d", "-s", session_name, "-c", effective_cwd,
         "claude", "--dangerously-skip-permissions"],
        start_new_session=True,
    )

    # Deliver the initial prompt once claude's ❯ input indicator appears
    def _deliver_prompt() -> None:
        deadline = time.time() + 30
        while time.time() < deadline:
            time.sleep(0.4)
            r = subprocess.run(
                ["tmux", "capture-pane", "-t", session_name, "-p"],
                capture_output=True, text=True,
            )
            if "❯" in r.stdout or r.stdout.strip().endswith(">"):
                # Load prompt into tmux paste buffer and deliver it
                subprocess.run(
                    ["tmux", "load-buffer", "-"],
                    input=prompt.encode("utf-8"),
                    capture_output=True,
                )
                subprocess.run(["tmux", "paste-buffer", "-d", "-t", session_name], capture_output=True)
                time.sleep(0.05)
                subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], capture_output=True)
                return
        # Fallback after timeout — send anyway
        subprocess.run(["tmux", "load-buffer", "-"], input=prompt.encode("utf-8"), capture_output=True)
        subprocess.run(["tmux", "paste-buffer", "-d", "-t", session_name], capture_output=True)
        subprocess.run(["tmux", "send-keys", "-t", session_name, "Enter"], capture_output=True)

    threading.Thread(target=_deliver_prompt, daemon=True).start()
    return None


def _broadcast_event(event: Dict[str, Any]) -> None:
    """Broadcast a JSON event to all SSE subscribers."""
    _broadcast(json.dumps(event))


# ---------------------------------------------------------------------------
# Session monitor thread (syncs tmux session state → PM ticket status)
# ---------------------------------------------------------------------------

def _session_monitor(pm_root: Path) -> None:
    """Daemon thread: polls active sessions and syncs PM ticket status."""
    while True:
        time.sleep(5)
        with _sessions_lock:
            snap = {k: dict(v) for k, v in _sessions.items() if not v.get("final")}

        for ticket_id, info in snap.items():
            state = _detect_session_state(ticket_id)
            prev = info.get("state", "starting")
            if state == prev:
                continue

            with _sessions_lock:
                if ticket_id in _sessions:
                    _sessions[ticket_id]["state"] = state

            if state not in ("done", "error"):
                continue

            # PLAN-* sessions: just kill the tmux session when done — no ticket to update
            is_plan = info.get("is_plan", False)
            if is_plan:
                _kill_tmux_session(ticket_id)
                with _sessions_lock:
                    if ticket_id in _sessions:
                        _sessions[ticket_id]["final"] = True
                continue

            # Sync PM ticket status when session reaches a terminal state
            try:
                sys.path.insert(0, str(Path(__file__).parent))
                from pm_store import PMStore  # noqa: F811
                store = PMStore(str(pm_root.parent))
                issue = store.get_issue(ticket_id)
                if not issue:
                    with _sessions_lock:
                        if ticket_id in _sessions:
                            _sessions[ticket_id]["final"] = True
                    continue

                if state == "done":
                    store.update_issue(ticket_id, {"status": "REVIEW"})
                    _broadcast_event({"type": "issue_updated", "payload": {"id": ticket_id, "status": "REVIEW"}})
                    # Promote epic to DONE when all children are complete
                    epic_id = issue.get("epic_id")
                    if epic_id:
                        children = store.list_issues()
                        sib = [i for i in children if i.get("epic_id") == epic_id]
                        if sib and all(i.get("status") in ("DONE", "REVIEW") for i in sib):
                            store.update_issue(epic_id, {"status": "DONE"})
                            _broadcast_event({"type": "issue_updated", "payload": {"id": epic_id, "status": "DONE"}})
                elif state == "error":
                    store.update_issue(
                        ticket_id, {},
                        comment="Session ended with error. Review session logs.",
                        comment_author="PM Dashboard",
                    )
                    _broadcast_event({"type": "issue_updated", "payload": {"id": ticket_id}})

                with _sessions_lock:
                    if ticket_id in _sessions:
                        _sessions[ticket_id]["final"] = True
            except Exception:
                pass


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class DashboardHandler(http.server.BaseHTTPRequestHandler):
    _pm_root: Path = Path(".")

    def log_message(self, fmt: str, *args: Any) -> None:
        pass  # suppress access log noise

    def do_GET(self) -> None:
        from urllib.parse import parse_qs
        path = urlparse(self.path).path
        qs = parse_qs(urlparse(self.path).query)
        if path in ("/", ""):
            self._serve_index()
        elif path == "/api/status":
            self._serve_status()
        elif path == "/api/docs/search":
            q = qs.get("q", [""])[0]
            self._handle_doc_search(q)
        elif path == "/api/docs/health":
            self._handle_doc_health()
        elif path == "/api/docs/export":
            self._handle_docs_export_all()
        elif path == "/api/docs":
            self._serve_docs()
        elif path.startswith("/api/docs/"):
            # Parse sub-paths: /api/docs/<id>/comments, /api/docs/<id>/versions, etc.
            rest = path[len("/api/docs/"):]
            parts = rest.split("/")
            doc_id = parts[0].upper() if parts else ""
            if len(parts) == 1:
                self._serve_doc(doc_id)
            elif len(parts) == 2 and parts[1] == "comments":
                self._handle_doc_comments_get(doc_id)
            elif len(parts) == 2 and parts[1] == "versions":
                self._handle_doc_versions_list(doc_id)
            elif len(parts) == 3 and parts[1] == "versions":
                try:
                    n = int(parts[2])
                except ValueError:
                    self._respond(400, "application/json",
                                  json.dumps({"ok": False, "error": "version must be integer"}).encode())
                    return
                self._handle_doc_version_get(doc_id, n)
            elif len(parts) == 2 and parts[1] == "export":
                fmt = qs.get("format", ["markdown"])[0]
                include_children = qs.get("include_children", ["false"])[0].lower() == "true"
                self._handle_doc_export(doc_id, fmt, include_children)
            elif len(parts) == 2 and parts[1] == "generate":
                self._handle_doc_gen_status(doc_id)
                return
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        elif path.startswith("/api/issues/"):
            rest = path[len("/api/issues/"):]
            parts = rest.split("/")
            issue_id = parts[0].upper() if parts else ""
            if len(parts) == 2 and parts[1] == "linked_docs":
                self._handle_issue_linked_docs(issue_id)
            elif len(parts) == 2 and parts[1] == "health":
                self._serve_issue_health(issue_id)
            elif len(parts) == 2 and parts[1] == "snapshots":
                self._serve_issue_snapshots(issue_id)
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        elif path == "/events":
            self._serve_sse()
        elif path == "/health":
            self._respond(200, "text/plain", b"ok")
        elif path == "/api/plugin/status":
            self._serve_plugin_status()
        elif path == "/api/plan/sessions":
            self._serve_plan_sessions()
        elif path == "/api/migrate/status":
            self._serve_migrate_status()
        elif path == "/api/changelog":
            self._serve_changelog()
        elif path == "/api/workspace/health":
            self._serve_workspace_health()
        elif path == "/api/workspace/templates":
            self._serve_templates()
        elif path == "/api/workspace/filters":
            self._serve_filters()
        elif path == "/api/workspace/wip_limits":
            self._serve_wip_limits()
        elif path == "/api/workspace/session_templates":
            self._serve_session_templates()
        elif path == "/api/workspace/sprint_themes":
            self._serve_sprint_themes()
        elif path == "/api/workspace/board_sort":
            self._serve_board_sort()
        elif path == "/api/workspace/analytics":
            self._serve_workspace_analytics()
        elif path == "/api/sprint/health":
            self._serve_sprint_health()
        elif path == "/api/sprint/briefing":
            self._serve_daily_briefing()
        elif path == "/api/sprint/standup":
            since = int(qs.get("since_hours", ["24"])[0])
            self._serve_standup(since)
        elif path.startswith("/ws/pty/"):
            session_key = path[len("/ws/pty/"):]
            if self.headers.get("Upgrade", "").lower() == "websocket":
                self._handle_pty(session_key)
            else:
                self._respond(400, "text/plain", b"WebSocket upgrade required")
        elif path.startswith("/api/run/"):
            rest = path[len("/api/run/"):]
            if rest.endswith("/log"):
                ticket = rest[:-4]
                self._serve_session_log_sse(ticket)
            else:
                self._serve_session_status(rest)
        else:
            self._serve_static(path)

    def _serve_index(self) -> None:
        if _DIST_DIR:
            idx = _DIST_DIR / "index.html"
            if idx.exists():
                self._respond(200, "text/html; charset=utf-8", idx.read_bytes())
                return
        self._respond(200, "text/html; charset=utf-8", FALLBACK_HTML)

    def _serve_static(self, path: str) -> None:
        if not _DIST_DIR:
            self._respond(404, "text/plain", b"not found")
            return
        try:
            dist_resolved = _DIST_DIR.resolve()
            asset = (dist_resolved / path.lstrip("/")).resolve()
            if not str(asset).startswith(str(dist_resolved)):
                self._respond(403, "text/plain", b"forbidden")
                return
        except Exception:
            self._respond(404, "text/plain", b"not found")
            return
        if asset.exists() and asset.is_file():
            ctype = _MIME.get(asset.suffix, "application/octet-stream")
            body = asset.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            if "/assets/" in path:
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(body)
        else:
            self._respond(404, "text/plain", b"not found")

    def _serve_status(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            if not store.is_initialized():
                payload = json.dumps({"ok": False, "error": "not initialized"})
                self._respond(200, "application/json", payload.encode())
                return

            config = store.get_project_config()
            active_sprint_id = store.get_active_sprint_id()

            # Full issue list for board rendering
            issues = store.list_issues()

            # Build dashboard dict (mirrors pm_status MCP tool)
            sprint_info = "No active sprint"
            sprint_issues: List[Dict[str, Any]] = []
            if active_sprint_id:
                for s in config.get("sprints", []):
                    if s["id"] == active_sprint_id:
                        goal = s.get("goal", "")
                        sprint_info = f"{s['name']}" + (f" -- {goal}" if goal else "")
                        break
                sprint_issues = store.list_issues(sprint_id=active_sprint_id)
            else:
                sprint_issues = issues

            done_count = sum(
                1 for t in sprint_issues
                if t.get("status", "").upper() == "DONE"
            )

            board: Dict[str, List] = {"TODO": [], "IN_PROGRESS": [], "REVIEW": [], "DONE": []}
            for t in sprint_issues:
                col = t.get("status", "TODO").upper()
                if col not in board:
                    col = "TODO"
                board[col].append(t["id"])

            # Resolve end_date for the active sprint
            sprint_end_date = None
            if active_sprint_id:
                for s in config.get("sprints", []):
                    if s["id"] == active_sprint_id:
                        sprint_end_date = s.get("end_date")
                        break

            wip_limits: Dict[str, int] = {}
            try:
                wip_limits = store.get_wip_limits()
            except Exception:
                pass

            payload = json.dumps({
                "ok": True,
                "dashboard": {
                    "project_name": config.get("project_name"),
                    "key_prefix": config.get("key_prefix"),
                    "active_sprint": sprint_info,
                    "active_sprint_id": active_sprint_id,
                    "sprint_end_date": sprint_end_date,
                    "sprint_progress": {
                        "total_tickets": len(sprint_issues),
                        "done_tickets": done_count,
                    },
                    "columns": board,
                    "wip_limits": wip_limits,
                    "board_sort": store.get_board_sort(),
                },
                "issues": issues,
                "activity": config.get("activity_log", []),
            }, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": str(exc)})
            self._respond(500, "application/json", payload.encode())

    def _serve_docs(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            if not store.is_initialized():
                payload = json.dumps({"ok": False, "error": "not initialized"})
                self._respond(200, "application/json", payload.encode())
                return
            docs = store.list_docs()
            payload = json.dumps({"ok": True, "count": len(docs), "documents": docs}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": str(exc)})
            self._respond(500, "application/json", payload.encode())

    def _serve_doc(self, doc_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            doc = store.get_doc(doc_id.upper())
            if not doc:
                payload = json.dumps({"ok": False, "error": f"Document {doc_id} not found."})
                self._respond(404, "application/json", payload.encode())
                return
            payload = json.dumps({"ok": True, "document": doc}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": str(exc)})
            self._respond(500, "application/json", payload.encode())

    def _serve_sse(self) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        q = _add_subscriber()
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    self.wfile.write(f"data: {msg}\n\n".encode("utf-8"))
                    self.wfile.flush()
                except queue.Empty:
                    # keepalive comment
                    self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            _remove_subscriber(q)

    # -----------------------------------------------------------------------
    # WebSocket + PTY bridge
    # -----------------------------------------------------------------------

    def _handle_pty(self, session_key: str) -> None:
        """WebSocket + PTY bridge for /ws/pty/<session_key> → tmux attach-session."""
        ws_key = self.headers.get("Sec-WebSocket-Key", "")
        _ws_handshake(self.wfile, ws_key)
        sock = self.connection
        sock.settimeout(None)

        master_fd, slave_fd = os.openpty()
        stop = threading.Event()

        try:
            proc = subprocess.Popen(
                ["tmux", "attach-session", "-t", session_key],
                stdin=slave_fd, stdout=slave_fd, stderr=slave_fd,
                close_fds=True,
                preexec_fn=os.setsid,
            )
        except Exception as exc:
            os.close(slave_fd)
            os.close(master_fd)
            try:
                _ws_send(sock, json.dumps({"type": "error", "msg": str(exc)}).encode())
            except Exception:
                pass
            return

        os.close(slave_fd)

        # Send a banner so the terminal isn't blank while the session loads
        try:
            _ws_send(sock, json.dumps({
                "type": "output",
                "data": f"\r\x1b[2m⟳ Connecting to session {session_key}…\x1b[0m\r\n",
            }).encode())
        except Exception:
            pass

        def pty_to_ws() -> None:
            while not stop.is_set():
                try:
                    r, _, _ = select.select([master_fd], [], [], 0.1)
                    if r:
                        data = os.read(master_fd, 4096)
                        _ws_send(sock, json.dumps({
                            "type": "output",
                            "data": data.decode('utf-8', errors='replace'),
                        }).encode())
                except (OSError, BrokenPipeError):
                    break

        reader = threading.Thread(target=pty_to_ws, daemon=True)
        reader.start()

        try:
            while True:
                # Check if the tmux process has exited before blocking on recv
                if proc.poll() is not None:
                    break
                # Non-blocking check for incoming WebSocket data (0.5s timeout)
                r, _, _ = select.select([sock], [], [], 0.5)
                if not r:
                    continue
                opcode, payload = _ws_recv(sock)
                if opcode == 0x8:  # close frame
                    break
                if opcode in (0x1, 0x2):
                    try:
                        msg = json.loads(payload)
                        if msg.get("type") == "input":
                            os.write(master_fd, msg["data"].encode('utf-8', errors='replace'))
                        elif msg.get("type") == "resize":
                            cols = int(msg.get("cols", 80))
                            rows = int(msg.get("rows", 24))
                            fcntl.ioctl(master_fd, termios.TIOCSWINSZ,
                                        struct.pack("HHHH", rows, cols, 0, 0))
                    except (json.JSONDecodeError, KeyError, OSError, ValueError):
                        pass
        except (ConnectionError, BrokenPipeError, OSError):
            pass
        finally:
            stop.set()
            # Terminate the tmux attach client (not the session itself)
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            except Exception:
                pass
            try:
                os.close(master_fd)
            except OSError:
                pass

    # -----------------------------------------------------------------------
    # Session status + log SSE
    # -----------------------------------------------------------------------

    def _serve_session_status(self, ticket: str) -> None:
        state = _detect_session_state(ticket)
        with _sessions_lock:
            info = dict(_sessions.get(ticket, {}))
            # Re-register sessions that predate this server process (e.g. after restart)
            # so the session monitor can track and clean them up.
            if state != "gone" and ticket not in _sessions:
                _sessions[ticket] = {"state": state, "started": time.time(), "final": False}
        payload = json.dumps({
            "ok": True,
            "ticket": ticket,
            "status": state,
            "started": info.get("started"),
            "final": info.get("final", False),
        })
        self._respond(200, "application/json", payload.encode())

    def _serve_session_log_sse(self, ticket: str) -> None:
        """SSE fallback: stream tmux pane output by polling capture-pane every 0.5s."""
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        try:
            last_lines: list[str] = []
            while True:
                r = subprocess.run(
                    ["tmux", "capture-pane", "-t", ticket, "-p", "-S", "-50"],
                    capture_output=True, text=True,
                )
                if r.returncode != 0:
                    # Session gone
                    self.wfile.write(b"data: {\"line\": \"[session ended]\"}\n\n")
                    self.wfile.flush()
                    break
                lines = r.stdout.splitlines()
                # Emit only new lines since last poll
                if lines != last_lines:
                    new_start = 0
                    if last_lines:
                        try:
                            new_start = len(last_lines)
                        except Exception:
                            new_start = 0
                    for line in lines[new_start:]:
                        data = json.dumps({"line": line})
                        self.wfile.write(f"data: {data}\n\n".encode())
                    self.wfile.flush()
                    last_lines = lines
                time.sleep(0.5)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass

    # -----------------------------------------------------------------------
    # POST handler
    # -----------------------------------------------------------------------

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body: Dict[str, Any] = json.loads(self.rfile.read(length) or b"{}") if length > 0 else {}

        if path == "/api/run":
            self._handle_run_post(body)
        elif path == "/api/plan/start":
            self._handle_plan_start()
        elif path.startswith("/api/plan/kill/"):
            self._handle_plan_kill(path[len("/api/plan/kill/"):])
        elif path == "/api/sprint/plan":
            self._handle_sprint_plan(body)
        elif path == "/api/sprint/standup":
            since = int(body.get("since_hours", 24))
            self._serve_standup(since)
        elif path == "/api/workspace/templates":
            self._handle_template_create(body)
        elif path == "/api/workspace/filters":
            self._handle_filter_create(body)
        elif path == "/api/workspace/session_templates":
            self._handle_session_template_create(body)
        elif path == "/api/workspace/sprint_themes":
            self._handle_sprint_theme_create(body)
        elif path == "/api/issues/bulk":
            self._handle_issues_bulk_create(body)
        elif path == "/api/issues":
            self._handle_issue_create(body)
        elif path.startswith("/api/issues/"):
            rest = path[len("/api/issues/"):]
            parts = rest.split("/")
            issue_id = parts[0].upper() if parts else ""
            if len(parts) == 2 and parts[1] == "clone":
                self._handle_issue_clone(issue_id, body)
            elif len(parts) == 2 and parts[1] == "session":
                self._handle_issue_session(issue_id, body)
            elif len(parts) == 2 and parts[1] == "flag":
                self._handle_issue_flag(issue_id, body)
            elif len(parts) == 2 and parts[1] == "commits":
                self._handle_issue_commit(issue_id, body)
            elif len(parts) == 2 and parts[1] == "split":
                self._handle_issue_split(issue_id, body)
            elif len(parts) == 2 and parts[1] == "checkin":
                self._handle_issue_checkin(issue_id, body)
            elif len(parts) == 2 and parts[1] == "summarize":
                self._handle_issue_summarize(issue_id, body)
            elif len(parts) == 2 and parts[1] == "assign":
                self._handle_issue_assign(issue_id, body)
            elif len(parts) == 2 and parts[1] == "pin":
                self._handle_issue_pin(issue_id, body)
            elif len(parts) == 2 and parts[1] == "reopen":
                self._handle_issue_reopen(issue_id, body)
            elif len(parts) == 2 and parts[1] == "abort":
                self._handle_issue_abort(issue_id, body)
            elif len(parts) == 2 and parts[1] == "handoff":
                self._handle_issue_handoff(issue_id, body)
            elif len(parts) == 2 and parts[1] == "checklist":
                self._handle_issue_checklist(issue_id, body)
            elif len(parts) == 2 and parts[1] == "risk":
                self._handle_issue_risk(issue_id, body)
            elif len(parts) == 2 and parts[1] == "reply":
                self._handle_comment_reply(issue_id, body)
            elif len(parts) == 2 and parts[1] == "snapshot":
                self._handle_issue_snapshot(issue_id, body)
            elif len(parts) == 3 and parts[1] == "snapshot" and parts[2] == "restore":
                snapshot_id = body.get("snapshot_id", "")
                self._handle_issue_snapshot_restore(issue_id, snapshot_id)
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        elif path == "/api/workspace/board_sort":
            self._handle_board_sort_set(body)
        elif path == "/api/sprint/autopilot":
            self._handle_sprint_autopilot(body)
        elif path == "/api/server/exit":
            self._handle_server_exit()
        elif path == "/api/server/restart":
            self._handle_server_restart()
        elif path == "/api/migrate":
            self._handle_migrate(body)
        elif path.startswith("/api/docs/"):
            rest = path[len("/api/docs/"):]
            parts = rest.split("/")
            doc_id = parts[0].upper() if parts else ""
            if len(parts) == 2 and parts[1] == "comment":
                self._handle_doc_comment_post(doc_id, body)
            elif len(parts) == 2 and parts[1] == "link":
                self._handle_doc_link(doc_id, body)
            elif len(parts) == 2 and parts[1] == "generate":
                self._handle_doc_gen_start(doc_id, body)
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        else:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": "not found"}).encode())

    def _handle_run_post(self, body: Dict[str, Any]) -> None:
        ticket_id = body.get("ticket_id", "").strip().upper()
        if not ticket_id:
            self._respond(400, "application/json",
                          json.dumps({"ok": False, "error": "ticket_id required"}).encode())
            return

        prereq_err = _check_prerequisites()
        if prereq_err:
            self._respond(400, "application/json",
                          json.dumps({"ok": False, "error": prereq_err}).encode())
            return

        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            issue = store.get_issue(ticket_id)
            if not issue:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": f"Ticket {ticket_id} not found"}).encode())
                return

            is_epic = issue.get("type", "").lower() == "epic"

            if is_epic:
                # Fetch children ordered by ID; skip already-DONE/REVIEW so the
                # session can be re-run to pick up remaining work.
                all_issues = store.list_issues()
                children = sorted(
                    [i for i in all_issues if i.get("epic_id") == ticket_id],
                    key=lambda i: i["id"],
                )
                pending = [c for c in children if c.get("status") not in ("DONE", "REVIEW")]
                done_children = [c for c in children if c.get("status") in ("DONE", "REVIEW")]

                child_lines = []
                for c in children:
                    status_note = f" [{c.get('status', 'TODO')}]" if c.get("status") in ("DONE", "REVIEW") else ""
                    child_lines.append(
                        f"  - {c['id']}: {c['title']}{status_note}\n"
                        f"    Description: {c.get('description', 'No description')}"
                    )

                skip_note = (
                    f"\n\nNote: {len(done_children)} child ticket(s) are already DONE/REVIEW — skip them."
                    if done_children else ""
                )

                prompt = (
                    f"You are implementing the epic: {issue['id']} — {issue['title']}\n\n"
                    f"Epic description: {issue.get('description', 'No description')}\n\n"
                    f"Child tickets to implement in order:\n"
                    + "\n".join(child_lines)
                    + skip_note
                    + "\n\nInstructions:\n"
                    "1. Work through each pending child ticket in order, one at a time.\n"
                    "2. Before starting each ticket, call pm_issue_transition to move it to IN_PROGRESS.\n"
                    "3. Read the codebase, implement the changes for that ticket.\n"
                    "4. After completing it, call pm_issue_transition to move it to DONE.\n"
                    "5. Do not move to the next ticket until the current one is DONE.\n"
                    f"6. After ALL child tickets are DONE, call pm_issue_transition to move {ticket_id} to DONE.\n"
                    "Use pm_issue_comment to leave notes on tickets as you work. "
                    "Use pm_issue_get to re-read a ticket's full details before implementing it."
                )

                # Mark epic IN_PROGRESS immediately
                if issue.get("status") == "TODO":
                    store.update_issue(ticket_id, {"status": "IN_PROGRESS"})
                    _broadcast_event({"type": "issue_updated", "payload": {"id": ticket_id, "status": "IN_PROGRESS"}})

            else:
                prompt = (
                    f"Implement this ticket:\n\n"
                    f"ID: {issue['id']}\n"
                    f"Title: {issue['title']}\n"
                    f"Description: {issue.get('description', 'No description')}\n\n"
                    f"Check the codebase, implement the changes, then call pm_issue_transition to "
                    f"move {ticket_id} to DONE when complete."
                )

                # Advance ticket to IN_PROGRESS
                store.update_issue(ticket_id, {"status": "IN_PROGRESS"})
                _broadcast_event({"type": "issue_updated", "payload": {"id": ticket_id, "status": "IN_PROGRESS"}})

                # Advance parent epic if still in TODO
                epic_id = issue.get("epic_id")
                if epic_id:
                    epic = store.get_issue(epic_id)
                    if epic and epic.get("status") == "TODO":
                        store.update_issue(epic_id, {"status": "IN_PROGRESS"})
                        _broadcast_event({"type": "issue_updated", "payload": {"id": epic_id, "status": "IN_PROGRESS"}})

            # Apply session templates: check for matching type or tags
            try:
                templates = store.list_session_templates()
                issue_type = issue.get("type", "task").lower()
                issue_tags = [t.lower() for t in (issue.get("tags") or [])]
                for tmpl in templates:
                    match_types = [t.lower() for t in (tmpl.get("match_types") or [])]
                    match_tags = [t.lower() for t in (tmpl.get("match_tags") or [])]
                    type_match = issue_type in match_types if match_types else False
                    tag_match = any(t in issue_tags for t in match_tags) if match_tags else False
                    if type_match or tag_match:
                        prompt = tmpl.get("prompt_prefix", "") + "\n\n" + prompt
                        break
            except Exception:
                pass

            # Prepend ADR digest + creation guidance to every execution prompt
            adr_digest = _build_adr_digest(self._pm_root)
            if adr_digest:
                prompt = adr_digest + "\n\n---\n\n" + prompt
            prompt = prompt + "\n\n---\n\n" + _ADR_CREATION_GUIDANCE

            # Ensure MCP config and current skills are written into the workspace
            project_root = str(self._pm_root.parent)
            _write_session_mcp_json(Path(project_root))
            _write_session_skills(Path(project_root))
            spawn_err = _spawn_claude_session(ticket_id, prompt, cwd=project_root)
            if spawn_err:
                self._respond(500, "application/json",
                              json.dumps({"ok": False, "error": spawn_err}).encode())
                return

            # Register in session registry
            with _sessions_lock:
                _sessions[ticket_id] = {"state": "starting", "started": time.time(), "final": False}

            payload = json.dumps({"ok": True, "session_key": ticket_id, "started": True})
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_plan_start(self) -> None:
        prereq_err = _check_prerequisites()
        if prereq_err:
            self._respond(400, "application/json",
                          json.dumps({"ok": False, "error": prereq_err}).encode())
            return

        session_key = f"PLAN-{int(time.time())}"
        project_root = str(self._pm_root.parent)

        # Ensure the project-management plugin is installed and up to date
        # so that /pm:plan skill is always available in the spawned session.
        _ensure_plugin_installed()

        # Write .mcp.json (absolute paths) and sync skill files from the repo.
        # Syncing skills bypasses the remote plugin cache so the current SKILL.md
        # on disk is always what the spawned session loads — no stale marketplace version.
        _write_session_mcp_json(Path(project_root))
        _write_session_skills(Path(project_root))

        # Invoke the /pm:plan skill — Claude Code loads pm-planner/SKILL.md automatically.
        planning_prompt = "/pm:plan"
        spawn_err = _spawn_claude_session(session_key, planning_prompt, cwd=project_root)
        if spawn_err:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": spawn_err}).encode())
            return

        with _sessions_lock:
            _sessions[session_key] = {
                "state": "starting",
                "started": time.time(),
                "final": False,
                "is_plan": True,
            }

        payload = json.dumps({"ok": True, "session_key": session_key})
        self._respond(200, "application/json", payload.encode())

    def _handle_plan_kill(self, session_key: str) -> None:
        """Kill a planning session by key, cleaning up the tmux session."""
        session_key = session_key.strip()
        if not session_key.startswith("PLAN-"):
            self._respond(400, "application/json",
                          json.dumps({"ok": False, "error": "invalid session key"}).encode())
            return
        _kill_tmux_session(session_key)
        with _sessions_lock:
            if session_key in _sessions:
                _sessions[session_key]["final"] = True
        self._respond(200, "application/json", json.dumps({"ok": True}).encode())

    def _handle_issue_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            issue = store.create_issue(
                title=body.get("title", "Untitled"),
                description=body.get("description", ""),
                issue_type=body.get("type", "task"),
                priority=body.get("priority", "medium"),
                epic_id=body.get("epic_id"),
                sprint_id=body.get("sprint_id"),
                scope=body.get("scope"),
                acceptance_criteria=body.get("acceptance_criteria"),
            )
            _broadcast_event({"type": "issue_created", "payload": {"id": issue["id"], "title": issue["title"]}})
            self._respond(201, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    # -----------------------------------------------------------------------
    # PUT handler
    # -----------------------------------------------------------------------

    def do_PUT(self) -> None:
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body: Dict[str, Any] = json.loads(self.rfile.read(length) or b"{}") if length > 0 else {}

        if path.startswith("/api/issues/"):
            issue_id = path[len("/api/issues/"):].upper()
            self._handle_issue_update(issue_id, body)
        elif path.startswith("/api/docs/"):
            doc_id = path[len("/api/docs/"):].upper()
            self._handle_doc_update(doc_id, body)
        else:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": "not found"}).encode())

    def _handle_issue_update(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            allowed_keys = {
                "status", "title", "description", "priority",
                "epic_id", "sprint_id", "scope",
                "acceptance_criteria", "criteria_done",
                "flagged_reason", "flagged_options",
                "tags", "assignee", "pinned", "weight",
            }
            updates = {k: v for k, v in body.items() if k in allowed_keys}
            issue = store.update_issue(issue_id, updates)
            if issue:
                _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
                self._respond(200, "application/json",
                              json.dumps({"ok": True, "issue": issue}).encode())
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_update(self, doc_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            allowed_keys = {"title", "content", "parent_id", "doc_type", "doc_status", "superseded_by"}
            updates = {k: v for k, v in body.items() if k in allowed_keys}
            doc = store.update_doc(doc_id, updates)
            if doc:
                _broadcast_event({"type": "doc_updated", "payload": {"id": doc_id}})
                self._respond(200, "application/json",
                              json.dumps({"ok": True, "document": doc}).encode())
            else:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "not found"}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    # ── v0.6.0 new handlers ───────────────────────────────────────────────────

    def _serve_workspace_health(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            result = store.workspace_health()
            self._respond(200, "application/json", json.dumps(result, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issues_bulk_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            issues_list = body.get("issues", [])
            if not issues_list:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "issues list required"}).encode())
                return
            created = store.create_issues_bulk(issues_list)
            for issue in created:
                _broadcast_event({"type": "issue_created",
                                  "payload": {"id": issue["id"], "title": issue["title"]}})
            self._respond(201, "application/json",
                          json.dumps({"ok": True, "count": len(created), "issues": created}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_clone(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            overrides = {k: v for k, v in body.items()
                         if k in {"title", "epic_id", "sprint_id", "priority", "scope"}}
            clone = store.clone_issue(issue_id, overrides)
            _broadcast_event({"type": "issue_created",
                              "payload": {"id": clone["id"], "title": clone["title"]}})
            self._respond(201, "application/json",
                          json.dumps({"ok": True, "clone": clone}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_session(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            summary = body.get("summary", "").strip()
            if not summary:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "summary required"}).encode())
                return
            issue = store.attach_session(
                issue_id=issue_id,
                summary=summary,
                files_changed=body.get("files_changed"),
                tests_added=body.get("tests_added"),
            )
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_flag(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            reason = body.get("reason", "").strip()
            if not reason:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "reason required"}).encode())
                return
            issue = store.flag_issue(issue_id, reason, body.get("options"))
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_commit(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            sha = body.get("sha", "").strip()
            if not sha:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "sha required"}).encode())
                return
            entry = store.link_commit(issue_id, sha, body.get("message", ""), body.get("url", ""))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "commit_link": entry}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_sprint_plan(self, body: Dict[str, Any]) -> None:
        """POST /api/sprint/plan — return a sprint plan proposal from backlog analysis."""
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            backlog = store.list_issues(sprint_id="backlog")
            config = store.get_project_config()
            # Return structured context for the dashboard to display as proposal UI
            epics = [i for i in backlog if i.get("type") == "epic"]
            tasks = [i for i in backlog if i.get("type") != "epic"]
            by_scope = {"nano": [], "small": [], "medium": [], "large": [], "research": [], "unset": []}
            for t in tasks:
                sc = t.get("scope") or "unset"
                by_scope.setdefault(sc, []).append({"id": t["id"], "title": t["title"], "priority": t.get("priority")})
            self._respond(200, "application/json", json.dumps({
                "ok": True,
                "project_name": config.get("project_name"),
                "backlog_count": len(backlog),
                "epics": [{"id": e["id"], "title": e["title"]} for e in epics],
                "tasks_by_scope": by_scope,
                "hint": "Select epic_ids and task IDs, set a goal, then call pm_sprint_manage(action='create') to create the sprint.",
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    # ── v0.7.0 new handlers ───────────────────────────────────────────────────

    def _serve_templates(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "templates": store.list_templates()}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_template_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            name = body.get("name", "").strip()
            if not name:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "name required"}).encode())
                return
            tmpl = store.create_template(name, body.get("fields", {}))
            self._respond(201, "application/json", json.dumps({"ok": True, "template": tmpl}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_template_delete(self, name: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            removed = store.delete_template(name)
            self._respond(200, "application/json", json.dumps({"ok": removed, "name": name}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_filters(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "filters": store.list_filters()}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_filter_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            name = body.get("name", "").strip()
            if not name:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "name required"}).encode())
                return
            f = store.create_filter(name, body.get("criteria", {}))
            self._respond(201, "application/json", json.dumps({"ok": True, "filter": f}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_filter_delete(self, name: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            removed = store.delete_filter(name)
            self._respond(200, "application/json", json.dumps({"ok": removed, "name": name}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_standup(self, since_hours: int = 24) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            from datetime import datetime, timezone, timedelta
            store = PMStore(str(self._pm_root.parent))
            now = datetime.now(timezone.utc)
            cutoff = (now - timedelta(hours=since_hours)).isoformat()
            active_sprint_id = store.get_active_sprint_id()
            all_issues = store.list_issues(sprint_id=active_sprint_id) if active_sprint_id else store.list_issues()
            config = store.get_project_config()

            recently_done, in_progress_list, needs_input_list, newly_created = [], [], [], []
            for issue in all_issues:
                status = issue.get("status", "").upper()
                updated = issue.get("updated_at", "")
                created = issue.get("created_at", "")
                summaries = issue.get("session_summaries", [])
                if status in ("DONE", "REVIEW") and updated >= cutoff:
                    recently_done.append({"id": issue["id"], "title": issue["title"], "status": status,
                                          "last_summary": summaries[-1]["summary"][:200] if summaries else None})
                elif status == "IN_PROGRESS":
                    in_progress_list.append({"id": issue["id"], "title": issue["title"],
                                             "progress": issue.get("progress", 0),
                                             "last_summary": summaries[-1]["summary"][:200] if summaries else None})
                elif status == "NEEDS_INPUT":
                    needs_input_list.append({"id": issue["id"], "title": issue["title"],
                                             "reason": issue.get("flagged_reason", "")})
                if created >= cutoff and status == "TODO":
                    newly_created.append({"id": issue["id"], "title": issue["title"]})

            sprint_name = "No active sprint"
            if active_sprint_id:
                for s in config.get("sprints", []):
                    if s["id"] == active_sprint_id:
                        sprint_name = s.get("name", active_sprint_id)
                        break
            self._respond(200, "application/json", json.dumps({
                "ok": True, "since_hours": since_hours, "sprint_name": sprint_name,
                "recently_done": recently_done, "in_progress": in_progress_list,
                "needs_input": needs_input_list, "newly_created": newly_created,
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_split(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            parts = body.get("parts", [])
            if not parts:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "parts required"}).encode())
                return
            result = store.split_issue(issue_id, parts)
            for child in result["children"]:
                _broadcast_event({"type": "issue_created", "payload": {"id": child["id"], "title": child["title"]}})
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(201, "application/json",
                          json.dumps({"ok": True, "children": result["children"],
                                      "original_id": issue_id}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_checkin(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            pct = int(body.get("progress_pct", 0))
            what_done = body.get("what_done", "").strip()
            if not what_done:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "what_done required"}).encode())
                return
            entry = store.checkin_issue(issue_id, pct, what_done, body.get("what_remains", ""))
            _broadcast_event({"type": "issue_checkin",
                              "payload": {"id": issue_id, "progress": pct, "what_done": what_done}})
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "checkin": entry}).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_summarize(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            result = store.summarize_thread(issue_id)
            if result.get("compressed"):
                _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps(result).encode())
        except ValueError as exc:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    # ── v0.8.0 new handlers ───────────────────────────────────────────────────

    def _serve_wip_limits(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "wip_limits": store.get_wip_limits()}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_session_templates(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "templates": store.list_session_templates()}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_session_template_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            name = body.get("name", "").strip()
            if not name:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "name required"}).encode()); return
            tmpl = store.create_session_template(name, body.get("prompt_prefix", ""), body.get("match_types"), body.get("match_tags"))
            self._respond(201, "application/json", json.dumps({"ok": True, "template": tmpl}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_session_template_delete(self, name: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            removed = store.delete_session_template(name)
            self._respond(200, "application/json", json.dumps({"ok": removed}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_sprint_themes(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "themes": store.list_sprint_themes()}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_sprint_theme_create(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            name = body.get("name", "").strip()
            if not name:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "name required"}).encode()); return
            theme = store.create_sprint_theme(name, body.get("description", ""), body.get("color", "#0052CC"))
            self._respond(201, "application/json", json.dumps({"ok": True, "theme": theme}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_sprint_theme_delete(self, name: str) -> None:
        self._respond(200, "application/json", json.dumps({"ok": True}).encode())

    def _handle_issue_assign(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            assignee = body.get("assignee") or None
            issue = store.assign_issue(issue_id, assignee)
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_pin(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            pinned = bool(body.get("pinned", True))
            issue = store.pin_issue(issue_id, pinned)
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_reopen(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            reason = body.get("reason", "").strip()
            if not reason:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "reason required"}).encode()); return
            issue = store.reopen_issue(issue_id, reason, body.get("reporter", "User"))
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id, "status": "TODO"}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_abort(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            reason = body.get("reason", "").strip()
            if not reason:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "reason required"}).encode()); return
            issue = store.abort_session(issue_id, reason, body.get("what_was_attempted", ""), body.get("codebase_state", "clean"))
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id, "status": "TODO"}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_handoff(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            next_step = body.get("next_step", "").strip()
            if not next_step:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "next_step required"}).encode()); return
            issue = store.set_session_handoff(issue_id, next_step, body.get("files_in_progress"), body.get("partial_criteria_done"))
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_checklist(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            items = body.get("items")
            if items is not None:
                issue = store.set_issue_checklist(issue_id, items)
            else:
                index = body.get("index")
                done = body.get("done", True)
                if index is None:
                    self._respond(400, "application/json", json.dumps({"ok": False, "error": "items or index required"}).encode()); return
                issue = store.check_checklist_item(issue_id, int(index), bool(done))
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_risk(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            risk_type = body.get("risk_type", "security")
            reason = body.get("reason", "").strip()
            if not reason:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "reason required"}).encode()); return
            issue = store.risk_flag_issue(issue_id, risk_type, reason)
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_comment_reply(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            parent_id = int(body.get("parent_comment_id", 0))
            reply_body = body.get("body", "").strip()
            if not reply_body:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "body required"}).encode()); return
            reply = store.comment_reply(issue_id, parent_id, reply_body, body.get("author", "User"))
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id}})
            self._respond(200, "application/json", json.dumps({"ok": True, "reply": reply}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_issue_health(self, issue_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            from datetime import datetime, timezone
            store = PMStore(str(self._pm_root.parent))
            issue = store.get_issue(issue_id)
            if not issue:
                self._respond(404, "application/json", json.dumps({"ok": False, "error": "not found"}).encode()); return
            now_dt = datetime.now(timezone.utc)
            score = 0
            desc_len = len((issue.get("description") or "").strip())
            crit_count = len(issue.get("acceptance_criteria") or [])
            scope_set = bool(issue.get("scope"))
            spec = min(25, (10 if desc_len >= 50 else 0) + (10 if crit_count >= 3 else 5 if crit_count >= 1 else 0) + (5 if scope_set else 0))
            score += spec
            reopens = issue.get("reopen_count", 0)
            sessions = len(issue.get("session_summaries") or [])
            stability = max(0, 25 - reopens * 8 - (10 if sessions > 3 else 0))
            score += stability
            try:
                updated = datetime.fromisoformat(issue.get("updated_at", "").replace("Z", "+00:00"))
                age_days = (now_dt - updated).days
                freshness = max(0, 25 - int(age_days / 14 * 25))
            except Exception:
                freshness = 0
            score += freshness
            status = issue.get("status", "TODO")
            prog = 25 if status == "DONE" else 20 if status == "REVIEW" else int(issue.get("progress", 0) / 100 * 25) if status == "IN_PROGRESS" else 5
            score += prog
            grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
            self._respond(200, "application/json", json.dumps({"ok": True, "issue_id": issue_id, "score": score, "grade": grade}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_sprint_health(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            from datetime import datetime, timezone
            store = PMStore(str(self._pm_root.parent))
            active_sprint_id = store.get_active_sprint_id()
            if not active_sprint_id:
                self._respond(200, "application/json", json.dumps({"ok": False, "error": "No active sprint"}).encode()); return
            config = store.get_project_config()
            sprint = next((s for s in config.get("sprints", []) if s["id"] == active_sprint_id), None)
            issues = store.list_issues(sprint_id=active_sprint_id)
            scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}
            done = [i for i in issues if i.get("status") == "DONE"]
            scope_done = sum(scope_weights.get(i.get("scope") or "", 2) for i in done)
            scope_total = sum(scope_weights.get(i.get("scope") or "", 2) for i in issues)
            needs_input = [i for i in issues if i.get("status") == "NEEDS_INPUT"]
            days_remaining = None
            if sprint and sprint.get("end_date"):
                try:
                    end = datetime.fromisoformat(sprint["end_date"].replace("Z", "+00:00"))
                    days_remaining = max(0, (end - datetime.now(timezone.utc)).days)
                except Exception:
                    pass
            self._respond(200, "application/json", json.dumps({
                "ok": True, "sprint_id": active_sprint_id,
                "sprint_name": sprint.get("name") if sprint else None,
                "days_remaining": days_remaining,
                "tickets": {"done": len(done), "in_progress": len([i for i in issues if i.get("status") == "IN_PROGRESS"]),
                            "todo": len([i for i in issues if i.get("status") == "TODO"]),
                            "needs_input": len(needs_input)},
                "scope_pct": int(scope_done / max(scope_total, 1) * 100),
                "needs_input_ids": [i["id"] for i in needs_input],
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_daily_briefing(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            from datetime import datetime, timezone
            store = PMStore(str(self._pm_root.parent))
            if not store.is_initialized():
                self._respond(200, "application/json", json.dumps({"ok": False, "error": "not initialized"}).encode()); return
            active_sprint_id = store.get_active_sprint_id()
            sprint_issues = store.list_issues(sprint_id=active_sprint_id) if active_sprint_id else store.list_issues()
            config = store.get_project_config()
            sprint_info: Dict[str, Any] = {}
            if active_sprint_id:
                for s in config.get("sprints", []):
                    if s["id"] == active_sprint_id:
                        sprint_info = s; break
            done = [i for i in sprint_issues if i.get("status") == "DONE"]
            in_progress = [i for i in sprint_issues if i.get("status") == "IN_PROGRESS"]
            needs_input = [i for i in sprint_issues if i.get("status") == "NEEDS_INPUT"]
            todo = [i for i in sprint_issues if i.get("status") == "TODO"]
            top_tickets = sorted(todo, key=lambda i: (i.get("weight", 50),))[:3]
            self._respond(200, "application/json", json.dumps({
                "ok": True,
                "sprint_name": sprint_info.get("name", "No sprint"),
                "sprint_goal": sprint_info.get("goal", ""),
                "tickets_done": len(done), "tickets_in_progress": len(in_progress), "tickets_todo": len(todo),
                "recommended_next": [{"id": i["id"], "title": i["title"]} for i in top_tickets],
                "needs_input_queue": [{"id": i["id"], "reason": i.get("flagged_reason", "")} for i in needs_input],
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    # ── v0.9.0 new handlers ───────────────────────────────────────────────────

    def _serve_board_sort(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            self._respond(200, "application/json",
                          json.dumps({"ok": True, "board_sort": store.get_board_sort()}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_board_sort_set(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            column = body.get("column", "").strip().upper()
            mode = body.get("mode", "creation").strip()
            if not column:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "column required"}).encode())
                return
            result = store.set_board_sort(column, mode)
            self._respond(200, "application/json", json.dumps({"ok": True, "board_sort": result}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_issue_snapshots(self, issue_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            snaps = store.list_snapshots(issue_id.upper())
            self._respond(200, "application/json", json.dumps({"ok": True, "snapshots": snaps}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_snapshot(self, issue_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            snap = store.take_snapshot(issue_id.upper(), body.get("label", ""))
            self._respond(201, "application/json", json.dumps({"ok": True, "snapshot": snap}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_snapshot_restore(self, issue_id: str, snapshot_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            if not snapshot_id:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "snapshot_id required"}).encode())
                return
            issue = store.restore_snapshot(issue_id.upper(), snapshot_id)
            _broadcast_event({"type": "issue_updated", "payload": {"id": issue_id.upper()}})
            self._respond(200, "application/json", json.dumps({"ok": True, "issue": issue}).encode())
        except ValueError as exc:
            self._respond(404, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_workspace_analytics(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            from datetime import datetime, timezone, timedelta
            store = PMStore(str(self._pm_root.parent))
            if not store.is_initialized():
                self._respond(200, "application/json", json.dumps({"ok": False, "error": "not initialized"}).encode())
                return
            all_issues = store.list_issues()
            config = store.get_project_config()
            total_sessions = sum(len(i.get("session_summaries") or []) for i in all_issues)
            done_issues = [i for i in all_issues if i.get("status") == "DONE"]
            by_scope: Dict[str, int] = {}
            for i in all_issues:
                sc = i.get("scope") or "unset"
                by_scope[sc] = by_scope.get(sc, 0) + 1
            most_reopened = sorted(
                [{"id": i["id"], "title": i["title"][:40], "reopen_count": i.get("reopen_count", 0)}
                 for i in all_issues if i.get("reopen_count", 0) > 0],
                key=lambda x: x["reopen_count"], reverse=True
            )[:5]
            self._respond(200, "application/json", json.dumps({
                "ok": True,
                "total_issues": len(all_issues),
                "done_issues": len(done_issues),
                "total_sessions": total_sessions,
                "by_scope": by_scope,
                "most_reopened": most_reopened,
                "avg_sessions": round(total_sessions / max(len(all_issues), 1), 2),
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_sprint_autopilot(self, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            sprint_id = body.get("sprint_id") or store.get_active_sprint_id()
            max_parallel = int(body.get("max_parallel", 2))
            if not sprint_id:
                self._respond(400, "application/json", json.dumps({"ok": False, "error": "No active sprint"}).encode())
                return
            sprint_issues = store.list_issues(sprint_id=sprint_id)
            in_progress = [i for i in sprint_issues if i.get("status") == "IN_PROGRESS"]
            needs_input = [i for i in sprint_issues if i.get("status") == "NEEDS_INPUT"]
            todo = [i for i in sprint_issues if i.get("status") == "TODO"]
            wip_limit = max_parallel
            available = max(0, wip_limit - len(in_progress))
            issue_map = {i["id"]: i for i in store.list_issues()}
            def _blocked(iss: Dict[str, Any]) -> bool:
                return any(
                    issue_map.get(lk["to_id"], {}).get("status") not in ("DONE", "REVIEW")
                    for lk in (iss.get("links") or [])
                    if lk.get("type") == "is-blocked-by"
                )
            ready = sorted([i for i in todo if not _blocked(i)],
                           key=lambda i: (i.get("weight", 50),))[:available]
            self._respond(200, "application/json", json.dumps({
                "ok": True,
                "sprint_id": sprint_id,
                "available_slots": available,
                "needs_input_count": len(needs_input),
                "next_to_run": [{"id": i["id"], "title": i["title"]} for i in ready],
            }, default=str).encode())
        except Exception as exc:
            self._respond(500, "application/json", json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_server_exit(self) -> None:
        """Shut down the dashboard server gracefully."""
        self._respond(200, "application/json", json.dumps({"ok": True, "message": "Shutting down"}).encode())
        # Signal the server on a short delay so the response reaches the browser first
        def _do_exit() -> None:
            time.sleep(0.3)
            os.kill(os.getpid(), signal.SIGTERM)
        threading.Thread(target=_do_exit, daemon=True).start()

    def _handle_server_restart(self) -> None:
        """Rebuild dashboard/dist and restart the server process."""
        self._respond(200, "application/json", json.dumps({"ok": True, "message": "Rebuilding and restarting…"}).encode())

        plugin_root = Path(__file__).resolve().parents[1]
        dashboard_dir = plugin_root / "dashboard"
        pid_path = self._pm_root / "dashboard.pid"

        def _do_restart() -> None:
            time.sleep(0.2)
            # Rebuild the SPA if the dashboard directory exists
            if (dashboard_dir / "package.json").exists():
                try:
                    subprocess.run(
                        ["npm", "run", "build:force"],
                        cwd=str(dashboard_dir),
                        capture_output=True,
                        timeout=120,
                    )
                except Exception:
                    pass  # Restart anyway even if build fails

            # Re-exec this process: launch a fresh pm-dashboard and exit this one.
            # We use the workspace path stored in the pid file's sibling port file.
            workspace = str(self._pm_root.parent)
            launcher = plugin_root / "bin" / "pm-dashboard"
            try:
                subprocess.Popen(
                    [sys.executable, str(launcher), workspace],
                    start_new_session=True,
                )
            except Exception:
                pass
            # Terminate self after a moment
            time.sleep(0.5)
            os.kill(os.getpid(), signal.SIGTERM)

        threading.Thread(target=_do_restart, daemon=True).start()

    def _serve_changelog(self) -> None:
        """Parse CHANGELOG.md and return structured version entries as JSON."""
        try:
            plugin_root = Path(__file__).resolve().parents[1]
            changelog_path = plugin_root / "CHANGELOG.md"
            if not changelog_path.exists():
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": "CHANGELOG.md not found"}).encode())
                return

            text = changelog_path.read_text(encoding="utf-8")
            entries: List[Dict[str, Any]] = []
            current: Optional[Dict[str, Any]] = None
            current_section: Optional[Dict[str, Any]] = None

            for line in text.splitlines():
                if line.startswith("## ["):
                    if current:
                        if current_section:
                            current["sections"].append(current_section)
                            current_section = None
                        entries.append(current)
                    rest = line[3:].strip()
                    version = rest[1:rest.index("]")] if "]" in rest else rest
                    date = rest.split("—")[-1].strip() if "—" in rest else ""
                    current = {"version": version, "date": date, "sections": []}
                    current_section = None
                elif line.startswith("### ") and current is not None:
                    if current_section:
                        current["sections"].append(current_section)
                    current_section = {"heading": line[4:].strip(), "items": []}
                elif line.startswith("- ") and current_section is not None:
                    current_section["items"].append(line[2:].strip())
                elif line.startswith("**") and current_section is not None:
                    current_section["items"].append(line.strip())

            if current:
                if current_section:
                    current["sections"].append(current_section)
                entries.append(current)

            payload = json.dumps({"ok": True, "entries": entries}, ensure_ascii=False)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _serve_migrate_status(self) -> None:
        """Return current backend type, record counts, and available migration paths."""
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            pm_root = self._pm_root
            has_sqlite = (pm_root / "pm.db").exists()
            has_jsonl = (pm_root / "config.json").exists()

            if has_sqlite and not has_jsonl:
                current = "sqlite"
            elif has_jsonl and not has_sqlite:
                current = "jsonl"
            elif has_sqlite and has_jsonl:
                current = "both"
            else:
                current = "none"

            # Count records in the active backend
            counts: Dict[str, int] = {"issues": 0, "docs": 0, "sprints": 0}
            try:
                from pm_store import PMStore
                store = PMStore(str(pm_root.parent))
                if store.is_initialized():
                    counts["issues"] = len(store.list_issues())
                    counts["docs"] = len(store.list_docs())
                    counts["sprints"] = len(store.list_sprints())
            except Exception:
                pass

            # Available migration paths
            paths = []
            if has_sqlite:
                paths.append({
                    "direction": "sqlite_to_jsonl",
                    "label": "SQLite → JSONL",
                    "description": "Convert pm.db to human-readable text files (issues.jsonl, docs.jsonl, config.json). Recommended — JSONL files are git-diffable and can be committed.",
                    "source": "sqlite",
                    "target": "jsonl",
                })
            if has_jsonl:
                paths.append({
                    "direction": "jsonl_to_sqlite",
                    "label": "JSONL → SQLite",
                    "description": "Convert text files back to pm.db. Use when you need the Postgres-compatible schema or SQLite tooling.",
                    "source": "jsonl",
                    "target": "sqlite",
                })

            payload = json.dumps({
                "ok": True,
                "current_backend": current,
                "counts": counts,
                "paths": paths,
                "pm_root": str(pm_root),
            })
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_migrate(self, body: Dict[str, Any]) -> None:
        """Run a backend migration with pre/post verification."""
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            direction = body.get("direction", "").strip()
            keep_source = bool(body.get("keep_source", False))
            pm_root = self._pm_root

            if direction not in ("sqlite_to_jsonl", "jsonl_to_sqlite"):
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": f"Unknown direction: {direction}"}).encode())
                return

            # ── Pre-migration snapshot ──────────────────────────────────────
            from pm_store import PMStore
            pre_store = PMStore(str(pm_root.parent))
            if not pre_store.is_initialized():
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "Workspace not initialized."}).encode())
                return
            pre_issues = pre_store.list_issues()
            pre_docs = pre_store.list_docs()
            pre_sprints = pre_store.list_sprints()
            pre_counts = {
                "issues": len(pre_issues),
                "docs": len(pre_docs),
                "sprints": len(pre_sprints),
            }
            pre_issue_ids = {i["id"] for i in pre_issues}
            pre_doc_ids = {d["id"] for d in pre_docs}

            # ── Run migration via MCP tool logic ────────────────────────────
            if direction == "sqlite_to_jsonl":
                db_path = pm_root / "pm.db"
                if not db_path.exists():
                    self._respond(400, "application/json",
                                  json.dumps({"ok": False, "error": "pm.db not found."}).encode())
                    return
                from pm_backend_jsonl import JSONLBackend
                target = JSONLBackend(pm_root)
                result = target.migrate_from_sqlite(db_path)
                if not result.get("ok"):
                    self._respond(500, "application/json", json.dumps(result).encode())
                    return
            else:  # jsonl_to_sqlite
                if not (pm_root / "config.json").exists():
                    self._respond(400, "application/json",
                                  json.dumps({"ok": False, "error": "config.json not found."}).encode())
                    return
                db_path = pm_root / "pm.db"
                if db_path.exists():
                    self._respond(400, "application/json",
                                  json.dumps({"ok": False,
                                              "error": "pm.db already exists. Remove it first."}).encode())
                    return
                from pm_backend_jsonl import JSONLBackend
                from pm_backend_sqlite import SQLiteBackend
                src = JSONLBackend(pm_root)
                src_config = src.get_project_config()
                target_sqlite = SQLiteBackend(pm_root)
                target_sqlite.init_workspace(src_config["project_name"], src_config["key_prefix"])
                for sprint in src.list_sprints():
                    target_sqlite.create_sprint(sprint["name"], sprint.get("goal", ""))
                for issue in src.list_issues():
                    target_sqlite.create_issue(
                        issue["title"], issue.get("description", ""),
                        issue.get("type", "task"), issue.get("priority", "medium"),
                        issue.get("epic_id"), issue.get("sprint_id"),
                    )
                    if issue.get("status", "TODO") != "TODO":
                        target_sqlite.update_issue(issue["id"], {"status": issue["status"]})
                    for c in issue.get("comments", []):
                        target_sqlite.update_issue(
                            issue["id"], {}, comment=c["body"], comment_author=c.get("author", "User")
                        )
                for doc in src.list_docs():
                    target_sqlite.create_doc(
                        doc["title"], doc.get("content", ""), doc.get("parent_id"),
                        doc.get("doc_type", "wiki"), doc.get("doc_status", ""), doc.get("superseded_by"),
                    )
                result = {
                    "ok": True,
                    "issues": len(pre_issues),
                    "docs": len(pre_docs),
                    "sprints": len(pre_sprints),
                }

            # ── Post-migration verification ──────────────────────────────────
            # Instantiate the target backend directly to read without affecting
            # the running server's store instance.
            if direction == "sqlite_to_jsonl":
                from pm_backend_jsonl import JSONLBackend as _Target  # type: ignore[no-redef]
                post_backend = _Target(pm_root)
            else:
                from pm_backend_sqlite import SQLiteBackend as _Target  # type: ignore[no-redef]
                post_backend = _Target(pm_root)

            post_issues = post_backend.list_issues()
            post_docs = post_backend.list_docs()
            post_sprints = post_backend.list_sprints()
            post_counts = {
                "issues": len(post_issues),
                "docs": len(post_docs),
                "sprints": len(post_sprints),
            }
            post_issue_ids = {i["id"] for i in post_issues}
            post_doc_ids = {d["id"] for d in post_docs}

            missing_issues = sorted(pre_issue_ids - post_issue_ids)
            missing_docs = sorted(pre_doc_ids - post_doc_ids)
            verified = not missing_issues and not missing_docs and post_counts == pre_counts

            # ── Delete source only after successful verification ─────────────
            if verified and not keep_source:
                if direction == "sqlite_to_jsonl":
                    for f in ("pm.db", "pm.db-shm", "pm.db-wal"):
                        p = pm_root / f
                        if p.exists():
                            p.unlink()
                else:
                    for f in ("config.json", "issues.jsonl", "docs.jsonl"):
                        p = pm_root / f
                        if p.exists():
                            p.unlink()
                    for p in pm_root.glob("*.lock"):
                        p.unlink(missing_ok=True)
                    for p in pm_root.glob("*.tmp"):
                        p.unlink(missing_ok=True)

            payload = json.dumps({
                "ok": True,
                "verified": verified,
                "pre_counts": pre_counts,
                "post_counts": post_counts,
                "missing_issues": missing_issues,
                "missing_docs": missing_docs,
                "source_deleted": verified and not keep_source,
                "direction": direction,
            })
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            import traceback
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc),
                                      "trace": traceback.format_exc()}).encode())

    def _serve_plugin_status(self) -> None:
        """Return the current plugin install status — useful for testing _ensure_plugin_installed."""
        claude_bin = shutil.which("claude")
        if not claude_bin:
            payload = json.dumps({"ok": False, "error": "claude CLI not found"})
            self._respond(200, "application/json", payload.encode())
            return
        try:
            result = subprocess.run(
                [claude_bin, "plugin", "list"],
                capture_output=True, text=True, timeout=15,
            )
            installed = (
                "project-management@bytedesk" in result.stdout.lower()
                or "project-management@ByteDeskAI" in result.stdout
            )
            # Parse version if visible
            version = None
            for line in result.stdout.splitlines():
                if "project-management" in line.lower() and "version" in line.lower():
                    version = line.strip()
                    break
            payload = json.dumps({
                "ok": True,
                "plugin_source": _PLUGIN_SOURCE,
                "installed": installed,
                "version_line": version,
                "ensured_this_session": _plugin_ensured,
                "raw_list_excerpt": [
                    l for l in result.stdout.splitlines()
                    if "project-management" in l.lower() or "bytedesk" in l.lower()
                ],
            }, indent=2)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            payload = json.dumps({"ok": False, "error": str(exc)})
            self._respond(500, "application/json", payload.encode())

    def _serve_plan_sessions(self) -> None:
        """Return active PLAN-* sessions so the frontend can restore state on mount.

        Dead sessions (where Claude has exited and the pane shows a shell prompt)
        are killed and excluded from the response.
        """
        sessions = []

        # Collect all PLAN-* tmux sessions and check liveness
        try:
            result = subprocess.run(
                ["tmux", "list-sessions", "-F", "#{session_name}"],
                capture_output=True, text=True,
            )
            for name in result.stdout.strip().splitlines():
                if not name.startswith("PLAN-"):
                    continue
                if not _plan_session_alive(name):
                    # Claude exited — clean up the dead tmux session
                    _kill_tmux_session(name)
                    with _sessions_lock:
                        if name in _sessions:
                            _sessions[name]["final"] = True
                    continue
                try:
                    ts = int(name.split("-", 1)[1])
                except (IndexError, ValueError):
                    ts = 0
                sessions.append({"key": name, "startedAt": ts})
                with _sessions_lock:
                    if name not in _sessions:
                        _sessions[name] = {
                            "state": "working",
                            "started": ts,
                            "final": False,
                            "is_plan": True,
                        }
        except Exception:
            pass

        sessions.sort(key=lambda s: s["startedAt"])
        payload = json.dumps({"ok": True, "sessions": sessions})
        self._respond(200, "application/json", payload.encode())

    # -----------------------------------------------------------------------
    # DELETE handler
    # -----------------------------------------------------------------------

    def do_DELETE(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/docs/") and "/link/" in path:
            parts = path.split("/")
            if len(parts) >= 6:
                doc_id = parts[3].upper()
                issue_id = parts[5].upper()
                self._handle_doc_unlink(doc_id, issue_id)
            else:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "bad path"}).encode())
        elif path.startswith("/api/workspace/templates/"):
            name = path[len("/api/workspace/templates/"):]
            self._handle_template_delete(name)
        elif path.startswith("/api/workspace/filters/"):
            name = path[len("/api/workspace/filters/"):]
            self._handle_filter_delete(name)
        elif path.startswith("/api/workspace/session_templates/"):
            name = path[len("/api/workspace/session_templates/"):]
            self._handle_session_template_delete(name)
        elif path.startswith("/api/workspace/sprint_themes/"):
            name = path[len("/api/workspace/sprint_themes/"):]
            self._handle_sprint_theme_delete(name)
        else:
            self._respond(404, "application/json",
                          json.dumps({"ok": False, "error": "not found"}).encode())

    # -----------------------------------------------------------------------
    # Doc enhancement handlers
    # -----------------------------------------------------------------------

    def _handle_doc_search(self, query: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            docs = store.list_docs()
            results = []
            q = query.strip().lower()
            if not q:
                payload = json.dumps({"ok": True, "results": []})
                self._respond(200, "application/json", payload.encode())
                return
            for doc in docs:
                content = doc.get("content", "") or ""
                idx = content.lower().find(q)
                if idx == -1:
                    # Also search title
                    if q not in (doc.get("title", "") or "").lower():
                        continue
                    excerpt = (doc.get("title", "") or "")[:100]
                else:
                    start = max(0, idx - 50)
                    end = min(len(content), idx + 50 + len(q))
                    excerpt = ("…" if start > 0 else "") + content[start:end] + ("…" if end < len(content) else "")
                results.append({
                    "id": doc["id"],
                    "title": doc.get("title", ""),
                    "doc_type": doc.get("doc_type", ""),
                    "doc_status": doc.get("doc_status", ""),
                    "excerpt": excerpt,
                })
            payload = json.dumps({"ok": True, "results": results}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_comments_get(self, doc_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            comments = store.list_doc_comments(doc_id)
            payload = json.dumps({"ok": True, "comments": comments}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_comment_post(self, doc_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            comment_body = body.get("body", "").strip()
            author = body.get("author", "User")
            if not comment_body:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "body required"}).encode())
                return
            comment = store.add_doc_comment(doc_id, comment_body, author)
            payload = json.dumps({"ok": True, "comment": comment}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_versions_list(self, doc_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            versions = store.list_doc_versions(doc_id)
            payload = json.dumps({"ok": True, "versions": versions}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_version_get(self, doc_id: str, n: int) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            version = store.get_doc_version(doc_id, n)
            if version is None:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": f"Version {n} not found"}).encode())
                return
            payload = json.dumps({"ok": True, "version": version}, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_health(self) -> None:
        try:
            from datetime import datetime, timezone, timedelta
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            docs = store.list_docs()
            doc_ids = {d["id"] for d in docs}
            findings: Dict[str, List] = {
                "no_content": [],
                "adr_no_status": [],
                "adr_stale": [],
                "superseded_missing_ref": [],
                "orphaned": [],
            }
            now = datetime.now(timezone.utc)
            stale_threshold = timedelta(days=90)
            for doc in docs:
                did = doc["id"]
                title = doc.get("title", "")
                content = (doc.get("content", "") or "").strip()
                doc_type = (doc.get("doc_type", "") or "").lower()
                doc_status = (doc.get("doc_status", "") or "").lower()
                superseded_by = doc.get("superseded_by")
                parent_id = doc.get("parent_id")
                updated_at_str = doc.get("updated_at", "")
                if not content:
                    findings["no_content"].append({"id": did, "title": title})
                if doc_type == "adr" and not doc_status:
                    findings["adr_no_status"].append({"id": did, "title": title})
                if doc_type == "adr" and doc_status == "accepted" and updated_at_str:
                    try:
                        updated = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                        if updated.tzinfo is None:
                            updated = updated.replace(tzinfo=timezone.utc)
                        days_old = (now - updated).days
                        if days_old > 90:
                            findings["adr_stale"].append({"id": did, "title": title, "days_old": days_old})
                    except (ValueError, TypeError):
                        pass
                if doc_status == "superseded" and not superseded_by:
                    findings["superseded_missing_ref"].append({"id": did, "title": title})
                if parent_id and parent_id not in doc_ids:
                    findings["orphaned"].append({"id": did, "title": title})
            payload = json.dumps({
                "ok": True,
                "total": len(docs),
                "findings": findings,
            }, default=str)
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_export(self, doc_id: str, fmt: str, include_children: bool) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            doc = store.get_doc(doc_id)
            if not doc:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": f"Document {doc_id} not found"}).encode())
                return
            md = self._doc_to_markdown(doc)
            if include_children:
                all_docs = store.list_docs()
                children = self._collect_descendants(doc_id, all_docs)
                for child in children:
                    md += "\n\n---\n\n## " + child.get("title", child["id"]) + "\n\n"
                    md += child.get("content", "") or ""
            body_bytes = md.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/markdown; charset=utf-8")
            self.send_header("Content-Disposition", f'attachment; filename="{doc_id}.md"')
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            self.wfile.write(body_bytes)
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_docs_export_all(self) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            docs = store.list_docs()
            parts = []
            for doc in docs:
                parts.append(self._doc_to_markdown(doc))
            md = "\n\n---\n\n".join(parts)
            body_bytes = md.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/markdown; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="all-docs.md"')
            self.send_header("Content-Length", str(len(body_bytes)))
            self.end_headers()
            self.wfile.write(body_bytes)
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    @staticmethod
    def _doc_to_markdown(doc: Dict[str, Any]) -> str:
        lines = [f"# {doc.get('title', doc['id'])}"]
        meta = []
        if doc.get("doc_type"):
            meta.append(f"**Type:** {doc['doc_type']}")
        if doc.get("doc_status"):
            meta.append(f"**Status:** {doc['doc_status']}")
        if doc.get("id"):
            meta.append(f"**ID:** {doc['id']}")
        if meta:
            lines.append("\n".join(meta))
        content = (doc.get("content", "") or "").strip()
        if content:
            lines.append(content)
        return "\n\n".join(lines)

    @staticmethod
    def _collect_descendants(parent_id: str, all_docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        result = []
        queue = [parent_id]
        seen = {parent_id}
        while queue:
            pid = queue.pop(0)
            for doc in all_docs:
                if (doc.get("parent_id") or "").upper() == pid.upper() and doc["id"] not in seen:
                    seen.add(doc["id"])
                    result.append(doc)
                    queue.append(doc["id"])
        return result

    def _handle_doc_link(self, doc_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            issue_id = body.get("issue_id", "").strip().upper()
            if not issue_id:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": "issue_id required"}).encode())
                return
            linked = store.link_doc_issue(doc_id, issue_id)
            payload = json.dumps({"ok": True, "linked_issues": linked})
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_unlink(self, doc_id: str, issue_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            linked = store.unlink_doc_issue(doc_id, issue_id)
            payload = json.dumps({"ok": True, "linked_issues": linked})
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_issue_linked_docs(self, issue_id: str) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            docs = store.docs_linked_to_issue(issue_id)
            slim = [
                {"id": d["id"], "title": d.get("title", ""),
                 "doc_type": d.get("doc_type", ""), "doc_status": d.get("doc_status", "")}
                for d in docs
            ]
            payload = json.dumps({"ok": True, "docs": slim})
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_gen_start(self, doc_id: str, body: Dict[str, Any]) -> None:
        try:
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(self._pm_root.parent))
            doc = store.get_doc(doc_id)
            if not doc:
                self._respond(404, "application/json",
                              json.dumps({"ok": False, "error": f"Document {doc_id} not found"}).encode())
                return
            prereq_err = _check_prerequisites()
            if prereq_err:
                self._respond(400, "application/json",
                              json.dumps({"ok": False, "error": prereq_err}).encode())
                return
            prompt_hint = body.get("prompt_hint", "").strip()
            ts = int(time.time())
            session_key = f"DOCGEN-{doc_id}-{ts}"
            prompt = (
                f"Generate or improve the content for this documentation page:\n"
                f"ID: {doc['id']}\n"
                f"Title: {doc.get('title', '')}\n"
                f"Type: {doc.get('doc_type', 'wiki')}\n"
                f"Current content: {doc.get('content', '') or '(empty)'}\n"
            )
            if prompt_hint:
                prompt += f"\n{prompt_hint}\n"
            prompt += (
                "\nUse pm_doc_update to save the content when done. "
                "Use pm_doc_comment to leave a note explaining your choices."
            )
            project_root = str(self._pm_root.parent)
            _write_session_mcp_json(Path(project_root))
            _write_session_skills(Path(project_root))
            spawn_err = _spawn_claude_session(session_key, prompt, cwd=project_root)
            if spawn_err:
                self._respond(500, "application/json",
                              json.dumps({"ok": False, "error": spawn_err}).encode())
                return
            with _sessions_lock:
                _sessions[session_key] = {
                    "state": "starting",
                    "started": time.time(),
                    "final": False,
                    "is_doc_gen": True,
                    "doc_id": doc_id,
                }
            payload = json.dumps({"ok": True, "session_key": session_key})
            self._respond(200, "application/json", payload.encode())
        except Exception as exc:
            self._respond(500, "application/json",
                          json.dumps({"ok": False, "error": str(exc)}).encode())

    def _handle_doc_gen_status(self, doc_id: str) -> None:
        doc_id = doc_id.strip().upper()
        session_key = None
        with _sessions_lock:
            for key, info in _sessions.items():
                if info.get("is_doc_gen") and info.get("doc_id", "").upper() == doc_id:
                    session_key = key
                    break
        if not session_key:
            payload = json.dumps({"ok": True, "status": "gone", "session_key": None})
            self._respond(200, "application/json", payload.encode())
            return
        state = _detect_session_state(session_key)
        if state == "gone":
            status = "gone"
        elif state in ("done",):
            status = "done"
        else:
            status = "working"
        payload = json.dumps({"ok": True, "status": status, "session_key": session_key})
        self._respond(200, "application/json", payload.encode())

    def _respond(self, code: int, ctype: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


# ---------------------------------------------------------------------------
# Server entry point
# ---------------------------------------------------------------------------

def _find_pm_root(workspace_path: Optional[str]) -> Path:
    if workspace_path:
        base = Path(workspace_path).expanduser().resolve()
        # Always return base/.pm — create it if needed (never fall back to base,
        # which caused db files to land in the project root on first boot).
        pm = base / ".pm"
        pm.mkdir(parents=True, exist_ok=True)
        return pm

    cwd = Path.cwd().resolve()
    for parent in [cwd] + list(cwd.parents):
        candidate = parent / ".pm"
        if candidate.is_dir() and (
            (candidate / "pm.db").exists()          # SQLite workspace
            or (candidate / "config.json").exists()  # JSONL workspace
        ):
            return candidate
    return cwd / ".pm"


def _find_dist_dir(plugin_root: Path) -> Optional[Path]:
    """Find dashboard/dist/ relative to plugin root."""
    candidate = plugin_root / "dashboard" / "dist"
    if (candidate / "index.html").exists():
        return candidate
    return None


def _poll_ci_watchers(root: Path) -> None:
    """Background thread: poll GitHub CI status for registered CI watchers every 60s."""
    while True:
        try:
            time.sleep(60)
            sys.path.insert(0, str(Path(__file__).parent))
            from pm_store import PMStore
            store = PMStore(str(root.parent))
            if not store.is_initialized():
                continue
            watchers = store.list_ci_watchers()
            for watcher in watchers:
                issue_id = watcher["issue_id"]
                pr_url = watcher["pr_url"]
                try:
                    import re as _re
                    m = _re.search(r"github\.com/([^/]+/[^/]+)/pull/(\d+)", pr_url)
                    if not m:
                        continue
                    repo = m.group(1)
                    pr_num = m.group(2)
                    result = subprocess.run(
                        ["gh", "pr", "view", pr_num, "--repo", repo,
                         "--json", "state,statusCheckRollup"],
                        capture_output=True, text=True, timeout=15,
                    )
                    if result.returncode != 0:
                        continue
                    data = json.loads(result.stdout)
                    pr_state = data.get("state", "").upper()
                    checks = data.get("statusCheckRollup") or []
                    ci_status = "UNKNOWN"
                    if checks:
                        conclusions = [c.get("conclusion", "").upper() for c in checks]
                        if all(c in ("SUCCESS", "NEUTRAL", "SKIPPED") for c in conclusions if c):
                            ci_status = "SUCCESS"
                        elif any(c in ("FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED") for c in conclusions):
                            ci_status = "FAILURE"
                        else:
                            ci_status = "PENDING"
                    store.update_ci_watcher(issue_id, {
                        "last_checked": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                        "last_status": ci_status,
                    })
                    issue = store.get_issue(issue_id)
                    if not issue:
                        continue
                    current_status = issue.get("status", "").upper()
                    if ci_status == "SUCCESS" and pr_state == "MERGED":
                        if current_status not in ("DONE",):
                            store.update_issue(issue_id, {"status": "DONE"},
                                               comment="CI passed + PR merged — auto-closed by CI watcher.")
                            store.remove_ci_watcher(issue_id)
                            _broadcast_event({"type": "issue_updated",
                                              "payload": {"id": issue_id, "status": "DONE"}})
                    elif ci_status == "FAILURE":
                        failing = [c.get("name", "?") for c in checks
                                   if c.get("conclusion", "").upper() in ("FAILURE", "ERROR", "TIMED_OUT")]
                        if current_status in ("REVIEW",):
                            store.update_issue(
                                issue_id, {"status": "IN_PROGRESS"},
                                comment=f"CI failed — failing jobs: {', '.join(failing[:3])}. PR: {pr_url}",
                            )
                            _broadcast_event({"type": "issue_updated",
                                              "payload": {"id": issue_id, "status": "IN_PROGRESS"}})
                except Exception:
                    pass
        except Exception:
            pass


def run(workspace_path: Optional[str] = None) -> int:
    global _DIST_DIR
    root = _find_pm_root(workspace_path)
    root.mkdir(parents=True, exist_ok=True)

    pid_path = root / "dashboard.pid"
    # Last-wins: kill any existing server so the new one always starts cleanly
    existing_pid = _read_pid(pid_path)
    if _pid_alive(existing_pid):
        try:
            os.kill(existing_pid, signal.SIGTERM)
            time.sleep(0.4)
            if _pid_alive(existing_pid):
                os.kill(existing_pid, signal.SIGKILL)
                time.sleep(0.1)
        except (ProcessLookupError, PermissionError):
            pass
    pid_path.parent.mkdir(parents=True, exist_ok=True)
    pid_path.write_text(str(os.getpid()) + "\n")
    # Always clean up pid + port files on any exit — SIGTERM, crash, normal, whatever.
    atexit.register(_release_pid_lock, pid_path)
    atexit.register(lambda: (root / "dashboard.port").unlink(missing_ok=True))

    # Locate the compiled React SPA dist/
    plugin_root = Path(__file__).resolve().parents[1]
    _DIST_DIR = _find_dist_dir(plugin_root)
    if _DIST_DIR:
        print(f"Serving SPA from {_DIST_DIR}", flush=True)
    else:
        print("Warning: dashboard/dist/ not found. Run: cd dashboard && npm run build", flush=True)

    # Remove stale db/event files from the project root if they were created
    # by the old buggy _find_pm_root (which fell back to the project dir).
    _cleanup_misplaced_files(root.parent)

    # Auto-initialize workspace on first boot if not yet set up.
    # Derives project name and key prefix from the directory name so users
    # get a working dashboard immediately without running /pm:init manually.
    _auto_init_workspace(root, plugin_root)

    port = _pick_port(root)

    # Start events tailer thread
    events_path = root / "events.jsonl"
    tailer = threading.Thread(target=_tail_events, args=(events_path,), daemon=True)
    tailer.start()

    # Start CI watcher polling thread
    ci_poller = threading.Thread(target=_poll_ci_watchers, args=(root,), daemon=True)
    ci_poller.start()

    # Set the PM root on the handler class
    DashboardHandler._pm_root = root

    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), DashboardHandler)

    def _shutdown(sig, frame):  # type: ignore[type-arg]
        _release_pid_lock(pid_path)
        # Kill ephemeral PLAN-* sessions on shutdown; ticket sessions persist intentionally
        with _sessions_lock:
            plan_sessions = [k for k in _sessions if k.startswith("PLAN-")]
        for name in plan_sessions:
            subprocess.run(
                ["tmux", "kill-session", "-t", name],
                capture_output=True,
            )
        server.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Start session monitor thread (syncs tmux session state → PM ticket status)
    monitor_thread = threading.Thread(target=_session_monitor, args=(root,), daemon=True)
    monitor_thread.start()

    print(f"PM dashboard running at http://localhost:{port}", flush=True)

    try:
        server.serve_forever()
    finally:
        _release_pid_lock(pid_path)

    return 0


def main() -> int:
    workspace = sys.argv[1] if len(sys.argv) > 1 else None
    return run(workspace)


if __name__ == "__main__":
    raise SystemExit(main())

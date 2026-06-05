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
    with _socket.socket(_socket.AF_INET, _socket.SOCK_STREAM) as s:
        s.setsockopt(_socket.SOL_SOCKET, _socket.SO_REUSEADDR, 1)
        if s.connect_ex(("127.0.0.1", port)) == 0:
            # Something is listening — find and kill it via lsof
            try:
                result = subprocess.run(
                    ["lsof", "-ti", f":{port}"],
                    capture_output=True, text=True,
                )
                for pid_str in result.stdout.strip().splitlines():
                    try:
                        os.kill(int(pid_str), signal.SIGTERM)
                    except (ProcessLookupError, ValueError):
                        pass
                # Give it a moment to die
                time.sleep(0.4)
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

            # Sync PM ticket status when session reaches a terminal state
            try:
                sys.path.insert(0, str(Path(__file__).parent))
                from pm_store import PMStore  # noqa: F811
                store = PMStore(str(pm_root.parent))
                issue = store.get_issue(ticket_id)
                if not issue:
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
        path = urlparse(self.path).path
        if path in ("/", ""):
            self._serve_index()
        elif path == "/api/status":
            self._serve_status()
        elif path == "/api/docs":
            self._serve_docs()
        elif path.startswith("/api/docs/"):
            doc_id = path[len("/api/docs/"):]
            self._serve_doc(doc_id)
        elif path == "/events":
            self._serve_sse()
        elif path == "/health":
            self._respond(200, "text/plain", b"ok")
        elif path == "/api/plugin/status":
            self._serve_plugin_status()
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

            payload = json.dumps({
                "ok": True,
                "dashboard": {
                    "project_name": config.get("project_name"),
                    "key_prefix": config.get("key_prefix"),
                    "active_sprint": sprint_info,
                    "sprint_progress": {
                        "total_tickets": len(sprint_issues),
                        "done_tickets": done_count,
                    },
                    "columns": board,
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
        elif path == "/api/issues":
            self._handle_issue_create(body)
        elif path == "/api/server/exit":
            self._handle_server_exit()
        elif path == "/api/server/restart":
            self._handle_server_restart()
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

            prompt = (
                f"Implement this ticket:\n\n"
                f"ID: {issue['id']}\n"
                f"Title: {issue['title']}\n"
                f"Description: {issue.get('description', 'No description')}\n\n"
                f"Check the codebase, implement the changes, and mark the ticket done when complete."
            )

            # Ensure MCP config and current skills are written into the workspace
            project_root = str(self._pm_root.parent)
            _write_session_mcp_json(Path(project_root))
            _write_session_skills(Path(project_root))
            spawn_err = _spawn_claude_session(ticket_id, prompt, cwd=project_root)
            if spawn_err:
                self._respond(500, "application/json",
                              json.dumps({"ok": False, "error": spawn_err}).encode())
                return

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
                "epic_id", "sprint_id",
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
            allowed_keys = {"title", "content", "parent_id", "doc_type"}
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
        return base / ".pm" if (base / ".pm").is_dir() else base

    cwd = Path.cwd().resolve()
    for parent in [cwd] + list(cwd.parents):
        candidate = parent / ".pm"
        if candidate.is_dir() and (candidate / "pm.db").exists():
            return candidate
    return cwd / ".pm"


def _find_dist_dir(plugin_root: Path) -> Optional[Path]:
    """Find dashboard/dist/ relative to plugin root."""
    candidate = plugin_root / "dashboard" / "dist"
    if (candidate / "index.html").exists():
        return candidate
    return None


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

    port = _pick_port(root)

    # Start events tailer thread
    events_path = root / "events.jsonl"
    tailer = threading.Thread(target=_tail_events, args=(events_path,), daemon=True)
    tailer.start()

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

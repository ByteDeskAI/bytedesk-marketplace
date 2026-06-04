"""PM Dashboard Server — real-time HTTP dashboard for the project-management plugin.

Architecture:
  - ThreadingHTTPServer (stdlib, zero extra deps)
  - PID lock at .pm/dashboard.pid  (first-wins: if a server is already up, exit cleanly)
  - Deterministic port: 7960 + (abs(hash(abs_path)) % 40), persisted in .pm/dashboard.port
  - SSE endpoint /events that tails .pm/events.jsonl and fans out to browsers
  - Embedded dark kanban HTML — no CDN, no build step

Run directly:
  python3 pm_dashboard_server.py [/path/to/workspace]
Or via the bin/pm-dashboard launcher.
"""
from __future__ import annotations

import http.server
import json
import os
import queue
import signal
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Embedded dashboard HTML
# ---------------------------------------------------------------------------

DASHBOARD_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title id="page-title">PM Dashboard</title>
<style>
  :root {
    --bg: #0d1117; --bg2: #161b22; --bg3: #21262d;
    --border: #30363d; --text: #e6edf3; --muted: #8b949e;
    --blue: #58a6ff; --green: #3fb950; --orange: #d29922;
    --red: #f85149; --purple: #bc8cff;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', monospace;
         background: var(--bg); color: var(--text); padding: 16px; min-height: 100vh; }

  /* Header */
  .header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px;
             padding-bottom: 12px; border-bottom: 1px solid var(--border); }
  .header h1 { font-size: 20px; color: var(--blue); flex: 1; }
  .header .key { font-size: 12px; color: var(--muted); background: var(--bg3);
                  padding: 2px 8px; border-radius: 12px; }
  .live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green);
               animation: pulse 2s infinite; }
  .live-dot.stale { background: var(--red); animation: none; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }

  /* Sprint bar */
  .sprint-bar { background: var(--bg2); border: 1px solid var(--border);
                border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;
                display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .sprint-bar .sprint-name { font-size: 14px; font-weight: 600; color: var(--blue); }
  .sprint-bar .sprint-goal { font-size: 12px; color: var(--muted); flex: 1; }
  .sprint-bar .sp-label { font-size: 11px; color: var(--muted); }
  .sprint-bar .sp-val { font-size: 13px; color: var(--text); }
  .progress-wrap { display: flex; align-items: center; gap: 8px; }
  .progress-track { width: 140px; height: 6px; background: var(--bg3);
                     border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); border-radius: 3px;
                    transition: width 0.4s ease; }
  .no-sprint { font-size: 13px; color: var(--muted); }

  /* Board */
  .board { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px;
           margin-bottom: 24px; }
  @media (max-width: 900px) { .board { grid-template-columns: repeat(2, 1fr); } }
  @media (max-width: 520px)  { .board { grid-template-columns: 1fr; } }

  .column { background: var(--bg2); border: 1px solid var(--border);
             border-radius: 8px; padding: 12px; min-height: 120px; }
  .column-header { display: flex; justify-content: space-between; align-items: center;
                   margin-bottom: 10px; }
  .column-header h2 { font-size: 11px; font-weight: 600; text-transform: uppercase;
                       letter-spacing: 0.06em; }
  .col-todo .column-header h2      { color: var(--muted); }
  .col-inprogress .column-header h2{ color: var(--blue); }
  .col-review .column-header h2    { color: var(--orange); }
  .col-done .column-header h2      { color: var(--green); }
  .col-count { font-size: 11px; color: var(--muted); background: var(--bg3);
                padding: 1px 6px; border-radius: 8px; }

  .ticket { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px;
             padding: 8px 10px; margin-bottom: 6px; font-size: 12px; cursor: default;
             transition: border-color 0.15s; }
  .ticket:hover { border-color: var(--blue); }
  .ticket .tid { color: var(--blue); font-weight: 600; font-size: 11px; }
  .ticket .ttitle { color: var(--text); margin-top: 2px; line-height: 1.4; }
  .ticket .tmeta { display: flex; gap: 6px; margin-top: 5px; flex-wrap: wrap; }
  .badge { font-size: 10px; padding: 1px 5px; border-radius: 3px; }
  .badge-bug      { background: #3d1f1f; color: var(--red); }
  .badge-story    { background: #1f2d3d; color: var(--blue); }
  .badge-task     { background: #1f2b1f; color: var(--green); }
  .badge-epic     { background: #2d1f3d; color: var(--purple); }
  .badge-high     { background: #3d2a1f; color: var(--orange); }
  .badge-critical { background: #3d1f1f; color: var(--red); }
  .badge-medium   { background: var(--bg); color: var(--muted); }
  .badge-low      { background: var(--bg); color: var(--muted); }
  .badge-sp { background: var(--bg); color: var(--muted); }
  .assignee { font-size: 10px; color: var(--muted); }

  /* Activity feed */
  .section-title { font-size: 13px; color: var(--muted); margin-bottom: 10px;
                   text-transform: uppercase; letter-spacing: 0.05em; }
  .activity { background: var(--bg2); border: 1px solid var(--border);
               border-radius: 8px; padding: 12px; }
  .activity-row { display: flex; gap: 12px; padding: 6px 0;
                   border-bottom: 1px solid var(--border); font-size: 12px; }
  .activity-row:last-child { border-bottom: none; }
  .activity-ts { color: var(--muted); white-space: nowrap; min-width: 80px; }
  .activity-action { color: var(--blue); min-width: 140px; }
  .activity-detail { color: var(--text); }
  .empty { color: var(--muted); font-size: 12px; padding: 8px 0; }

  /* Stats */
  .stats { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .stat { background: var(--bg2); border: 1px solid var(--border); border-radius: 6px;
           padding: 10px 14px; text-align: center; min-width: 80px; }
  .stat .sv { font-size: 22px; font-weight: 700; color: var(--blue); }
  .stat .sl { font-size: 11px; color: var(--muted); margin-top: 2px; }
</style>
</head>
<body>

<div class="header">
  <h1 id="proj-name">Loading…</h1>
  <span class="key" id="proj-key"></span>
  <div class="live-dot" id="live-dot" title="SSE connected"></div>
</div>

<div class="sprint-bar" id="sprint-bar">
  <span class="no-sprint">No active sprint</span>
</div>

<div class="stats" id="stats"></div>

<div class="board">
  <div class="column col-todo" id="col-TODO">
    <div class="column-header"><h2>To Do</h2><span class="col-count" id="cnt-TODO">0</span></div>
    <div id="tickets-TODO"></div>
  </div>
  <div class="column col-inprogress" id="col-IN_PROGRESS">
    <div class="column-header"><h2>In Progress</h2><span class="col-count" id="cnt-IN_PROGRESS">0</span></div>
    <div id="tickets-IN_PROGRESS"></div>
  </div>
  <div class="column col-review" id="col-REVIEW">
    <div class="column-header"><h2>Review</h2><span class="col-count" id="cnt-REVIEW">0</span></div>
    <div id="tickets-REVIEW"></div>
  </div>
  <div class="column col-done" id="col-DONE">
    <div class="column-header"><h2>Done</h2><span class="col-count" id="cnt-DONE">0</span></div>
    <div id="tickets-DONE"></div>
  </div>
</div>

<div class="section-title">Recent Activity</div>
<div class="activity" id="activity"><div class="empty">No activity yet.</div></div>

<script>
const COLS = ['TODO','IN_PROGRESS','REVIEW','DONE'];

function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function relTime(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = Date.now(), diff = now - d.getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff/60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago';
  return d.toLocaleDateString();
}

function typeBadge(t) {
  return `<span class="badge badge-${esc(t)}">${esc(t||'task')}</span>`;
}
function prioBadge(p) {
  if (!p || p==='medium') return '';
  return `<span class="badge badge-${esc(p)}">${esc(p)}</span>`;
}

function renderTicket(t) {
  const sp = t.story_points ? `<span class="badge badge-sp">${t.story_points}sp</span>` : '';
  const assignee = t.assignee ? `<span class="assignee">@${esc(t.assignee)}</span>` : '';
  return `<div class="ticket">
    <div class="tid">${esc(t.id)}</div>
    <div class="ttitle">${esc(t.title)}</div>
    <div class="tmeta">${typeBadge(t.type)}${prioBadge(t.priority)}${sp}${assignee}</div>
  </div>`;
}

function renderStats(data) {
  const d = data.dashboard;
  const total = (d.columns.TODO||[]).length + (d.columns.IN_PROGRESS||[]).length +
                (d.columns.REVIEW||[]).length + (d.columns.DONE||[]).length;
  const sp = d.sprint_progress || {};
  document.getElementById('stats').innerHTML = `
    <div class="stat"><div class="sv">${total}</div><div class="sl">Issues</div></div>
    <div class="stat"><div class="sv">${(d.columns.TODO||[]).length}</div><div class="sl">To Do</div></div>
    <div class="stat"><div class="sv">${(d.columns.IN_PROGRESS||[]).length}</div><div class="sl">In Progress</div></div>
    <div class="stat"><div class="sv">${(d.columns.DONE||[]).length}</div><div class="sl">Done</div></div>
    ${sp.story_points_total>0 ? `<div class="stat"><div class="sv">${sp.story_points_percent}%</div><div class="sl">SP Done</div></div>` : ''}
  `;
}

function renderBoard(data) {
  const d = data.dashboard;
  // header
  document.getElementById('proj-name').textContent = d.project_name || 'Project';
  document.getElementById('proj-key').textContent = d.key_prefix || '';
  document.title = (d.project_name||'PM') + ' — Dashboard';

  // sprint bar
  const sb = document.getElementById('sprint-bar');
  const sp = d.sprint_progress || {};
  if (d.active_sprint && d.active_sprint !== 'No active sprint') {
    const pct = sp.story_points_percent || 0;
    sb.innerHTML = `
      <span class="sprint-name">${esc(d.active_sprint)}</span>
      <div class="progress-wrap">
        <span class="sp-label">SP</span>
        <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
        <span class="sp-val">${sp.story_points_completed||0}/${sp.story_points_total||0}</span>
      </div>
    `;
  } else {
    sb.innerHTML = '<span class="no-sprint">No active sprint</span>';
  }

  // columns — data.issues contains full issue objects from /api/status
  const issues = data.issues || [];
  const byStatus = {TODO:[],IN_PROGRESS:[],REVIEW:[],DONE:[]};
  issues.forEach(t => {
    const s = (t.status||'TODO').replace(' ','_');
    if (byStatus[s]) byStatus[s].push(t);
  });
  COLS.forEach(col => {
    document.getElementById('cnt-'+col).textContent = byStatus[col].length;
    document.getElementById('tickets-'+col).innerHTML =
      byStatus[col].map(renderTicket).join('') || '<div class="empty">—</div>';
  });

  renderStats(data);

  // activity
  const logs = data.activity || [];
  const actEl = document.getElementById('activity');
  if (logs.length === 0) {
    actEl.innerHTML = '<div class="empty">No activity yet.</div>';
  } else {
    actEl.innerHTML = logs.map(l => `
      <div class="activity-row">
        <span class="activity-ts">${esc(relTime(l.timestamp))}</span>
        <span class="activity-action">${esc(l.action)}</span>
        <span class="activity-detail">${esc(l.details||'')}</span>
      </div>
    `).join('');
  }
}

let evtSource = null;
const dot = document.getElementById('live-dot');

function connectSSE() {
  if (evtSource) evtSource.close();
  evtSource = new EventSource('/events');
  evtSource.onopen = () => { dot.classList.remove('stale'); };
  evtSource.onmessage = () => { fetchAndRender(); };
  evtSource.onerror = () => {
    dot.classList.add('stale');
    setTimeout(connectSSE, 3000);
  };
}

function fetchAndRender() {
  fetch('/api/status')
    .then(r => r.json())
    .then(data => { if (data.ok) renderBoard(data); })
    .catch(() => {});
}

fetchAndRender();
connectSSE();
// Poll every 30s as a safety net in case SSE events are missed
setInterval(fetchAndRender, 30000);
</script>
</body>
</html>
"""

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
# Port persistence
# ---------------------------------------------------------------------------

def _pick_port(root: Path) -> int:
    port_file = root / "dashboard.port"
    if port_file.exists():
        try:
            return int(port_file.read_text().strip())
        except ValueError:
            pass
    # Deterministic base port from workspace path hash
    base = 7960 + (abs(hash(str(root.resolve()))) % 40)
    import socket
    for attempt in range(40):
        port = base + attempt
        with socket.socket() as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            if s.connect_ex(("127.0.0.1", port)) != 0:
                port_file.write_text(str(port) + "\n")
                return port
    return base  # fallback


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
# HTTP handler
# ---------------------------------------------------------------------------

class DashboardHandler(http.server.BaseHTTPRequestHandler):
    _pm_root: Path = Path(".")

    def log_message(self, fmt: str, *args: Any) -> None:
        pass  # suppress access log noise

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/" or path == "":
            self._serve_html()
        elif path == "/api/status":
            self._serve_status()
        elif path == "/events":
            self._serve_sse()
        elif path == "/health":
            self._respond(200, "text/plain", b"ok")
        else:
            self._respond(404, "text/plain", b"not found")

    def _serve_html(self) -> None:
        body = DASHBOARD_HTML.encode("utf-8")
        self._respond(200, "text/html; charset=utf-8", body)

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
                        sprint_info = f"{s['name']}" + (f" — {goal}" if goal else "")
                        break
                sprint_issues = store.list_issues(sprint_id=active_sprint_id)
            else:
                sprint_issues = issues

            sp_total = sum(t.get("story_points") or 0 for t in sprint_issues)
            sp_done = sum(
                t.get("story_points") or 0
                for t in sprint_issues
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
                        "story_points_completed": sp_done,
                        "story_points_total": sp_total,
                        "story_points_percent": int(sp_done / sp_total * 100) if sp_total else 0,
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


def run(workspace_path: Optional[str] = None) -> int:
    root = _find_pm_root(workspace_path)
    root.mkdir(parents=True, exist_ok=True)

    pid_path = root / "dashboard.pid"
    if not _try_acquire_pid_lock(pid_path):
        existing_pid = _read_pid(pid_path)
        port_file = root / "dashboard.port"
        port = int(port_file.read_text().strip()) if port_file.exists() else "?"
        print(f"PM dashboard already running (PID {existing_pid}) at http://localhost:{port}", flush=True)
        return 0

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
        server.shutdown()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

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

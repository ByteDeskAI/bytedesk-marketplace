"""SQLiteBackend — ConcreteImplementor A for the PM Bridge pattern.

Zero extra dependencies (stdlib sqlite3). Data lives in .pm/pm.db.
WAL journal mode keeps reads fast while the MCP server and dashboard
server both access the file concurrently.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional


class SQLiteBackend:
    """SQLite-backed PM storage. Satisfies the PMBackend protocol."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.db_path = root / "pm.db"
        self.events_path = root / "events.jsonl"
        self._conn: Optional[sqlite3.Connection] = None

    # --- Connection & transaction helpers ---

    def _connect(self) -> sqlite3.Connection:
        if self._conn is None:
            self.root.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(self.db_path), check_same_thread=False)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.row_factory = sqlite3.Row
            self._conn = conn
        return self._conn

    @contextmanager
    def _tx(self) -> Generator[sqlite3.Connection, None, None]:
        conn = self._connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    # --- Schema ---

    def _ensure_schema(self) -> None:
        with self._tx() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS project (
                    id               INTEGER PRIMARY KEY DEFAULT 1,
                    project_name     TEXT    NOT NULL,
                    key_prefix       TEXT    NOT NULL,
                    next_issue_id    INTEGER DEFAULT 1,
                    next_doc_id      INTEGER DEFAULT 1,
                    active_sprint_id TEXT,
                    created_at       TEXT    NOT NULL
                );
                CREATE TABLE IF NOT EXISTS issues (
                    id           TEXT PRIMARY KEY,
                    title        TEXT    NOT NULL,
                    description  TEXT    DEFAULT '',
                    type         TEXT    DEFAULT 'task',
                    status       TEXT    DEFAULT 'TODO',
                    priority     TEXT    DEFAULT 'medium',
                    epic_id      TEXT,
                    sprint_id    TEXT,
                    created_at   TEXT    NOT NULL,
                    updated_at   TEXT    NOT NULL
                );
                CREATE TABLE IF NOT EXISTS comments (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    issue_id   TEXT    NOT NULL REFERENCES issues(id),
                    author     TEXT    DEFAULT 'User',
                    body       TEXT    NOT NULL,
                    created_at TEXT    NOT NULL
                );
                CREATE TABLE IF NOT EXISTS sprints (
                    id           TEXT PRIMARY KEY,
                    name         TEXT NOT NULL,
                    goal         TEXT DEFAULT '',
                    status       TEXT DEFAULT 'PLANNING',
                    created_at   TEXT NOT NULL,
                    started_at   TEXT,
                    completed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS docs (
                    id             TEXT PRIMARY KEY,
                    title          TEXT NOT NULL,
                    content        TEXT DEFAULT '',
                    parent_id      TEXT,
                    doc_type       TEXT NOT NULL DEFAULT 'wiki',
                    doc_status     TEXT NOT NULL DEFAULT '',
                    superseded_by  TEXT,
                    created_at     TEXT NOT NULL,
                    updated_at     TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS activity_log (
                    id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    action    TEXT NOT NULL,
                    details   TEXT DEFAULT ''
                );
            """)
            # Non-destructive migrations for existing databases
            existing_cols = {
                row[1] for row in conn.execute("PRAGMA table_info(docs)").fetchall()
            }
            for col, defn in [
                ("doc_type",      "TEXT NOT NULL DEFAULT 'wiki'"),
                ("doc_status",    "TEXT NOT NULL DEFAULT ''"),
                ("superseded_by", "TEXT"),
            ]:
                if col not in existing_cols:
                    conn.execute(f"ALTER TABLE docs ADD COLUMN {col} {defn}")

    # --- Lifecycle ---

    def init_workspace(self, project_name: str = "Local Project", key_prefix: str = "PM") -> str:
        self._ensure_schema()
        now = self._now()
        with self._tx() as conn:
            existing = conn.execute("SELECT id FROM project WHERE id = 1").fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO project (id, project_name, key_prefix, created_at) VALUES (1, ?, ?, ?)",
                    (project_name.strip(), key_prefix.strip().upper(), now),
                )
                conn.execute(
                    "INSERT INTO activity_log (timestamp, action, details) VALUES (?, ?, ?)",
                    (now, "Project initialized", f"Project: {project_name} ({key_prefix})"),
                )
        self.emit_event("workspace_initialized", {"project_name": project_name, "key_prefix": key_prefix})
        return str(self.root)

    def is_initialized(self) -> bool:
        if not self.db_path.exists():
            return False
        try:
            conn = self._connect()
            row = conn.execute("SELECT id FROM project WHERE id = 1").fetchone()
            return row is not None
        except Exception:
            return False

    def get_project_config(self) -> Dict[str, Any]:
        conn = self._connect()
        row = conn.execute("SELECT * FROM project WHERE id = 1").fetchone()
        if not row:
            raise FileNotFoundError("Workspace not initialized.")
        config = dict(row)
        # Embed sprints and recent activity for pm_status parity
        config["sprints"] = self.list_sprints()
        rows = conn.execute(
            "SELECT timestamp, action, details FROM activity_log ORDER BY id DESC LIMIT 5"
        ).fetchall()
        config["activity_log"] = [dict(r) for r in rows]
        return config

    def log_activity(self, action: str, details: str = "") -> None:
        try:
            now = self._now()
            with self._tx() as conn:
                conn.execute(
                    "INSERT INTO activity_log (timestamp, action, details) VALUES (?, ?, ?)",
                    (now, action, details),
                )
                conn.execute(
                    "DELETE FROM activity_log WHERE id NOT IN "
                    "(SELECT id FROM activity_log ORDER BY id DESC LIMIT 100)"
                )
        except Exception:
            pass

    def emit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        try:
            record = json.dumps(
                {"ts": self._now(), "type": event_type, "payload": payload},
                separators=(",", ":"),
            )
            with open(self.events_path, "a", encoding="utf-8") as f:
                f.write(record + "\n")
        except Exception:
            pass

    # --- Issues ---

    def _next_issue_id(self, conn: sqlite3.Connection) -> str:
        row = conn.execute("SELECT key_prefix, next_issue_id FROM project WHERE id = 1").fetchone()
        issue_id = f"{row['key_prefix']}-{row['next_issue_id']}"
        conn.execute("UPDATE project SET next_issue_id = next_issue_id + 1 WHERE id = 1")
        return issue_id

    def create_issue(
        self,
        title: str,
        description: str = "",
        issue_type: str = "task",
        priority: str = "medium",
        epic_id: Optional[str] = None,
        sprint_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = self._now()
        with self._tx() as conn:
            issue_id = self._next_issue_id(conn)
            conn.execute(
                """INSERT INTO issues
                   (id, title, description, type, status, priority,
                    epic_id, sprint_id, created_at, updated_at)
                   VALUES (?, ?, ?, ?, 'TODO', ?, ?, ?, ?, ?)""",
                (
                    issue_id,
                    title.strip(),
                    description.strip(),
                    issue_type.strip().lower(),
                    priority.strip().lower(),
                    epic_id.strip() if epic_id else None,
                    sprint_id.strip() if sprint_id else None,
                    now,
                    now,
                ),
            )
        issue = self.get_issue(issue_id)
        self.log_activity("Create Issue", f"Created {issue_id}: {title}")
        self.emit_event("issue_created", {"id": issue_id, "title": title})
        return issue  # type: ignore[return-value]

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM issues WHERE id = ?", (issue_id.strip().upper(),)
        ).fetchone()
        if not row:
            return None
        issue = dict(row)
        comments = conn.execute(
            "SELECT * FROM comments WHERE issue_id = ? ORDER BY id", (issue["id"],)
        ).fetchall()
        issue["comments"] = [dict(c) for c in comments]
        return issue

    def update_issue(
        self,
        issue_id: str,
        updates: Dict[str, Any],
        comment: Optional[str] = None,
        comment_author: str = "User",
    ) -> Optional[Dict[str, Any]]:
        issue_id = issue_id.strip().upper()
        if not self.get_issue(issue_id):
            return None

        allowed = {"title", "description", "type", "status", "priority",
                   "epic_id", "sprint_id"}
        set_clauses: List[str] = []
        params: List[Any] = []
        changes: List[str] = []
        for field, val in updates.items():
            if field in allowed:
                set_clauses.append(f"{field} = ?")
                params.append(val)
                changes.append(field)

        now = self._now()
        if set_clauses:
            set_clauses.append("updated_at = ?")
            params.extend([now, issue_id])
            with self._tx() as conn:
                conn.execute(
                    f"UPDATE issues SET {', '.join(set_clauses)} WHERE id = ?", params
                )

        if comment and comment.strip():
            with self._tx() as conn:
                conn.execute(
                    "INSERT INTO comments (issue_id, author, body, created_at) VALUES (?, ?, ?, ?)",
                    (issue_id, comment_author, comment.strip(), now),
                )
            changes.append("added comment")

        if changes:
            self.log_activity("Update Issue", f"Updated {issue_id}: {', '.join(changes)}")
            self.emit_event("issue_updated", {"id": issue_id, "changes": changes})

        return self.get_issue(issue_id)

    def list_issues(
        self,
        status: Optional[str] = None,
        sprint_id: Optional[str] = None,
        issue_type: Optional[str] = None,
        priority: Optional[str] = None,
        query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []

        conn = self._connect()
        sql = "SELECT * FROM issues WHERE 1=1"
        params: List[Any] = []

        if status:
            sql += " AND LOWER(status) = LOWER(?)"
            params.append(status.strip())
        if sprint_id:
            if sprint_id.strip().lower() == "backlog":
                sql += " AND (sprint_id IS NULL OR sprint_id = '')"
            else:
                sql += " AND LOWER(sprint_id) = LOWER(?)"
                params.append(sprint_id.strip())
        if issue_type:
            sql += " AND LOWER(type) = LOWER(?)"
            params.append(issue_type.strip())
        if priority:
            sql += " AND LOWER(priority) = LOWER(?)"
            params.append(priority.strip())
        if query:
            q = f"%{query.strip().lower()}%"
            sql += " AND (LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(description) LIKE ?)"
            params.extend([q, q, q])

        # Sort by numeric part of id (e.g. PM-12 → 12)
        sql += " ORDER BY CAST(SUBSTR(id, INSTR(id, '-') + 1) AS INTEGER)"

        rows = conn.execute(sql, params).fetchall()
        issues = []
        for row in rows:
            issue = dict(row)
            comments = conn.execute(
                "SELECT * FROM comments WHERE issue_id = ? ORDER BY id", (issue["id"],)
            ).fetchall()
            issue["comments"] = [dict(c) for c in comments]
            issues.append(issue)
        return issues

    # --- Sprints ---

    def _get_sprint(self, sprint_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        row = conn.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,)).fetchone()
        return dict(row) if row else None

    def create_sprint(self, name: str, goal: str = "") -> Dict[str, Any]:
        now = self._now()
        with self._tx() as conn:
            count = conn.execute("SELECT COUNT(*) FROM sprints").fetchone()[0]
            sprint_id = f"sprint-{count + 1}"
            conn.execute(
                "INSERT INTO sprints (id, name, goal, created_at) VALUES (?, ?, ?, ?)",
                (sprint_id, name.strip(), goal.strip(), now),
            )
        self.log_activity("Create Sprint", f"Created {sprint_id}: {name}")
        self.emit_event("sprint_created", {"id": sprint_id, "name": name})
        return self._get_sprint(sprint_id)  # type: ignore[return-value]

    def start_sprint(self, sprint_id: str) -> Dict[str, Any]:
        sprint_id = sprint_id.strip()
        conn = self._connect()
        active = conn.execute(
            "SELECT id FROM sprints WHERE status = 'ACTIVE'"
        ).fetchone()
        if active and active["id"] != sprint_id:
            raise ValueError(f"Cannot start sprint. Sprint {active['id']} is already ACTIVE.")
        target = self._get_sprint(sprint_id)
        if not target:
            raise ValueError(f"Sprint {sprint_id} not found.")
        now = self._now()
        with self._tx() as conn:
            conn.execute(
                "UPDATE sprints SET status = 'ACTIVE', started_at = ? WHERE id = ?",
                (now, sprint_id),
            )
            conn.execute(
                "UPDATE project SET active_sprint_id = ? WHERE id = 1", (sprint_id,)
            )
        self.log_activity("Start Sprint", f"Started {sprint_id}")
        self.emit_event("sprint_started", {"id": sprint_id})
        return self._get_sprint(sprint_id)  # type: ignore[return-value]

    def complete_sprint(self, sprint_id: str) -> Dict[str, Any]:
        sprint_id = sprint_id.strip()
        target = self._get_sprint(sprint_id)
        if not target:
            raise ValueError(f"Sprint {sprint_id} not found.")
        now = self._now()
        with self._tx() as conn:
            conn.execute(
                "UPDATE sprints SET status = 'CLOSED', completed_at = ? WHERE id = ?",
                (now, sprint_id),
            )
            conn.execute(
                "UPDATE project SET active_sprint_id = NULL WHERE id = 1 AND active_sprint_id = ?",
                (sprint_id,),
            )
        # Roll over unfinished tickets to backlog
        unfinished = self.list_issues(sprint_id=sprint_id)
        rollover = 0
        for ticket in unfinished:
            if ticket.get("status", "").upper() != "DONE":
                self.update_issue(
                    ticket["id"],
                    {"sprint_id": None},
                    comment="Sprint completed; rolled back to backlog.",
                )
                rollover += 1
        self.log_activity("Complete Sprint", f"Completed {sprint_id}. Rolled over {rollover} tickets.")
        self.emit_event("sprint_completed", {"id": sprint_id, "rollover": rollover})
        return self._get_sprint(sprint_id)  # type: ignore[return-value]

    def list_sprints(self) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []
        conn = self._connect()
        rows = conn.execute("SELECT * FROM sprints ORDER BY id").fetchall()
        return [dict(r) for r in rows]

    def get_active_sprint_id(self) -> Optional[str]:
        if not self.is_initialized():
            return None
        conn = self._connect()
        row = conn.execute(
            "SELECT active_sprint_id FROM project WHERE id = 1"
        ).fetchone()
        return row["active_sprint_id"] if row else None

    # --- Documentation ---

    def _next_doc_id(self, conn: sqlite3.Connection) -> str:
        row = conn.execute("SELECT next_doc_id FROM project WHERE id = 1").fetchone()
        doc_id = f"DOC-{row['next_doc_id']}"
        conn.execute("UPDATE project SET next_doc_id = next_doc_id + 1 WHERE id = 1")
        return doc_id

    def create_doc(
        self,
        title: str,
        content: str = "",
        parent_id: Optional[str] = None,
        doc_type: str = "wiki",
        doc_status: str = "",
        superseded_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = self._now()
        valid_types = {"wiki", "adr", "runbook", "learning", "plan", "brief"}
        valid_statuses = {"", "proposed", "accepted", "deprecated", "superseded"}
        doc_type = doc_type.lower() if doc_type.lower() in valid_types else "wiki"
        doc_status = doc_status.lower() if doc_status.lower() in valid_statuses else ""
        with self._tx() as conn:
            doc_id = self._next_doc_id(conn)
            conn.execute(
                "INSERT INTO docs (id, title, content, parent_id, doc_type, doc_status, superseded_by, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    doc_id,
                    title.strip(),
                    content,
                    parent_id.strip().upper() if parent_id else None,
                    doc_type,
                    doc_status,
                    superseded_by.strip().upper() if superseded_by else None,
                    now,
                    now,
                ),
            )
        doc = self.get_doc(doc_id)
        self.log_activity("Create Document", f"Created {doc_id} [{doc_type}]: {title}")
        self.emit_event("doc_created", {"id": doc_id, "title": title, "doc_type": doc_type})
        return doc  # type: ignore[return-value]

    def get_doc(self, doc_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        row = conn.execute(
            "SELECT * FROM docs WHERE id = ?", (doc_id.strip().upper(),)
        ).fetchone()
        return dict(row) if row else None

    def update_doc(self, doc_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        doc_id = doc_id.strip().upper()
        if not self.get_doc(doc_id):
            return None
        allowed = {"title", "content", "parent_id", "doc_type", "doc_status", "superseded_by"}
        set_clauses: List[str] = []
        params: List[Any] = []
        changes: List[str] = []
        for field, val in updates.items():
            if field in allowed:
                set_clauses.append(f"{field} = ?")
                params.append(val)
                changes.append(field)
        if set_clauses:
            now = self._now()
            set_clauses.append("updated_at = ?")
            params.extend([now, doc_id])
            with self._tx() as conn:
                conn.execute(
                    f"UPDATE docs SET {', '.join(set_clauses)} WHERE id = ?", params
                )
            self.log_activity("Update Document", f"Updated {doc_id}: {', '.join(changes)}")
            self.emit_event("doc_updated", {"id": doc_id, "changes": changes})
        return self.get_doc(doc_id)

    def list_docs(
        self,
        query: Optional[str] = None,
        doc_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []
        conn = self._connect()
        conditions: List[str] = []
        params: List[Any] = []
        if doc_type:
            conditions.append("LOWER(doc_type) = ?")
            params.append(doc_type.lower())
        if query:
            q = f"%{query.strip().lower()}%"
            conditions.append(
                "(LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(content) LIKE ?)"
            )
            params.extend([q, q, q])
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        rows = conn.execute(
            f"SELECT * FROM docs {where} ORDER BY CAST(SUBSTR(id, 5) AS INTEGER)",
            params,
        ).fetchall()
        return [dict(r) for r in rows]

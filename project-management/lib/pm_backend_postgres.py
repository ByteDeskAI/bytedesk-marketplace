"""PostgresBackend — ConcreteImplementor B for the PM Bridge pattern.

Optional backend: requires psycopg2 to be installed by the user.
Activate by setting PM_DATABASE_URL=postgres://user:pass@host/dbname.

Same public API and schema as SQLiteBackend. The only differences are:
  - %s placeholder syntax instead of ?
  - SERIAL instead of INTEGER AUTOINCREMENT for auto-increment columns
  - psycopg2 connection handling
"""
from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional


def _require_psycopg2():  # type: ignore[return]
    try:
        import psycopg2
        import psycopg2.extras
        return psycopg2
    except ImportError:
        raise ImportError(
            "PostgresBackend requires psycopg2. Install it with: pip install psycopg2-binary"
        )


class PostgresBackend:
    """Postgres-backed PM storage. Satisfies the PMBackend protocol."""

    def __init__(self, db_url: str, root: Path) -> None:
        self._psycopg2 = _require_psycopg2()
        self.db_url = db_url
        self.root = root
        self.events_path = root / "events.jsonl"
        self._conn = None

    # --- Connection & transaction helpers ---

    def _connect(self):
        if self._conn is None or self._conn.closed:
            self.root.mkdir(parents=True, exist_ok=True)
            self._conn = self._psycopg2.connect(self.db_url)
            self._conn.autocommit = False
            cur = self._conn.cursor()
            cur.execute("SET client_encoding = 'UTF8'")
            cur.close()
        return self._conn

    @contextmanager
    def _tx(self) -> Generator[Any, None, None]:
        conn = self._connect()
        cur = conn.cursor(cursor_factory=self._psycopg2.extras.RealDictCursor)
        try:
            yield cur
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()

    def _query(self, sql: str, params: tuple = ()) -> List[Dict[str, Any]]:
        conn = self._connect()
        cur = conn.cursor(cursor_factory=self._psycopg2.extras.RealDictCursor)
        try:
            cur.execute(sql, params)
            return [dict(r) for r in cur.fetchall()]
        finally:
            cur.close()

    def _query_one(self, sql: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
        rows = self._query(sql, params)
        return rows[0] if rows else None

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    # --- Schema ---

    def _ensure_schema(self) -> None:
        with self._tx() as cur:
            cur.execute("""
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
                    assignee     TEXT,
                    epic_id      TEXT,
                    sprint_id    TEXT,
                    story_points INTEGER,
                    created_at   TEXT    NOT NULL,
                    updated_at   TEXT    NOT NULL
                );
                CREATE TABLE IF NOT EXISTS comments (
                    id         SERIAL  PRIMARY KEY,
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
                    id         TEXT PRIMARY KEY,
                    title      TEXT NOT NULL,
                    content    TEXT DEFAULT '',
                    parent_id  TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS activity_log (
                    id        SERIAL PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    action    TEXT NOT NULL,
                    details   TEXT DEFAULT ''
                );
            """)

    # --- Lifecycle ---

    def init_workspace(self, project_name: str = "Local Project", key_prefix: str = "PM") -> str:
        self._ensure_schema()
        now = self._now()
        with self._tx() as cur:
            cur.execute("SELECT id FROM project WHERE id = 1")
            if not cur.fetchone():
                cur.execute(
                    "INSERT INTO project (id, project_name, key_prefix, created_at) VALUES (1, %s, %s, %s)",
                    (project_name.strip(), key_prefix.strip().upper(), now),
                )
                cur.execute(
                    "INSERT INTO activity_log (timestamp, action, details) VALUES (%s, %s, %s)",
                    (now, "Project initialized", f"Project: {project_name} ({key_prefix})"),
                )
        self.emit_event("workspace_initialized", {"project_name": project_name, "key_prefix": key_prefix})
        return str(self.root)

    def is_initialized(self) -> bool:
        try:
            row = self._query_one("SELECT id FROM project WHERE id = 1")
            return row is not None
        except Exception:
            return False

    def get_project_config(self) -> Dict[str, Any]:
        row = self._query_one("SELECT * FROM project WHERE id = 1")
        if not row:
            raise FileNotFoundError("Workspace not initialized.")
        config = dict(row)
        config["sprints"] = self.list_sprints()
        rows = self._query(
            "SELECT timestamp, action, details FROM activity_log ORDER BY id DESC LIMIT 5"
        )
        config["activity_log"] = rows
        return config

    def log_activity(self, action: str, details: str = "") -> None:
        try:
            now = self._now()
            with self._tx() as cur:
                cur.execute(
                    "INSERT INTO activity_log (timestamp, action, details) VALUES (%s, %s, %s)",
                    (now, action, details),
                )
                cur.execute(
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

    def _next_issue_id(self, cur: Any) -> str:
        cur.execute("SELECT key_prefix, next_issue_id FROM project WHERE id = 1")
        row = cur.fetchone()
        issue_id = f"{row['key_prefix']}-{row['next_issue_id']}"
        cur.execute("UPDATE project SET next_issue_id = next_issue_id + 1 WHERE id = 1")
        return issue_id

    def create_issue(
        self,
        title: str,
        description: str = "",
        issue_type: str = "task",
        priority: str = "medium",
        assignee: Optional[str] = None,
        epic_id: Optional[str] = None,
        sprint_id: Optional[str] = None,
        story_points: Optional[int] = None,
    ) -> Dict[str, Any]:
        now = self._now()
        with self._tx() as cur:
            issue_id = self._next_issue_id(cur)
            cur.execute(
                """INSERT INTO issues
                   (id, title, description, type, status, priority, assignee,
                    epic_id, sprint_id, story_points, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, 'TODO', %s, %s, %s, %s, %s, %s, %s)""",
                (
                    issue_id, title.strip(), description.strip(),
                    issue_type.strip().lower(), priority.strip().lower(),
                    assignee.strip() if assignee else None,
                    epic_id.strip() if epic_id else None,
                    sprint_id.strip() if sprint_id else None,
                    story_points, now, now,
                ),
            )
        issue = self.get_issue(issue_id)
        self.log_activity("Create Issue", f"Created {issue_id}: {title}")
        self.emit_event("issue_created", {"id": issue_id, "title": title})
        return issue  # type: ignore[return-value]

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        issue = self._query_one(
            "SELECT * FROM issues WHERE id = %s", (issue_id.strip().upper(),)
        )
        if not issue:
            return None
        comments = self._query(
            "SELECT * FROM comments WHERE issue_id = %s ORDER BY id", (issue["id"],)
        )
        issue["comments"] = comments
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
                   "assignee", "epic_id", "sprint_id", "story_points"}
        set_clauses: List[str] = []
        params: List[Any] = []
        changes: List[str] = []
        for field, val in updates.items():
            if field in allowed:
                set_clauses.append(f"{field} = %s")
                params.append(val)
                changes.append(field)

        now = self._now()
        if set_clauses:
            set_clauses.append("updated_at = %s")
            params.extend([now, issue_id])
            with self._tx() as cur:
                cur.execute(
                    f"UPDATE issues SET {', '.join(set_clauses)} WHERE id = %s", params
                )

        if comment and comment.strip():
            with self._tx() as cur:
                cur.execute(
                    "INSERT INTO comments (issue_id, author, body, created_at) VALUES (%s, %s, %s, %s)",
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
        assignee: Optional[str] = None,
        issue_type: Optional[str] = None,
        priority: Optional[str] = None,
        query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []

        sql = "SELECT * FROM issues WHERE TRUE"
        params: List[Any] = []

        if status:
            sql += " AND LOWER(status) = LOWER(%s)"
            params.append(status.strip())
        if sprint_id:
            if sprint_id.strip().lower() == "backlog":
                sql += " AND (sprint_id IS NULL OR sprint_id = '')"
            else:
                sql += " AND LOWER(sprint_id) = LOWER(%s)"
                params.append(sprint_id.strip())
        if assignee:
            sql += " AND LOWER(COALESCE(assignee, '')) LIKE LOWER(%s)"
            params.append(f"%{assignee.strip()}%")
        if issue_type:
            sql += " AND LOWER(type) = LOWER(%s)"
            params.append(issue_type.strip())
        if priority:
            sql += " AND LOWER(priority) = LOWER(%s)"
            params.append(priority.strip())
        if query:
            q = f"%{query.strip().lower()}%"
            sql += " AND (LOWER(id) LIKE %s OR LOWER(title) LIKE %s OR LOWER(description) LIKE %s)"
            params.extend([q, q, q])

        sql += " ORDER BY CAST(SPLIT_PART(id, '-', 2) AS INTEGER)"

        issues = self._query(sql, tuple(params))
        for issue in issues:
            issue["comments"] = self._query(
                "SELECT * FROM comments WHERE issue_id = %s ORDER BY id", (issue["id"],)
            )
        return issues

    # --- Sprints ---

    def create_sprint(self, name: str, goal: str = "") -> Dict[str, Any]:
        now = self._now()
        with self._tx() as cur:
            cur.execute("SELECT COUNT(*) AS c FROM sprints")
            count = cur.fetchone()["c"]
            sprint_id = f"sprint-{count + 1}"
            cur.execute(
                "INSERT INTO sprints (id, name, goal, created_at) VALUES (%s, %s, %s, %s)",
                (sprint_id, name.strip(), goal.strip(), now),
            )
        self.log_activity("Create Sprint", f"Created {sprint_id}: {name}")
        self.emit_event("sprint_created", {"id": sprint_id, "name": name})
        return self._query_one("SELECT * FROM sprints WHERE id = %s", (sprint_id,))  # type: ignore[return-value]

    def start_sprint(self, sprint_id: str) -> Dict[str, Any]:
        sprint_id = sprint_id.strip()
        active = self._query_one("SELECT id FROM sprints WHERE status = 'ACTIVE'")
        if active and active["id"] != sprint_id:
            raise ValueError(f"Cannot start sprint. Sprint {active['id']} is already ACTIVE.")
        target = self._query_one("SELECT * FROM sprints WHERE id = %s", (sprint_id,))
        if not target:
            raise ValueError(f"Sprint {sprint_id} not found.")
        now = self._now()
        with self._tx() as cur:
            cur.execute(
                "UPDATE sprints SET status = 'ACTIVE', started_at = %s WHERE id = %s",
                (now, sprint_id),
            )
            cur.execute(
                "UPDATE project SET active_sprint_id = %s WHERE id = 1", (sprint_id,)
            )
        self.log_activity("Start Sprint", f"Started {sprint_id}")
        self.emit_event("sprint_started", {"id": sprint_id})
        return self._query_one("SELECT * FROM sprints WHERE id = %s", (sprint_id,))  # type: ignore[return-value]

    def complete_sprint(self, sprint_id: str) -> Dict[str, Any]:
        sprint_id = sprint_id.strip()
        target = self._query_one("SELECT * FROM sprints WHERE id = %s", (sprint_id,))
        if not target:
            raise ValueError(f"Sprint {sprint_id} not found.")
        now = self._now()
        with self._tx() as cur:
            cur.execute(
                "UPDATE sprints SET status = 'CLOSED', completed_at = %s WHERE id = %s",
                (now, sprint_id),
            )
            cur.execute(
                "UPDATE project SET active_sprint_id = NULL WHERE id = 1 AND active_sprint_id = %s",
                (sprint_id,),
            )
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
        return self._query_one("SELECT * FROM sprints WHERE id = %s", (sprint_id,))  # type: ignore[return-value]

    def list_sprints(self) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []
        return self._query("SELECT * FROM sprints ORDER BY id")

    def get_active_sprint_id(self) -> Optional[str]:
        row = self._query_one("SELECT active_sprint_id FROM project WHERE id = 1")
        return row["active_sprint_id"] if row else None

    # --- Documentation ---

    def _next_doc_id(self, cur: Any) -> str:
        cur.execute("SELECT next_doc_id FROM project WHERE id = 1")
        row = cur.fetchone()
        doc_id = f"DOC-{row['next_doc_id']}"
        cur.execute("UPDATE project SET next_doc_id = next_doc_id + 1 WHERE id = 1")
        return doc_id

    def create_doc(
        self,
        title: str,
        content: str = "",
        parent_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        now = self._now()
        with self._tx() as cur:
            doc_id = self._next_doc_id(cur)
            cur.execute(
                "INSERT INTO docs (id, title, content, parent_id, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (doc_id, title.strip(), content,
                 parent_id.strip().upper() if parent_id else None, now, now),
            )
        doc = self.get_doc(doc_id)
        self.log_activity("Create Document", f"Created {doc_id}: {title}")
        self.emit_event("doc_created", {"id": doc_id, "title": title})
        return doc  # type: ignore[return-value]

    def get_doc(self, doc_id: str) -> Optional[Dict[str, Any]]:
        return self._query_one(
            "SELECT * FROM docs WHERE id = %s", (doc_id.strip().upper(),)
        )

    def update_doc(self, doc_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        doc_id = doc_id.strip().upper()
        if not self.get_doc(doc_id):
            return None
        allowed = {"title", "content", "parent_id"}
        set_clauses: List[str] = []
        params: List[Any] = []
        changes: List[str] = []
        for field, val in updates.items():
            if field in allowed:
                set_clauses.append(f"{field} = %s")
                params.append(val)
                changes.append(field)
        if set_clauses:
            now = self._now()
            set_clauses.append("updated_at = %s")
            params.extend([now, doc_id])
            with self._tx() as cur:
                cur.execute(
                    f"UPDATE docs SET {', '.join(set_clauses)} WHERE id = %s", params
                )
            self.log_activity("Update Document", f"Updated {doc_id}: {', '.join(changes)}")
            self.emit_event("doc_updated", {"id": doc_id, "changes": changes})
        return self.get_doc(doc_id)

    def list_docs(self, query: Optional[str] = None) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []
        if query:
            q = f"%{query.strip().lower()}%"
            return self._query(
                "SELECT * FROM docs "
                "WHERE LOWER(id) LIKE %s OR LOWER(title) LIKE %s OR LOWER(content) LIKE %s "
                "ORDER BY CAST(SPLIT_PART(id, '-', 2) AS INTEGER)",
                (q, q, q),
            )
        return self._query(
            "SELECT * FROM docs ORDER BY CAST(SPLIT_PART(id, '-', 2) AS INTEGER)"
        )

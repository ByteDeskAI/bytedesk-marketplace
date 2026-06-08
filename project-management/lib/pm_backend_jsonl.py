"""JSONLBackend — ConcreteImplementor C for the PM Bridge pattern.

Text-based storage using JSON Lines files. Zero extra dependencies.
Data lives in .pm/ as human-readable, git-diffable text files:

    .pm/
      config.json     — project config, ID counters, sprints, activity log
      issues.jsonl    — one line per issue (comments embedded as array)
      docs.jsonl      — one line per doc
      events.jsonl    — SSE event stream (append-only, unchanged)

Concurrency model
-----------------
In-process (multiple threads in the dashboard server):
  threading.RLock serialises all writes within the process.

Cross-process (dashboard server + MCP server):
  A per-collection .lock file is held exclusively via fcntl.flock
  during each read-modify-write cycle so the two processes cannot
  corrupt each other. fcntl is POSIX-only; on Windows flock is a
  no-op and cross-process safety is best-effort (same as SQLite
  without WAL on Windows).

Atomicity
---------
All file writes go through _rewrite(): write to a .tmp file then
os.replace() into place. os.replace() is atomic on POSIX — readers
see either the old or the new file, never a partial write.

SQLite backward compatibility
------------------------------
PMStore picks this backend only when pm.db is absent. Existing
workspaces with pm.db are transparently served by SQLiteBackend.
"""
from __future__ import annotations

import json
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional

try:
    import fcntl as _fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False  # Windows — cross-process locking is best-effort


class JSONLBackend:
    """JSONL-backed PM storage. Satisfies the PMBackend protocol."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.config_path = root / "config.json"
        self.issues_path = root / "issues.jsonl"
        self.docs_path = root / "docs.jsonl"
        self.events_path = root / "events.jsonl"
        self.doc_versions_path = root / "doc_versions.jsonl"
        self.snapshots_path = root / "snapshots"
        # In-process mutex — reentrant so the same thread can re-acquire
        self._lock = threading.RLock()

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def _ms_id(self) -> int:
        """Millisecond timestamp — used as comment IDs (unique enough for local use)."""
        return int(time.time() * 1000)

    @contextmanager
    def _exclusive(self, path: Path) -> Generator[None, None, None]:
        """Acquire an exclusive cross-process lock on <path>.lock."""
        lock_path = path.with_suffix(".lock")
        lock_path.parent.mkdir(parents=True, exist_ok=True)
        with open(lock_path, "w") as lf:
            if _HAS_FCNTL:
                _fcntl.flock(lf, _fcntl.LOCK_EX)
            try:
                yield
            finally:
                if _HAS_FCNTL:
                    _fcntl.flock(lf, _fcntl.LOCK_UN)

    def _read_jsonl(self, path: Path) -> List[Dict[str, Any]]:
        if not path.exists():
            return []
        try:
            return [
                json.loads(line)
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        except (json.JSONDecodeError, OSError):
            return []

    def _rewrite(self, path: Path, records: List[Dict[str, Any]]) -> None:
        """Atomically replace a JSONL file."""
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in records) + "\n",
            encoding="utf-8",
        )
        os.replace(tmp, path)

    def _read_config(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return json.loads(self.config_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _write_config(self, config: Dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.config_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, self.config_path)

    # ── ID generation (always called under self._lock + _exclusive(config)) ──

    def _next_issue_id(self, config: Dict[str, Any]) -> str:
        prefix = config["key_prefix"]
        n = config["next_issue_id"]
        config["next_issue_id"] = n + 1
        return f"{prefix}-{n}"

    def _next_doc_id(self, config: Dict[str, Any]) -> str:
        n = config["next_doc_id"]
        config["next_doc_id"] = n + 1
        return f"DOC-{n}"

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def init_workspace(self, project_name: str = "Local Project", key_prefix: str = "PM") -> str:
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            if config.get("project_name"):
                return str(self.root)  # idempotent
            now = self._now()
            config = {
                "project_name": project_name.strip(),
                "key_prefix": key_prefix.strip().upper(),
                "next_issue_id": 1,
                "next_doc_id": 1,
                "active_sprint_id": None,
                "created_at": now,
                "sprints": [],
                "board_sort": {},
                "activity_log": [{
                    "timestamp": now,
                    "action": "Project initialized",
                    "details": f"Project: {project_name} ({key_prefix})",
                }],
                "wip_limits": {},
                "session_templates": [],
                "sprint_themes": [],
            }
            self._write_config(config)
            for path in (self.issues_path, self.docs_path):
                if not path.exists():
                    path.touch()
        self.emit_event("workspace_initialized", {
            "project_name": project_name, "key_prefix": key_prefix,
        })
        return str(self.root)

    def is_initialized(self) -> bool:
        return bool(self._read_config().get("project_name"))

    def get_project_config(self) -> Dict[str, Any]:
        config = self._read_config()
        if not config.get("project_name"):
            raise FileNotFoundError("Workspace not initialized.")
        return config

    def log_activity(self, action: str, details: str = "") -> None:
        try:
            with self._lock, self._exclusive(self.config_path):
                config = self._read_config()
                log: List[Dict[str, Any]] = config.get("activity_log", [])
                log.append({"timestamp": self._now(), "action": action, "details": details})
                config["activity_log"] = log[-100:]
                self._write_config(config)
        except Exception:
            pass

    def emit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        try:
            line = json.dumps(
                {"ts": self._now(), "type": event_type, "payload": payload},
                separators=(",", ":"),
                ensure_ascii=False,
            )
            with open(self.events_path, "a", encoding="utf-8") as f:
                if _HAS_FCNTL:
                    _fcntl.flock(f, _fcntl.LOCK_EX)
                f.write(line + "\n")
        except Exception:
            pass

    # ── Issues ────────────────────────────────────────────────────────────────

    def create_issue(
        self,
        title: str,
        description: str = "",
        issue_type: str = "task",
        priority: str = "medium",
        epic_id: Optional[str] = None,
        sprint_id: Optional[str] = None,
        scope: Optional[str] = None,
        acceptance_criteria: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        assignee: Optional[str] = None,
        pinned: bool = False,
        weight: int = 50,
    ) -> Dict[str, Any]:
        valid_scopes = {"nano", "small", "medium", "large", "research"}
        with self._lock, self._exclusive(self.config_path), self._exclusive(self.issues_path):
            now = self._now()
            config = self._read_config()
            issue_id = self._next_issue_id(config)
            issue: Dict[str, Any] = {
                "id": issue_id,
                "title": title.strip(),
                "description": description.strip(),
                "type": issue_type.strip().lower(),
                "status": "TODO",
                "priority": priority.strip().lower(),
                "scope": scope.strip().lower() if scope and scope.strip().lower() in valid_scopes else None,
                "epic_id": epic_id.strip().upper() if epic_id else None,
                "sprint_id": sprint_id.strip() if sprint_id else None,
                "acceptance_criteria": list(acceptance_criteria) if acceptance_criteria else [],
                "criteria_done": [],
                "links": [],
                "remote_links": [],
                "commit_links": [],
                "session_summaries": [],
                "flagged_reason": None,
                "flagged_options": [],
                "progress": 0,
                "checkins": [],
                "created_at": now,
                "updated_at": now,
                "comments": [],
                "tags": list(tags) if tags else [],
                "assignee": assignee.strip() if assignee else None,
                "pinned": bool(pinned),
                "weight": max(0, int(weight)),
                "reopen_count": 0,
                "checklist": [],
                "handoff": None,
                "risk": None,
            }
            records = self._read_jsonl(self.issues_path)
            records.append(issue)
            self._rewrite(self.issues_path, records)
            self._write_config(config)
        self.log_activity("Create Issue", f"Created {issue_id}: {title}")
        self.emit_event("issue_created", {"id": issue_id, "title": title})
        return dict(issue)

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        upper = issue_id.strip().upper()
        for r in self._read_jsonl(self.issues_path):
            if r.get("id", "").upper() == upper:
                return dict(r)
        return None

    _VALID_STATUSES = frozenset({"TODO", "IN_PROGRESS", "REVIEW", "DONE", "NEEDS_INPUT"})

    def update_issue(
        self,
        issue_id: str,
        updates: Dict[str, Any],
        comment: Optional[str] = None,
        comment_author: str = "User",
    ) -> Optional[Dict[str, Any]]:
        issue_id = issue_id.strip().upper()
        allowed = {
            "title", "description", "type", "status", "priority", "epic_id", "sprint_id",
            "scope", "acceptance_criteria", "criteria_done",
            "links", "remote_links", "commit_links", "session_summaries",
            "flagged_reason", "flagged_options", "progress", "checkins",
            "tags", "assignee", "pinned", "weight", "checklist", "handoff", "risk",
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                return None
            issue = records[idx]
            changes: List[str] = []
            now = self._now()
            for field, val in updates.items():
                if field == "status":
                    val = val.strip().upper()
                    if val not in self._VALID_STATUSES:
                        continue
                if field in allowed:
                    issue[field] = val
                    changes.append(field)
            if changes:
                issue["updated_at"] = now
            if comment and comment.strip():
                issue.setdefault("comments", []).append({
                    "id": self._ms_id(),
                    "issue_id": issue_id,
                    "author": comment_author,
                    "body": comment.strip(),
                    "created_at": now,
                })
                changes.append("added comment")
            if changes:
                records[idx] = issue
                self._rewrite(self.issues_path, records)
        if changes:
            self.log_activity("Update Issue", f"Updated {issue_id}: {', '.join(changes)}")
            self.emit_event("issue_updated", {"id": issue_id, "changes": changes})
        return dict(issue)

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
        result = []
        for r in self._read_jsonl(self.issues_path):
            if status and r.get("status", "").lower() != status.strip().lower():
                continue
            if sprint_id:
                sid = (r.get("sprint_id") or "").strip()
                if sprint_id.strip().lower() == "backlog":
                    if sid:
                        continue
                elif sid.lower() != sprint_id.strip().lower():
                    continue
            if issue_type and r.get("type", "").lower() != issue_type.strip().lower():
                continue
            if priority and r.get("priority", "").lower() != priority.strip().lower():
                continue
            if query:
                q = query.strip().lower()
                if not any(q in (r.get(f) or "").lower() for f in ("id", "title", "description")):
                    continue
            result.append(dict(r))
        result.sort(key=lambda r: int(r["id"].rsplit("-", 1)[-1]))
        return result

    # ── Sprints ───────────────────────────────────────────────────────────────

    def create_sprint(
        self,
        name: str,
        goal: str = "",
        duration_days: int = 7,
        epic_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        with self._lock, self._exclusive(self.config_path):
            now = self._now()
            config = self._read_config()
            sprints: List[Dict[str, Any]] = config.get("sprints", [])
            sprint_id = f"sprint-{len(sprints) + 1}"
            sprint: Dict[str, Any] = {
                "id": sprint_id,
                "name": name.strip(),
                "goal": goal.strip(),
                "status": "PLANNING",
                "duration_days": max(1, int(duration_days)),
                "epic_ids": [e.strip().upper() for e in (epic_ids or [])],
                "created_at": now,
                "started_at": None,
                "end_date": None,
                "completed_at": None,
            }
            sprints.append(sprint)
            config["sprints"] = sprints
            self._write_config(config)
        self.log_activity("Create Sprint", f"Created {sprint_id}: {name}")
        self.emit_event("sprint_created", {"id": sprint_id, "name": name})
        return dict(sprint)

    def start_sprint(self, sprint_id: str) -> Dict[str, Any]:
        from datetime import timedelta
        sprint_id = sprint_id.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            sprints: List[Dict[str, Any]] = config.get("sprints", [])
            active = next((s for s in sprints if s.get("status") == "ACTIVE"), None)
            if active and active["id"] != sprint_id:
                raise ValueError(f"Cannot start sprint. Sprint {active['id']} is already ACTIVE.")
            target = next((s for s in sprints if s["id"] == sprint_id), None)
            if not target:
                raise ValueError(f"Sprint {sprint_id} not found.")
            now = datetime.now(timezone.utc)
            duration = int(target.get("duration_days", 7))
            end_dt = now + timedelta(days=duration)
            target["status"] = "ACTIVE"
            target["started_at"] = now.isoformat()
            target["end_date"] = end_dt.isoformat()
            config["active_sprint_id"] = sprint_id
            self._write_config(config)
        self.log_activity("Start Sprint", f"Started {sprint_id} (ends {end_dt.date()})")
        self.emit_event("sprint_started", {"id": sprint_id, "end_date": end_dt.isoformat()})
        return dict(target)

    def complete_sprint(self, sprint_id: str) -> Dict[str, Any]:
        sprint_id = sprint_id.strip()
        # Acquire both locks in fixed order (config → issues) to prevent deadlock
        with self._lock, self._exclusive(self.config_path), self._exclusive(self.issues_path):
            config = self._read_config()
            sprints: List[Dict[str, Any]] = config.get("sprints", [])
            target = next((s for s in sprints if s["id"] == sprint_id), None)
            if not target:
                raise ValueError(f"Sprint {sprint_id} not found.")
            now = self._now()
            target["status"] = "CLOSED"
            target["completed_at"] = now
            if config.get("active_sprint_id") == sprint_id:
                config["active_sprint_id"] = None

            records = self._read_jsonl(self.issues_path)
            rollover = 0
            for issue in records:
                if (issue.get("sprint_id") or "").lower() == sprint_id.lower():
                    if issue.get("status", "").upper() != "DONE":
                        issue["sprint_id"] = None
                        issue["updated_at"] = now
                        issue.setdefault("comments", []).append({
                            "id": self._ms_id(),
                            "issue_id": issue["id"],
                            "author": "PM Dashboard",
                            "body": "Sprint completed; rolled back to backlog.",
                            "created_at": now,
                        })
                        rollover += 1
            self._rewrite(self.issues_path, records)
            self._write_config(config)
        self.log_activity("Complete Sprint", f"Completed {sprint_id}. Rolled over {rollover} tickets.")
        self.emit_event("sprint_completed", {"id": sprint_id, "rollover": rollover})
        return dict(target)

    def list_sprints(self) -> List[Dict[str, Any]]:
        return [dict(s) for s in self._read_config().get("sprints", [])]

    def get_active_sprint_id(self) -> Optional[str]:
        return self._read_config().get("active_sprint_id")

    # ── Documentation ─────────────────────────────────────────────────────────

    _VALID_DOC_TYPES = frozenset({"wiki", "adr", "runbook", "learning", "plan", "brief"})
    _VALID_DOC_STATUSES = frozenset({"", "proposed", "accepted", "deprecated", "superseded"})

    def create_doc(
        self,
        title: str,
        content: str = "",
        parent_id: Optional[str] = None,
        doc_type: str = "wiki",
        doc_status: str = "",
        superseded_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        dt = doc_type.lower() if doc_type.lower() in self._VALID_DOC_TYPES else "wiki"
        ds = doc_status.lower() if doc_status.lower() in self._VALID_DOC_STATUSES else ""
        with self._lock, self._exclusive(self.config_path), self._exclusive(self.docs_path):
            now = self._now()
            config = self._read_config()
            doc_id = self._next_doc_id(config)
            doc: Dict[str, Any] = {
                "id": doc_id,
                "title": title.strip(),
                "content": content,
                "parent_id": parent_id.strip().upper() if parent_id else None,
                "doc_type": dt,
                "doc_status": ds,
                "superseded_by": superseded_by.strip().upper() if superseded_by else None,
                "created_at": now,
                "updated_at": now,
            }
            records = self._read_jsonl(self.docs_path)
            records.append(doc)
            self._rewrite(self.docs_path, records)
            self._write_config(config)
        self.log_activity("Create Document", f"Created {doc_id} [{dt}]: {title}")
        self.emit_event("doc_created", {"id": doc_id, "title": title, "doc_type": dt})
        return dict(doc)

    def get_doc(self, doc_id: str) -> Optional[Dict[str, Any]]:
        upper = doc_id.strip().upper()
        for r in self._read_jsonl(self.docs_path):
            if r.get("id", "").upper() == upper:
                return dict(r)
        return None

    def update_doc(self, doc_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        doc_id = doc_id.strip().upper()
        allowed = {"title", "content", "parent_id", "doc_type", "doc_status", "superseded_by"}
        updated_doc: Optional[Dict[str, Any]] = None
        with self._lock, self._exclusive(self.docs_path):
            records = self._read_jsonl(self.docs_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == doc_id), None)
            if idx is None:
                return None
            doc = records[idx]
            changes: List[str] = []
            needs_snapshot = any(
                field in ("content", "title") and field in allowed
                for field in updates
            )
            # Snapshot the OLD state before any mutations
            if needs_snapshot:
                self._snapshot_doc_version(dict(doc))
            for field, val in updates.items():
                if field in allowed:
                    doc[field] = val
                    changes.append(field)
            if changes:
                doc["updated_at"] = self._now()
                records[idx] = doc
                self._rewrite(self.docs_path, records)
                updated_doc = dict(doc)
        if changes:
            self.log_activity("Update Document", f"Updated {doc_id}: {', '.join(changes)}")
            self.emit_event("doc_updated", {"id": doc_id, "changes": changes})
        return updated_doc

    def _snapshot_doc_version(self, doc: Dict[str, Any]) -> None:
        """Append a version snapshot to doc_versions.jsonl."""
        try:
            existing = self._read_doc_versions(doc["id"])
            version_num = len(existing) + 1
            snapshot = {
                "doc_id": doc["id"],
                "version": version_num,
                "saved_at": self._now(),
                "title": doc.get("title", ""),
                "content": doc.get("content", ""),
            }
            self.doc_versions_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.doc_versions_path, "a", encoding="utf-8") as f:
                if _HAS_FCNTL:
                    _fcntl.flock(f, _fcntl.LOCK_EX)
                f.write(json.dumps(snapshot, ensure_ascii=False) + "\n")
        except Exception:
            pass

    def _read_doc_versions(self, doc_id: str) -> List[Dict[str, Any]]:
        if not self.doc_versions_path.exists():
            return []
        try:
            result = []
            for line in self.doc_versions_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    record = json.loads(line)
                    if record.get("doc_id", "").upper() == doc_id.strip().upper():
                        result.append(record)
                except json.JSONDecodeError:
                    pass
            return result
        except OSError:
            return []

    def list_doc_versions(self, doc_id: str) -> List[Dict[str, Any]]:
        versions = self._read_doc_versions(doc_id)
        return [
            {
                "version": v["version"],
                "saved_at": v["saved_at"],
                "title": v["title"],
                "content_length": len(v.get("content", "")),
            }
            for v in versions
        ]

    def get_doc_version(self, doc_id: str, n: int) -> Optional[Dict[str, Any]]:
        versions = self._read_doc_versions(doc_id)
        for v in versions:
            if v["version"] == n:
                return v
        return None

    def list_docs(
        self,
        query: Optional[str] = None,
        doc_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        if not self.is_initialized():
            return []
        result = []
        for r in self._read_jsonl(self.docs_path):
            if doc_type and r.get("doc_type", "").lower() != doc_type.strip().lower():
                continue
            if query:
                q = query.strip().lower()
                if not any(q in (r.get(f) or "").lower() for f in ("id", "title", "content")):
                    continue
            result.append(dict(r))
        result.sort(key=lambda r: int(r["id"].split("-", 1)[-1]))
        return result

    # ── Doc comments (embedded in doc record) ─────────────────────────────────

    def list_doc_comments(self, doc_id: str) -> List[Dict[str, Any]]:
        doc = self.get_doc(doc_id)
        if doc is None:
            return []
        return doc.get("comments", [])

    def add_doc_comment(self, doc_id: str, body: str, author: str = "User") -> Dict[str, Any]:
        doc_id = doc_id.strip().upper()
        now = self._now()
        comment: Dict[str, Any] = {
            "id": self._ms_id(),
            "doc_id": doc_id,
            "author": author,
            "body": body.strip(),
            "created_at": now,
        }
        with self._lock, self._exclusive(self.docs_path):
            records = self._read_jsonl(self.docs_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == doc_id), None)
            if idx is None:
                raise ValueError(f"Document {doc_id} not found.")
            records[idx].setdefault("comments", []).append(comment)
            self._rewrite(self.docs_path, records)
        return comment

    # ── Doc linked issues ──────────────────────────────────────────────────────

    def link_doc_issue(self, doc_id: str, issue_id: str) -> List[str]:
        doc_id = doc_id.strip().upper()
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.docs_path):
            records = self._read_jsonl(self.docs_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == doc_id), None)
            if idx is None:
                raise ValueError(f"Document {doc_id} not found.")
            linked = records[idx].get("linked_issues", [])
            if issue_id not in linked:
                linked.append(issue_id)
            records[idx]["linked_issues"] = linked
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.docs_path, records)
        return linked

    def unlink_doc_issue(self, doc_id: str, issue_id: str) -> List[str]:
        doc_id = doc_id.strip().upper()
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.docs_path):
            records = self._read_jsonl(self.docs_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == doc_id), None)
            if idx is None:
                raise ValueError(f"Document {doc_id} not found.")
            linked = [i for i in records[idx].get("linked_issues", []) if i != issue_id]
            records[idx]["linked_issues"] = linked
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.docs_path, records)
        return linked

    def docs_linked_to_issue(self, issue_id: str) -> List[Dict[str, Any]]:
        issue_id = issue_id.strip().upper()
        result = []
        for r in self._read_jsonl(self.docs_path):
            if issue_id in r.get("linked_issues", []):
                result.append(dict(r))
        return result

    # ── SQLite → JSONL migration ──────────────────────────────────────────────

    def migrate_from_sqlite(self, db_path: Path) -> Dict[str, Any]:
        """Read an existing pm.db and write its data into JSONL files.

        Does not delete the SQLite database — the caller can remove it.
        Returns a summary of migrated record counts.
        """
        from pm_backend_sqlite import SQLiteBackend  # local import to avoid circular dep
        src = SQLiteBackend(db_path.parent)
        if not src.is_initialized():
            return {"ok": False, "error": "Source SQLite database is not initialized."}

        src_config = src.get_project_config()

        # Init target workspace with same project identity
        self.init_workspace(
            project_name=src_config["project_name"],
            key_prefix=src_config["key_prefix"],
        )

        with self._lock, self._exclusive(self.config_path), \
             self._exclusive(self.issues_path), self._exclusive(self.docs_path):

            # ── Config / counters ──
            config = self._read_config()
            config["next_issue_id"] = src_config.get("next_issue_id", 1)
            config["next_doc_id"] = src_config.get("next_doc_id", 1)
            config["active_sprint_id"] = src_config.get("active_sprint_id")
            config["created_at"] = src_config.get("created_at", self._now())
            config["activity_log"] = src_config.get("activity_log", [])

            # ── Sprints ──
            sprints = src.list_sprints()
            config["sprints"] = sprints

            # ── Issues (comments embedded) ──
            issues = src.list_issues()
            self._rewrite(self.issues_path, issues)

            # ── Docs ──
            docs = src.list_docs()
            self._rewrite(self.docs_path, docs)

            self._write_config(config)

        return {
            "ok": True,
            "issues": len(issues),
            "docs": len(docs),
            "sprints": len(sprints),
        }

    # ── New methods (v0.6.0) ──────────────────────────────────────────────────

    def create_issues_bulk(self, issues_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Create multiple issues atomically. Returns list of created issue dicts."""
        created: List[Dict[str, Any]] = []
        valid_scopes = {"nano", "small", "medium", "large", "research"}
        with self._lock, self._exclusive(self.config_path), self._exclusive(self.issues_path):
            now = self._now()
            config = self._read_config()
            records = self._read_jsonl(self.issues_path)
            for item in issues_list:
                scope_raw = (item.get("scope") or "").strip().lower()
                issue_id = self._next_issue_id(config)
                issue: Dict[str, Any] = {
                    "id": issue_id,
                    "title": (item.get("title") or "Untitled").strip(),
                    "description": (item.get("description") or "").strip(),
                    "type": (item.get("issue_type") or "task").strip().lower(),
                    "status": "TODO",
                    "priority": (item.get("priority") or "medium").strip().lower(),
                    "scope": scope_raw if scope_raw in valid_scopes else None,
                    "epic_id": item["epic_id"].strip().upper() if item.get("epic_id") else None,
                    "sprint_id": item["sprint_id"].strip() if item.get("sprint_id") else None,
                    "acceptance_criteria": list(item.get("acceptance_criteria") or []),
                    "criteria_done": [],
                    "links": [],
                    "remote_links": [],
                    "commit_links": [],
                    "session_summaries": [],
                    "flagged_reason": None,
                    "flagged_options": [],
                    "progress": 0,
                    "checkins": [],
                    "created_at": now,
                    "updated_at": now,
                    "comments": [],
                    "tags": [],
                    "assignee": None,
                    "pinned": False,
                    "weight": 50,
                    "reopen_count": 0,
                    "checklist": [],
                    "handoff": None,
                    "risk": None,
                }
                records.append(issue)
                created.append(dict(issue))
            self._rewrite(self.issues_path, records)
            self._write_config(config)
        for issue in created:
            self.log_activity("Create Issue", f"Bulk-created {issue['id']}: {issue['title']}")
            self.emit_event("issue_created", {"id": issue["id"], "title": issue["title"]})
        return created

    def clone_issue(self, issue_id: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Clone an issue, creating a new one with the same core fields. Returns the new issue."""
        src = self.get_issue(issue_id)
        if src is None:
            raise ValueError(f"Issue {issue_id} not found.")
        overrides = overrides or {}
        new_title = overrides.get("title", f"[Clone] {src['title']}")
        new_description = overrides.get("description", src.get("description", ""))
        clone = self.create_issue(
            title=new_title,
            description=new_description + f"\n\n[Cloned from {src['id']}]",
            issue_type=overrides.get("issue_type", src.get("type", "task")),
            priority=overrides.get("priority", src.get("priority", "medium")),
            epic_id=overrides.get("epic_id", src.get("epic_id")),
            sprint_id=overrides.get("sprint_id", src.get("sprint_id")),
            scope=overrides.get("scope", src.get("scope")),
            acceptance_criteria=list(src.get("acceptance_criteria") or []),
        )
        return clone

    def attach_session(
        self,
        issue_id: str,
        summary: str,
        files_changed: Optional[List[str]] = None,
        tests_added: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Attach a Claude session summary to an issue. Returns updated issue."""
        issue_id = issue_id.strip().upper()
        entry: Dict[str, Any] = {
            "summary": summary.strip(),
            "files_changed": list(files_changed or []),
            "tests_added": list(tests_added or []),
            "created_at": self._now(),
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx].setdefault("session_summaries", []).append(entry)
            records[idx].setdefault("comments", []).append({
                "id": self._ms_id(),
                "issue_id": issue_id,
                "author": "claude-session",
                "body": f"**Session Summary**\n\n{summary.strip()}"
                        + (f"\n\n**Files changed:** {', '.join(files_changed)}" if files_changed else "")
                        + (f"\n\n**Tests added:** {', '.join(tests_added)}" if tests_added else ""),
                "created_at": self._now(),
            })
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_session_attached", {"id": issue_id})
        return dict(records[idx])  # type: ignore[index]

    def flag_issue(self, issue_id: str, reason: str, options: Optional[List[str]] = None) -> Dict[str, Any]:
        """Set an issue to NEEDS_INPUT with a reason and optional choice options."""
        issue_id = issue_id.strip().upper()
        now = self._now()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["status"] = "NEEDS_INPUT"
            records[idx]["flagged_reason"] = reason.strip()
            records[idx]["flagged_options"] = list(options or [])
            records[idx]["updated_at"] = now
            records[idx].setdefault("comments", []).append({
                "id": self._ms_id(),
                "issue_id": issue_id,
                "author": "claude-session",
                "body": f"**Flagged — needs human input**\n\n{reason.strip()}"
                        + (f"\n\n**Options:** " + " | ".join(f"[{o}]" for o in (options or [])) if options else ""),
                "created_at": now,
            })
            self._rewrite(self.issues_path, records)
        self.log_activity("Flag Issue", f"Flagged {issue_id}: {reason[:60]}")
        self.emit_event("issue_flagged", {"id": issue_id, "reason": reason})
        return dict(records[idx])  # type: ignore[index]

    def link_commit(self, issue_id: str, sha: str, message: str = "", url: str = "") -> Dict[str, Any]:
        """Attach a git commit reference to an issue."""
        issue_id = issue_id.strip().upper()
        entry: Dict[str, Any] = {
            "sha": sha.strip()[:40],
            "short_sha": sha.strip()[:7],
            "message": message.strip(),
            "url": url.strip(),
            "created_at": self._now(),
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx].setdefault("commit_links", []).append(entry)
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_commit_linked", {"id": issue_id, "sha": entry["short_sha"]})
        return entry

    def add_issue_link(self, from_id: str, to_id: str, link_type: str) -> Dict[str, Any]:
        """Add a structured link from one issue to another."""
        from_id = from_id.strip().upper()
        to_id = to_id.strip().upper()
        entry = {"from_id": from_id, "to_id": to_id, "type": link_type, "created_at": self._now()}
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == from_id), None)
            if idx is None:
                raise ValueError(f"Issue {from_id} not found.")
            existing = records[idx].get("links", [])
            if not any(l["to_id"] == to_id and l["type"] == link_type for l in existing):
                existing.append(entry)
                records[idx]["links"] = existing
                records[idx]["updated_at"] = self._now()
                self._rewrite(self.issues_path, records)
        return entry

    def add_remote_link(self, issue_id: str, url: str, title: str = "") -> Dict[str, Any]:
        """Add a structured remote link to an issue, and auto-transition to REVIEW if PR URL."""
        import re
        issue_id = issue_id.strip().upper()
        entry = {"url": url.strip(), "title": (title.strip() or url.strip()), "created_at": self._now()}
        auto_transitioned = False
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            existing = records[idx].get("remote_links", [])
            if not any(l["url"] == url for l in existing):
                existing.append(entry)
                records[idx]["remote_links"] = existing
                records[idx]["updated_at"] = self._now()
                # Auto-REVIEW transition: PR URL + currently IN_PROGRESS
                if (re.search(r"/pull/\d+", url)
                        and records[idx].get("status", "").upper() == "IN_PROGRESS"):
                    records[idx]["status"] = "REVIEW"
                    records[idx].setdefault("comments", []).append({
                        "id": self._ms_id(),
                        "issue_id": issue_id,
                        "author": "PM Dashboard",
                        "body": f"Auto-moved to REVIEW — PR linked: {url}",
                        "created_at": self._now(),
                    })
                    auto_transitioned = True
                self._rewrite(self.issues_path, records)
        self.emit_event("issue_remote_link_added", {"id": issue_id, "url": url})
        if auto_transitioned:
            self.emit_event("issue_updated", {"id": issue_id, "changes": ["status", "remote_links"]})
        return {**entry, "auto_transitioned_to_review": auto_transitioned}

    def workspace_health(self) -> Dict[str, Any]:
        """Return a health report: stale tickets, epics without children, ADRs in proposed, etc."""
        from datetime import timedelta
        if not self.is_initialized():
            return {"ok": False, "error": "Workspace not initialized."}
        now = datetime.now(timezone.utc)
        stale_cutoff = now - timedelta(days=3)
        proposed_cutoff = now - timedelta(days=7)

        issues = self._read_jsonl(self.issues_path)
        docs = self._read_jsonl(self.docs_path)

        stale: List[Dict[str, Any]] = []
        no_description: List[str] = []
        epic_ids_with_children: set = set()

        for issue in issues:
            if issue.get("type") == "epic" and issue.get("epic_id"):
                epic_ids_with_children.add(issue["epic_id"])
            if issue.get("status", "").upper() == "IN_PROGRESS":
                try:
                    updated = datetime.fromisoformat(issue.get("updated_at", "").replace("Z", "+00:00"))
                    if updated < stale_cutoff:
                        stale.append({"id": issue["id"], "title": issue["title"],
                                      "updated_at": issue["updated_at"]})
                except Exception:
                    pass
            if not (issue.get("description") or "").strip():
                no_description.append(issue["id"])

        childless_epics = [
            {"id": i["id"], "title": i["title"]}
            for i in issues
            if i.get("type") == "epic" and i["id"] not in epic_ids_with_children
        ]

        proposed_adrs: List[Dict[str, Any]] = []
        for doc in docs:
            if doc.get("doc_type") == "adr" and doc.get("doc_status") == "proposed":
                try:
                    created = datetime.fromisoformat(doc.get("created_at", "").replace("Z", "+00:00"))
                    if created < proposed_cutoff:
                        proposed_adrs.append({"id": doc["id"], "title": doc["title"],
                                              "created_at": doc["created_at"]})
                except Exception:
                    pass

        return {
            "ok": True,
            "stale_in_progress": stale,
            "no_description": no_description,
            "childless_epics": childless_epics,
            "proposed_adrs_older_than_7d": proposed_adrs,
            "summary": {
                "stale_count": len(stale),
                "no_description_count": len(no_description),
                "childless_epic_count": len(childless_epics),
                "proposed_adr_count": len(proposed_adrs),
            },
        }

    # ── v0.7.0 new methods ────────────────────────────────────────────────────

    # ── Templates ─────────────────────────────────────────────────────────────

    def create_template(
        self,
        name: str,
        fields: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Save a ticket template to config.json under 'templates'."""
        name = name.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            templates: List[Dict[str, Any]] = config.get("templates", [])
            existing = next((t for t in templates if t["name"] == name), None)
            entry: Dict[str, Any] = {
                "name": name,
                "fields": fields,
                "created_at": self._now(),
            }
            if existing:
                templates[templates.index(existing)] = entry
            else:
                templates.append(entry)
            config["templates"] = templates
            self._write_config(config)
        return entry

    def list_templates(self) -> List[Dict[str, Any]]:
        return list(self._read_config().get("templates", []))

    def apply_template(self, name: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Create an issue from a named template, with optional field overrides."""
        templates = self.list_templates()
        tmpl = next((t for t in templates if t["name"] == name), None)
        if tmpl is None:
            raise ValueError(f"Template '{name}' not found.")
        fields = dict(tmpl["fields"])
        fields.update(overrides or {})
        return self.create_issue(
            title=fields.get("title", f"[{name}]"),
            description=fields.get("description", ""),
            issue_type=fields.get("issue_type", "task"),
            priority=fields.get("priority", "medium"),
            epic_id=fields.get("epic_id"),
            sprint_id=fields.get("sprint_id"),
            scope=fields.get("scope"),
            acceptance_criteria=fields.get("acceptance_criteria"),
        )

    def delete_template(self, name: str) -> bool:
        name = name.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            templates = [t for t in config.get("templates", []) if t["name"] != name]
            removed = len(config.get("templates", [])) > len(templates)
            config["templates"] = templates
            self._write_config(config)
        return removed

    # ── Saved filters ──────────────────────────────────────────────────────────

    def create_filter(self, name: str, criteria: Dict[str, Any]) -> Dict[str, Any]:
        """Save a named issue filter to config.json."""
        name = name.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            filters: List[Dict[str, Any]] = config.get("filters", [])
            existing = next((f for f in filters if f["name"] == name), None)
            entry: Dict[str, Any] = {"name": name, "criteria": criteria, "created_at": self._now()}
            if existing:
                filters[filters.index(existing)] = entry
            else:
                if len(filters) >= 8:
                    filters.pop(0)  # evict oldest when at cap
                filters.append(entry)
            config["filters"] = filters
            self._write_config(config)
        return entry

    def list_filters(self) -> List[Dict[str, Any]]:
        return list(self._read_config().get("filters", []))

    def delete_filter(self, name: str) -> bool:
        name = name.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            filters = [f for f in config.get("filters", []) if f["name"] != name]
            removed = len(config.get("filters", [])) > len(filters)
            config["filters"] = filters
            self._write_config(config)
        return removed

    # ── CI watchers ───────────────────────────────────────────────────────────

    def add_ci_watcher(self, issue_id: str, pr_url: str) -> Dict[str, Any]:
        """Register a CI watcher for a ticket → PR URL pair."""
        issue_id = issue_id.strip().upper()
        entry: Dict[str, Any] = {
            "issue_id": issue_id,
            "pr_url": pr_url.strip(),
            "added_at": self._now(),
            "last_checked": None,
            "last_status": None,
        }
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            watchers: List[Dict[str, Any]] = config.get("ci_watchers", [])
            watchers = [w for w in watchers if not (w["issue_id"] == issue_id and w["pr_url"] == entry["pr_url"])]
            watchers.append(entry)
            config["ci_watchers"] = watchers
            self._write_config(config)
        return entry

    def remove_ci_watcher(self, issue_id: str) -> bool:
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            watchers = [w for w in config.get("ci_watchers", []) if w["issue_id"] != issue_id]
            removed = len(config.get("ci_watchers", [])) > len(watchers)
            config["ci_watchers"] = watchers
            self._write_config(config)
        return removed

    def list_ci_watchers(self) -> List[Dict[str, Any]]:
        return list(self._read_config().get("ci_watchers", []))

    def update_ci_watcher(self, issue_id: str, updates: Dict[str, Any]) -> None:
        """Update last_checked / last_status on a watcher entry."""
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            for w in config.get("ci_watchers", []):
                if w["issue_id"] == issue_id:
                    w.update(updates)
                    break
            self._write_config(config)

    # ── Issue checkin ─────────────────────────────────────────────────────────

    def checkin_issue(
        self,
        issue_id: str,
        progress_pct: int,
        what_done: str,
        what_remains: str = "",
    ) -> Dict[str, Any]:
        """Record a mid-session progress checkpoint on an issue."""
        issue_id = issue_id.strip().upper()
        pct = max(0, min(100, int(progress_pct)))
        entry: Dict[str, Any] = {
            "progress": pct,
            "what_done": what_done.strip(),
            "what_remains": what_remains.strip(),
            "created_at": self._now(),
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx].setdefault("checkins", []).append(entry)
            records[idx]["progress"] = pct
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_checkin", {"id": issue_id, "progress": pct, "what_done": what_done.strip()})
        return entry

    # ── Issue split ───────────────────────────────────────────────────────────

    def split_issue(self, issue_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Split a ticket into N smaller ones.

        parts: [{"title": str, "criteria_indices": [int], ...overrides}]
        Returns: {"original_closed": issue, "children": [issue, ...]}
        """
        issue_id = issue_id.strip().upper()
        src = self.get_issue(issue_id)
        if src is None:
            raise ValueError(f"Issue {issue_id} not found.")
        all_criteria: List[str] = src.get("acceptance_criteria") or []
        children: List[Dict[str, Any]] = []
        child_ids: List[str] = []

        for part in parts:
            indices = part.get("criteria_indices", [])
            criteria_slice = [all_criteria[i] for i in indices if 0 <= i < len(all_criteria)]
            child = self.create_issue(
                title=part.get("title", f"[Split] {src['title']}"),
                description=part.get("description", src.get("description", "")),
                issue_type=part.get("issue_type", src.get("type", "task")),
                priority=part.get("priority", src.get("priority", "medium")),
                epic_id=part.get("epic_id", src.get("epic_id")),
                sprint_id=part.get("sprint_id", src.get("sprint_id")),
                scope=part.get("scope", src.get("scope")),
                acceptance_criteria=criteria_slice,
            )
            children.append(child)
            child_ids.append(child["id"])

        closed = self.update_issue(
            issue_id,
            updates={"status": "DONE"},
            comment=f"Split into: {', '.join(child_ids)}. Original ticket closed.",
        )
        self.emit_event("issue_split", {"id": issue_id, "children": child_ids})
        return {"original_closed": closed, "children": children}

    # ── v0.9.0 new methods ────────────────────────────────────────────────────

    def take_snapshot(self, issue_id: str, label: str = "") -> Dict[str, Any]:
        """Capture a full point-in-time snapshot of an issue's state."""
        issue_id = issue_id.strip().upper()
        issue = self.get_issue(issue_id)
        if issue is None:
            raise ValueError(f"Issue {issue_id} not found.")
        self.snapshots_path.mkdir(parents=True, exist_ok=True)
        now = self._now()
        snapshot_id = f"{issue_id}-{int(time.time())}"
        snapshot: Dict[str, Any] = {
            "snapshot_id": snapshot_id,
            "issue_id": issue_id,
            "label": label.strip(),
            "created_at": now,
            "state": dict(issue),
        }
        snap_file = self.snapshots_path / f"{snapshot_id}.json"
        snap_file.write_text(json.dumps(snapshot, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"snapshot_id": snapshot_id, "issue_id": issue_id, "label": label.strip(), "created_at": now}

    def list_snapshots(self, issue_id: str) -> List[Dict[str, Any]]:
        """List all snapshots for an issue, newest first."""
        issue_id = issue_id.strip().upper()
        if not self.snapshots_path.exists():
            return []
        result: List[Dict[str, Any]] = []
        for snap_file in self.snapshots_path.glob(f"{issue_id}-*.json"):
            try:
                data = json.loads(snap_file.read_text(encoding="utf-8"))
                result.append({"snapshot_id": data["snapshot_id"], "label": data.get("label", ""),
                               "created_at": data["created_at"]})
            except Exception:
                pass
        result.sort(key=lambda x: x["created_at"], reverse=True)
        return result

    def restore_snapshot(self, issue_id: str, snapshot_id: str) -> Dict[str, Any]:
        """Restore an issue to a snapshot state (all fields except id)."""
        issue_id = issue_id.strip().upper()
        snap_file = self.snapshots_path / f"{snapshot_id}.json"
        if not snap_file.exists():
            raise ValueError(f"Snapshot {snapshot_id} not found.")
        data = json.loads(snap_file.read_text(encoding="utf-8"))
        state = data["state"]
        state.pop("id", None)
        state["updated_at"] = self._now()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx].update(state)
            self._rewrite(self.issues_path, records)
        self.log_activity("Restore Snapshot", f"Restored {issue_id} to snapshot {snapshot_id}")
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["snapshot_restore"]})
        return dict(records[idx])

    def set_board_sort(self, column: str, mode: str) -> Dict[str, str]:
        """Persist a column sort preference. mode: creation|priority|weight|updated|scope|sessions"""
        valid_modes = {"creation", "priority", "weight", "updated", "scope", "sessions"}
        column = column.strip().upper()
        mode = mode.strip().lower()
        if mode not in valid_modes:
            mode = "creation"
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            config.setdefault("board_sort", {})[column] = mode
            self._write_config(config)
        return dict(config["board_sort"])

    def get_board_sort(self) -> Dict[str, str]:
        """Return per-column sort preferences."""
        return dict(self._read_config().get("board_sort", {}))

    # ── Thread summarize ──────────────────────────────────────────────────────

    def summarize_thread(self, issue_id: str) -> Dict[str, Any]:
        """Compress an issue's comment history into a single summary comment."""
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            issue = records[idx]
            comments: List[Dict[str, Any]] = issue.get("comments", [])
            if len(comments) < 3:
                return {"ok": True, "compressed": False, "reason": "Not enough comments to compress."}
            # Keep the most recent 2 comments, archive the rest
            archived = comments[:-2]
            kept = comments[-2:]
            archive_text = "\n\n".join(
                f"**{c.get('author', 'Unknown')} ({c.get('created_at', '')[:10]}):** {c.get('body', '')[:200]}"
                for c in archived
            )
            summary_comment: Dict[str, Any] = {
                "id": self._ms_id(),
                "issue_id": issue_id,
                "author": "PM Dashboard",
                "body": f"**Thread compressed** — {len(archived)} older comments archived.\n\n{archive_text[:1500]}",
                "created_at": self._now(),
                "is_thread_summary": True,
            }
            issue["comments"] = [summary_comment] + kept
            issue.setdefault("session_summaries", [])
            issue["updated_at"] = self._now()
            records[idx] = issue
            self._rewrite(self.issues_path, records)
        return {"ok": True, "compressed": True, "archived_count": len(archived), "kept_count": len(kept)}

    # ── v0.8.0 new methods ────────────────────────────────────────────────────

    def assign_issue(self, issue_id: str, assignee: Optional[str]) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["assignee"] = assignee.strip() if assignee else None
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["assignee"]})
        return dict(records[idx])

    def pin_issue(self, issue_id: str, pinned: bool = True) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["pinned"] = bool(pinned)
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["pinned"]})
        return dict(records[idx])

    def set_issue_weight(self, issue_id: str, weight: int) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["weight"] = max(0, int(weight))
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        return dict(records[idx])

    def reopen_issue(self, issue_id: str, reason: str, reporter: str = "User") -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        now = self._now()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            issue = records[idx]
            issue["status"] = "TODO"
            issue["reopen_count"] = issue.get("reopen_count", 0) + 1
            issue["updated_at"] = now
            issue["flagged_reason"] = None
            issue["flagged_options"] = []
            issue.setdefault("comments", []).append({
                "id": self._ms_id(),
                "issue_id": issue_id,
                "author": reporter,
                "body": f"**Reopened** (#{issue['reopen_count']}): {reason.strip()}",
                "created_at": now,
            })
            records[idx] = issue
            self._rewrite(self.issues_path, records)
        self.log_activity("Reopen Issue", f"Reopened {issue_id} (#{records[idx]['reopen_count']}): {reason[:60]}")
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["status", "reopen_count"]})
        return dict(records[idx])

    def set_issue_checklist(self, issue_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        now = self._now()
        checklist = [
            {"id": i, "text": item.get("text", "").strip(), "done": bool(item.get("done", False)),
             "done_at": item.get("done_at")}
            for i, item in enumerate(items)
        ]
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["checklist"] = checklist
            records[idx]["updated_at"] = now
            self._rewrite(self.issues_path, records)
        return dict(records[idx])

    def check_checklist_item(self, issue_id: str, item_index: int, done: bool) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        now = self._now()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            checklist = records[idx].get("checklist", [])
            if 0 <= item_index < len(checklist):
                checklist[item_index]["done"] = bool(done)
                checklist[item_index]["done_at"] = now if done else None
                records[idx]["checklist"] = checklist
                records[idx]["updated_at"] = now
                self._rewrite(self.issues_path, records)
        return dict(records[idx])

    def set_session_handoff(
        self, issue_id: str, next_step: str,
        files_in_progress: Optional[List[str]] = None,
        partial_criteria_done: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        handoff = {
            "next_step": next_step.strip(),
            "files_in_progress": list(files_in_progress or []),
            "partial_criteria_done": list(partial_criteria_done or []),
            "created_at": self._now(),
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["handoff"] = handoff
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_handoff", {"id": issue_id})
        return dict(records[idx])

    def abort_session(
        self, issue_id: str, reason: str,
        what_was_attempted: str = "",
        codebase_state: str = "clean",
    ) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        now = self._now()
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["status"] = "TODO"
            records[idx].setdefault("session_summaries", []).append({
                "summary": f"[ABORTED] {reason.strip()}",
                "files_changed": [],
                "tests_added": [],
                "aborted": True,
                "codebase_state": codebase_state,
                "created_at": now,
            })
            records[idx].setdefault("comments", []).append({
                "id": self._ms_id(),
                "issue_id": issue_id,
                "author": "claude-session",
                "body": f"**Session Aborted**\n\n**Reason:** {reason.strip()}\n\n"
                        + (f"**Attempted:** {what_was_attempted.strip()}\n\n" if what_was_attempted else "")
                        + f"**Codebase state:** {codebase_state}",
                "created_at": now,
            })
            records[idx]["updated_at"] = now
            self._rewrite(self.issues_path, records)
        self.log_activity("Abort Session", f"Aborted session on {issue_id}: {reason[:60]}")
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["status"]})
        return dict(records[idx])

    def set_wip_limit(self, column: str, limit: int) -> Dict[str, int]:
        column = column.strip().upper()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            wip = config.get("wip_limits", {})
            if limit <= 0:
                wip.pop(column, None)
            else:
                wip[column] = int(limit)
            config["wip_limits"] = wip
            self._write_config(config)
        return dict(wip)

    def get_wip_limits(self) -> Dict[str, int]:
        return dict(self._read_config().get("wip_limits", {}))

    def create_session_template(
        self, name: str, prompt_prefix: str,
        match_types: Optional[List[str]] = None,
        match_tags: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        name = name.strip()
        entry: Dict[str, Any] = {
            "name": name,
            "prompt_prefix": prompt_prefix.strip(),
            "match_types": list(match_types or []),
            "match_tags": list(match_tags or []),
            "created_at": self._now(),
        }
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            templates: List[Dict[str, Any]] = config.get("session_templates", [])
            templates = [t for t in templates if t["name"] != name]
            templates.append(entry)
            config["session_templates"] = templates
            self._write_config(config)
        return entry

    def list_session_templates(self) -> List[Dict[str, Any]]:
        return list(self._read_config().get("session_templates", []))

    def delete_session_template(self, name: str) -> bool:
        name = name.strip()
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            before = len(config.get("session_templates", []))
            config["session_templates"] = [t for t in config.get("session_templates", []) if t["name"] != name]
            removed = len(config["session_templates"]) < before
            self._write_config(config)
        return removed

    def comment_reply(self, issue_id: str, parent_comment_id: int, body: str, author: str = "User") -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        now = self._now()
        reply = {
            "id": self._ms_id(),
            "issue_id": issue_id,
            "parent_id": parent_comment_id,
            "author": author,
            "body": body.strip(),
            "created_at": now,
        }
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            comments = records[idx].get("comments", [])
            parent_idx = next((ci for ci, c in enumerate(comments) if c.get("id") == parent_comment_id), None)
            if parent_idx is not None:
                comments[parent_idx].setdefault("replies", []).append(reply)
            else:
                comments.append(reply)
            records[idx]["comments"] = comments
            records[idx]["updated_at"] = now
            self._rewrite(self.issues_path, records)
        return reply

    def risk_flag_issue(self, issue_id: str, risk_type: str, reason: str) -> Dict[str, Any]:
        issue_id = issue_id.strip().upper()
        valid_types = {"security", "data_loss", "breaking_change", "external_integration", "compliance"}
        risk_type = risk_type.strip().lower()
        if risk_type not in valid_types:
            risk_type = "security"
        risk = {"type": risk_type, "reason": reason.strip(), "flagged_at": self._now()}
        with self._lock, self._exclusive(self.issues_path):
            records = self._read_jsonl(self.issues_path)
            idx = next((i for i, r in enumerate(records) if r.get("id", "").upper() == issue_id), None)
            if idx is None:
                raise ValueError(f"Issue {issue_id} not found.")
            records[idx]["risk"] = risk
            records[idx]["updated_at"] = self._now()
            self._rewrite(self.issues_path, records)
        self.emit_event("issue_updated", {"id": issue_id, "changes": ["risk"]})
        return dict(records[idx])

    def create_sprint_theme(self, name: str, description: str = "", color: str = "#0052CC") -> Dict[str, Any]:
        name = name.strip()
        entry = {"id": f"theme-{self._ms_id()}", "name": name, "description": description.strip(),
                 "color": color, "created_at": self._now()}
        with self._lock, self._exclusive(self.config_path):
            config = self._read_config()
            themes: List[Dict[str, Any]] = config.get("sprint_themes", [])
            themes = [t for t in themes if t["name"] != name]
            themes.append(entry)
            config["sprint_themes"] = themes
            self._write_config(config)
        return entry

    def list_sprint_themes(self) -> List[Dict[str, Any]]:
        return list(self._read_config().get("sprint_themes", []))

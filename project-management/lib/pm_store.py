"""PMStore — Bridge Abstraction for the project-management plugin.

PMStore is the stable public API consumed by pm_mcp_server.py and tests.
All storage work is delegated to a PMBackend implementor chosen by
_resolve_backend() at construction time.

Swapping backends = change PM_DATABASE_URL. No other code changes.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from pm_backend import PMBackend


def _pm_root(workspace_path: Optional[str]) -> Path:
    """Resolve the .pm/ directory for the given workspace path or CWD.

    Recognises both SQLite workspaces (pm.db) and JSONL workspaces
    (config.json) so either backend can be picked up automatically.
    """
    if workspace_path:
        base = Path(workspace_path).expanduser().resolve()
        return base / ".pm"

    # Walk up from CWD looking for an initialised .pm/ directory
    cwd = Path.cwd().resolve()
    for parent in [cwd] + list(cwd.parents):
        candidate = parent / ".pm"
        if candidate.is_dir() and (
            (candidate / "pm.db").exists()        # SQLite workspace
            or (candidate / "config.json").exists()  # JSONL workspace
        ):
            return candidate

    # Fallback: .pm/ under CWD (will be created on init)
    return cwd / ".pm"


def _resolve_backend(workspace_path: Optional[str]) -> PMBackend:
    """Factory: choose ConcreteImplementor based on environment and workspace.

    Priority:
      1. PM_DATABASE_URL set to a postgres:// URL  → PostgresBackend
      2. pm.db exists in the resolved .pm/ dir     → SQLiteBackend  (backward compat)
      3. Otherwise                                  → JSONLBackend   (default for new workspaces)
    """
    db_url = os.environ.get("PM_DATABASE_URL", "").strip()
    root = _pm_root(workspace_path)

    if db_url.startswith(("postgres://", "postgresql://")):
        from pm_backend_postgres import PostgresBackend
        return PostgresBackend(db_url, root)  # type: ignore[return-value]

    if (root / "pm.db").exists():
        from pm_backend_sqlite import SQLiteBackend
        return SQLiteBackend(root)  # type: ignore[return-value]

    from pm_backend_jsonl import JSONLBackend
    return JSONLBackend(root)  # type: ignore[return-value]


class PMStore:
    """Bridge Abstraction: stable API that delegates all storage to self._backend.

    Callers never import SQLiteBackend or PostgresBackend directly.
    """

    def __init__(self, workspace_path: Optional[str] = None) -> None:
        self._backend: PMBackend = _resolve_backend(workspace_path)

    # --- Lifecycle ---

    def is_initialized(self) -> bool:
        return self._backend.is_initialized()

    def init_workspace(self, project_name: str = "Local Project", key_prefix: str = "PM") -> str:
        return self._backend.init_workspace(project_name, key_prefix)

    # --- Issues ---

    def create_issue(
        self,
        title: str,
        description: str = "",
        issue_type: str = "task",
        priority: str = "medium",
        epic_id: Optional[str] = None,
        sprint_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._backend.create_issue(
            title, description, issue_type, priority,
            epic_id, sprint_id,
        )

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        return self._backend.get_issue(issue_id)

    def update_issue(
        self,
        issue_id: str,
        updates: Dict[str, Any],
        comment: Optional[str] = None,
        comment_author: str = "User",
    ) -> Optional[Dict[str, Any]]:
        return self._backend.update_issue(issue_id, updates, comment, comment_author)

    def list_issues(
        self,
        status: Optional[str] = None,
        sprint_id: Optional[str] = None,
        issue_type: Optional[str] = None,
        priority: Optional[str] = None,
        query: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._backend.list_issues(status, sprint_id, issue_type, priority, query)

    # --- Sprints ---

    def create_sprint(self, name: str, goal: str = "") -> Dict[str, Any]:
        return self._backend.create_sprint(name, goal)

    def start_sprint(self, sprint_id: str) -> Dict[str, Any]:
        return self._backend.start_sprint(sprint_id)

    def complete_sprint(self, sprint_id: str) -> Dict[str, Any]:
        return self._backend.complete_sprint(sprint_id)

    def list_sprints(self) -> List[Dict[str, Any]]:
        return self._backend.list_sprints()

    def get_active_sprint_id(self) -> Optional[str]:
        return self._backend.get_active_sprint_id()

    # --- Documentation ---

    def create_doc(
        self,
        title: str,
        content: str = "",
        parent_id: Optional[str] = None,
        doc_type: str = "wiki",
        doc_status: str = "",
        superseded_by: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self._backend.create_doc(
            title, content, parent_id,
            doc_type=doc_type, doc_status=doc_status, superseded_by=superseded_by,
        )

    def get_doc(self, doc_id: str) -> Optional[Dict[str, Any]]:
        return self._backend.get_doc(doc_id)

    def update_doc(self, doc_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        return self._backend.update_doc(doc_id, updates)

    def list_docs(
        self,
        query: Optional[str] = None,
        doc_type: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self._backend.list_docs(query, doc_type=doc_type)

    # --- Doc comments ---

    def list_doc_comments(self, doc_id: str) -> List[Dict[str, Any]]:
        return self._backend.list_doc_comments(doc_id)

    def add_doc_comment(self, doc_id: str, body: str, author: str = "User") -> Dict[str, Any]:
        return self._backend.add_doc_comment(doc_id, body, author)

    # --- Doc version history ---

    def list_doc_versions(self, doc_id: str) -> List[Dict[str, Any]]:
        return self._backend.list_doc_versions(doc_id)

    def get_doc_version(self, doc_id: str, n: int) -> Optional[Dict[str, Any]]:
        return self._backend.get_doc_version(doc_id, n)

    # --- Doc linked issues ---

    def link_doc_issue(self, doc_id: str, issue_id: str) -> List[str]:
        return self._backend.link_doc_issue(doc_id, issue_id)

    def unlink_doc_issue(self, doc_id: str, issue_id: str) -> List[str]:
        return self._backend.unlink_doc_issue(doc_id, issue_id)

    def docs_linked_to_issue(self, issue_id: str) -> List[Dict[str, Any]]:
        return self._backend.docs_linked_to_issue(issue_id)

    # --- Observability ---

    def get_project_config(self) -> Dict[str, Any]:
        return self._backend.get_project_config()

    def log_activity(self, action: str, details: str = "") -> None:
        self._backend.log_activity(action, details)

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
        scope: Optional[str] = None,
        acceptance_criteria: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        assignee: Optional[str] = None,
        pinned: bool = False,
        weight: int = 50,
    ) -> Dict[str, Any]:
        return self._backend.create_issue(
            title, description, issue_type, priority,
            epic_id, sprint_id, scope, acceptance_criteria,
            tags=tags, assignee=assignee, pinned=pinned, weight=weight,
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

    def create_sprint(
        self,
        name: str,
        goal: str = "",
        duration_days: int = 7,
        epic_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self._backend.create_sprint(name, goal, duration_days, epic_ids)

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

    # --- v0.6.0 new methods ---

    def create_issues_bulk(self, issues_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return self._backend.create_issues_bulk(issues_list)

    def clone_issue(self, issue_id: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._backend.clone_issue(issue_id, overrides)

    def attach_session(
        self,
        issue_id: str,
        summary: str,
        files_changed: Optional[List[str]] = None,
        tests_added: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        return self._backend.attach_session(issue_id, summary, files_changed, tests_added)

    def flag_issue(self, issue_id: str, reason: str, options: Optional[List[str]] = None) -> Dict[str, Any]:
        return self._backend.flag_issue(issue_id, reason, options)

    def link_commit(self, issue_id: str, sha: str, message: str = "", url: str = "") -> Dict[str, Any]:
        return self._backend.link_commit(issue_id, sha, message, url)

    def add_issue_link(self, from_id: str, to_id: str, link_type: str) -> Dict[str, Any]:
        return self._backend.add_issue_link(from_id, to_id, link_type)

    def add_remote_link(self, issue_id: str, url: str, title: str = "") -> Dict[str, Any]:
        return self._backend.add_remote_link(issue_id, url, title)

    def workspace_health(self) -> Dict[str, Any]:
        return self._backend.workspace_health()

    # --- v0.7.0 new methods ---

    def create_template(self, name: str, fields: Dict[str, Any]) -> Dict[str, Any]:
        return self._backend.create_template(name, fields)

    def list_templates(self) -> List[Dict[str, Any]]:
        return self._backend.list_templates()

    def apply_template(self, name: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        return self._backend.apply_template(name, overrides)

    def delete_template(self, name: str) -> bool:
        return self._backend.delete_template(name)

    def create_filter(self, name: str, criteria: Dict[str, Any]) -> Dict[str, Any]:
        return self._backend.create_filter(name, criteria)

    def list_filters(self) -> List[Dict[str, Any]]:
        return self._backend.list_filters()

    def delete_filter(self, name: str) -> bool:
        return self._backend.delete_filter(name)

    def add_ci_watcher(self, issue_id: str, pr_url: str) -> Dict[str, Any]:
        return self._backend.add_ci_watcher(issue_id, pr_url)

    def remove_ci_watcher(self, issue_id: str) -> bool:
        return self._backend.remove_ci_watcher(issue_id)

    def list_ci_watchers(self) -> List[Dict[str, Any]]:
        return self._backend.list_ci_watchers()

    def update_ci_watcher(self, issue_id: str, updates: Dict[str, Any]) -> None:
        return self._backend.update_ci_watcher(issue_id, updates)

    def checkin_issue(self, issue_id: str, progress_pct: int, what_done: str, what_remains: str = "") -> Dict[str, Any]:
        return self._backend.checkin_issue(issue_id, progress_pct, what_done, what_remains)

    def split_issue(self, issue_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self._backend.split_issue(issue_id, parts)

    def summarize_thread(self, issue_id: str) -> Dict[str, Any]:
        return self._backend.summarize_thread(issue_id)

    # --- v0.8.0 new methods ---

    def assign_issue(self, issue_id: str, assignee: Optional[str]) -> Dict[str, Any]:
        return self._backend.assign_issue(issue_id, assignee)

    def pin_issue(self, issue_id: str, pinned: bool = True) -> Dict[str, Any]:
        return self._backend.pin_issue(issue_id, pinned)

    def set_issue_weight(self, issue_id: str, weight: int) -> Dict[str, Any]:
        return self._backend.set_issue_weight(issue_id, weight)

    def reopen_issue(self, issue_id: str, reason: str, reporter: str = "User") -> Dict[str, Any]:
        return self._backend.reopen_issue(issue_id, reason, reporter)

    def set_issue_checklist(self, issue_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]:
        return self._backend.set_issue_checklist(issue_id, items)

    def check_checklist_item(self, issue_id: str, item_index: int, done: bool) -> Dict[str, Any]:
        return self._backend.check_checklist_item(issue_id, item_index, done)

    def set_session_handoff(self, issue_id: str, next_step: str, files_in_progress: Optional[List[str]] = None, partial_criteria_done: Optional[List[int]] = None) -> Dict[str, Any]:
        return self._backend.set_session_handoff(issue_id, next_step, files_in_progress, partial_criteria_done)

    def abort_session(self, issue_id: str, reason: str, what_was_attempted: str = "", codebase_state: str = "clean") -> Dict[str, Any]:
        return self._backend.abort_session(issue_id, reason, what_was_attempted, codebase_state)

    def set_wip_limit(self, column: str, limit: int) -> Dict[str, int]:
        return self._backend.set_wip_limit(column, limit)

    def get_wip_limits(self) -> Dict[str, int]:
        return self._backend.get_wip_limits()

    def create_session_template(self, name: str, prompt_prefix: str, match_types: Optional[List[str]] = None, match_tags: Optional[List[str]] = None) -> Dict[str, Any]:
        return self._backend.create_session_template(name, prompt_prefix, match_types, match_tags)

    def list_session_templates(self) -> List[Dict[str, Any]]:
        return self._backend.list_session_templates()

    def delete_session_template(self, name: str) -> bool:
        return self._backend.delete_session_template(name)

    def comment_reply(self, issue_id: str, parent_comment_id: int, body: str, author: str = "User") -> Dict[str, Any]:
        return self._backend.comment_reply(issue_id, parent_comment_id, body, author)

    def risk_flag_issue(self, issue_id: str, risk_type: str, reason: str) -> Dict[str, Any]:
        return self._backend.risk_flag_issue(issue_id, risk_type, reason)

    def create_sprint_theme(self, name: str, description: str = "", color: str = "#0052CC") -> Dict[str, Any]:
        return self._backend.create_sprint_theme(name, description, color)

    def list_sprint_themes(self) -> List[Dict[str, Any]]:
        return self._backend.list_sprint_themes()

    # --- Observability ---

    def get_project_config(self) -> Dict[str, Any]:
        return self._backend.get_project_config()

    def log_activity(self, action: str, details: str = "") -> None:
        self._backend.log_activity(action, details)

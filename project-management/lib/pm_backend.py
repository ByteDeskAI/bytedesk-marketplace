"""PMBackend — Bridge Implementor protocol.

Defines the complete storage interface for the project-management plugin.
Both SQLiteBackend and PostgresBackend must structurally satisfy this contract.
PMStore (the Bridge Abstraction) depends only on this protocol.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Protocol


class PMBackend(Protocol):
    """Implementor side of the Bridge pattern for PM storage.

    Adding a new storage backend = create a class that matches all methods
    below and pass it through _resolve_backend(). PMStore and the MCP server
    require zero changes.
    """

    # --- Lifecycle ---

    def init_workspace(self, project_name: str, key_prefix: str) -> str:
        """Initialize the workspace. Returns absolute path to the data directory."""
        ...

    def is_initialized(self) -> bool:
        """Return True if the workspace has been set up and is ready."""
        ...

    # --- Issues ---

    def create_issue(
        self,
        title: str,
        description: str,
        issue_type: str,
        priority: str,
        epic_id: Optional[str],
        sprint_id: Optional[str],
        scope: Optional[str] = None,
        acceptance_criteria: Optional[List[str]] = None,
        tags: Optional[List[str]] = None,
        assignee: Optional[str] = None,
        pinned: bool = False,
        weight: int = 50,
    ) -> Dict[str, Any]:
        """Create and persist a new issue. Returns the created issue dict."""
        ...

    def get_issue(self, issue_id: str) -> Optional[Dict[str, Any]]:
        """Return the issue dict (including comments) or None if not found."""
        ...

    def update_issue(
        self,
        issue_id: str,
        updates: Dict[str, Any],
        comment: Optional[str],
        comment_author: str,
    ) -> Optional[Dict[str, Any]]:
        """Apply field updates and optionally append a comment. Returns updated issue or None."""
        ...

    def list_issues(
        self,
        status: Optional[str],
        sprint_id: Optional[str],
        issue_type: Optional[str],
        priority: Optional[str],
        query: Optional[str],
    ) -> List[Dict[str, Any]]:
        """Return issues filtered by any combination of the given criteria."""
        ...

    # --- Sprints ---

    def create_sprint(
        self, name: str, goal: str = "",
        duration_days: int = 7,
        epic_ids: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Create a new sprint in PLANNING status. Returns the sprint dict."""
        ...

    def start_sprint(self, sprint_id: str) -> Dict[str, Any]:
        """Transition a sprint to ACTIVE. Raises ValueError if another sprint is already active."""
        ...

    def complete_sprint(self, sprint_id: str) -> Dict[str, Any]:
        """Close a sprint and roll unfinished tickets back to the backlog. Returns the sprint dict."""
        ...

    def list_sprints(self) -> List[Dict[str, Any]]:
        """Return all sprints ordered by creation."""
        ...

    def get_active_sprint_id(self) -> Optional[str]:
        """Return the ID of the currently active sprint, or None."""
        ...

    # --- Documentation ---

    def create_doc(
        self,
        title: str,
        content: str,
        parent_id: Optional[str],
    ) -> Dict[str, Any]:
        """Create a new wiki page. Returns the doc dict."""
        ...

    def get_doc(self, doc_id: str) -> Optional[Dict[str, Any]]:
        """Return the doc dict or None if not found."""
        ...

    def update_doc(
        self,
        doc_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Apply updates to a wiki page. Returns updated doc or None."""
        ...

    def list_docs(self, query: Optional[str] = None, doc_type: Optional[str] = None) -> List[Dict[str, Any]]:
        """Return docs optionally filtered by a text query."""
        ...

    # --- Observability ---

    def get_project_config(self) -> Dict[str, Any]:
        """Return a snapshot of the project-level configuration."""
        ...

    def log_activity(self, action: str, details: str) -> None:
        """Append an activity entry to the audit log. Never raises."""
        ...

    def emit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        """Append an event line to .pm/events.jsonl for the dashboard SSE tail. Never raises."""
        ...

    # ── New methods (v0.6.0) ──────────────────────────────────────────────────

    def create_issues_bulk(self, issues_list: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Create multiple issues atomically. Returns list of created issue dicts."""
        ...

    def clone_issue(self, issue_id: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Clone an issue. Returns the new issue dict."""
        ...

    def attach_session(
        self,
        issue_id: str,
        summary: str,
        files_changed: Optional[List[str]] = None,
        tests_added: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """Attach a Claude session summary to an issue. Returns updated issue."""
        ...

    def flag_issue(self, issue_id: str, reason: str, options: Optional[List[str]] = None) -> Dict[str, Any]:
        """Set an issue to NEEDS_INPUT with a reason. Returns updated issue."""
        ...

    def link_commit(self, issue_id: str, sha: str, message: str = "", url: str = "") -> Dict[str, Any]:
        """Attach a git commit reference to an issue. Returns the link entry."""
        ...

    def add_issue_link(self, from_id: str, to_id: str, link_type: str) -> Dict[str, Any]:
        """Add a structured directional link between two issues. Returns the link entry."""
        ...

    def add_remote_link(self, issue_id: str, url: str, title: str = "") -> Dict[str, Any]:
        """Add a structured remote link. Auto-transitions to REVIEW for PR URLs. Returns entry."""
        ...

    def workspace_health(self) -> Dict[str, Any]:
        """Return a health report of the workspace. Never raises."""
        ...

    # ── New methods (v0.7.0) ──────────────────────────────────────────────────

    def create_template(self, name: str, fields: Dict[str, Any]) -> Dict[str, Any]: ...
    def list_templates(self) -> List[Dict[str, Any]]: ...
    def apply_template(self, name: str, overrides: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: ...
    def delete_template(self, name: str) -> bool: ...

    def create_filter(self, name: str, criteria: Dict[str, Any]) -> Dict[str, Any]: ...
    def list_filters(self) -> List[Dict[str, Any]]: ...
    def delete_filter(self, name: str) -> bool: ...

    def add_ci_watcher(self, issue_id: str, pr_url: str) -> Dict[str, Any]: ...
    def remove_ci_watcher(self, issue_id: str) -> bool: ...
    def list_ci_watchers(self) -> List[Dict[str, Any]]: ...
    def update_ci_watcher(self, issue_id: str, updates: Dict[str, Any]) -> None: ...

    def checkin_issue(self, issue_id: str, progress_pct: int, what_done: str, what_remains: str = "") -> Dict[str, Any]: ...
    def split_issue(self, issue_id: str, parts: List[Dict[str, Any]]) -> Dict[str, Any]: ...
    def summarize_thread(self, issue_id: str) -> Dict[str, Any]: ...

    # ── New methods (v0.8.0) ──────────────────────────────────────────────────

    def assign_issue(self, issue_id: str, assignee: Optional[str]) -> Dict[str, Any]: ...
    def pin_issue(self, issue_id: str, pinned: bool = True) -> Dict[str, Any]: ...
    def set_issue_weight(self, issue_id: str, weight: int) -> Dict[str, Any]: ...
    def reopen_issue(self, issue_id: str, reason: str, reporter: str = "User") -> Dict[str, Any]: ...
    def set_issue_checklist(self, issue_id: str, items: List[Dict[str, Any]]) -> Dict[str, Any]: ...
    def check_checklist_item(self, issue_id: str, item_index: int, done: bool) -> Dict[str, Any]: ...
    def set_session_handoff(self, issue_id: str, next_step: str, files_in_progress: Optional[List[str]] = None, partial_criteria_done: Optional[List[int]] = None) -> Dict[str, Any]: ...
    def abort_session(self, issue_id: str, reason: str, what_was_attempted: str = "", codebase_state: str = "clean") -> Dict[str, Any]: ...
    def set_wip_limit(self, column: str, limit: int) -> Dict[str, int]: ...
    def get_wip_limits(self) -> Dict[str, int]: ...
    def create_session_template(self, name: str, prompt_prefix: str, match_types: Optional[List[str]] = None, match_tags: Optional[List[str]] = None) -> Dict[str, Any]: ...
    def list_session_templates(self) -> List[Dict[str, Any]]: ...
    def delete_session_template(self, name: str) -> bool: ...
    def comment_reply(self, issue_id: str, parent_comment_id: int, body: str, author: str = "User") -> Dict[str, Any]: ...
    def risk_flag_issue(self, issue_id: str, risk_type: str, reason: str) -> Dict[str, Any]: ...
    def create_sprint_theme(self, name: str, description: str = "", color: str = "#0052CC") -> Dict[str, Any]: ...
    def list_sprint_themes(self) -> List[Dict[str, Any]]: ...

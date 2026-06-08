"""Minimal stdio MCP server for the localized project-management workspace."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from pm_store import PMStore

SERVER_INFO = {"name": "project-management", "version": "0.6.0"}


def tool_definitions() -> List[Dict[str, Any]]:
    return [
        {
            "name": "pm_init",
            "description": "Initialize a localized project management workspace. Creates a .pm/ directory in the current directory or uses user-specified folder. Usage: /pm:init [project_name] [--prefix KEY]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project_name": {
                        "type": "string",
                        "description": "Name of the project. Defaults to 'Local Project'."
                    },
                    "key_prefix": {
                        "type": "string",
                        "description": "Jira-like ticket prefix (e.g. PROJ, ENG, PM). Defaults to 'PM'."
                    },
                    "workspace_path": {
                        "type": "string",
                        "description": "Optional absolute path to initialize the workspace in. Defaults to CWD."
                    }
                }
            }
        },
        {
            "name": "pm_issue_create",
            "description": "Create a new ticket (Jira issue). Usage: /pm:ticket create <title> [--desc DESCRIPTION] [--type TYPE] [--priority PRIORITY]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Title/summary of the issue. Required."},
                    "description": {"type": "string", "description": "Detailed description of the issue."},
                    "issue_type": {"type": "string", "description": "Type of the ticket (bug, story, task, epic). Defaults to 'task'."},
                    "priority": {"type": "string", "description": "Priority (low, medium, high, critical). Defaults to 'medium'."},
                    "epic_id": {"type": "string", "description": "ID of the parent epic (e.g., PM-1)."},
                    "sprint_id": {"type": "string", "description": "ID of the sprint (e.g., sprint-1) or 'backlog'."},
                    "scope": {"type": "string", "enum": ["nano", "small", "medium", "large", "research"], "description": "AI-native complexity signal. nano=single fn, small=~1 day, medium=2-3 days, large=spike needed, research=investigation."},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "description": "List of acceptance criteria strings. Claude marks these done as it implements."}
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_issue_update",
            "description": "Update an existing ticket (change status, description, priority, add comments, update acceptance criteria, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID (e.g. PM-12). Required."},
                    "title": {"type": "string", "description": "New title/summary."},
                    "description": {"type": "string", "description": "New description."},
                    "status": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "REVIEW", "DONE", "NEEDS_INPUT"], "description": "New status."},
                    "priority": {"type": "string", "description": "New priority."},
                    "epic_id": {"type": "string", "description": "New parent epic ID (or null to clear)."},
                    "sprint_id": {"type": "string", "description": "New sprint ID (e.g., sprint-1, or null for backlog)."},
                    "scope": {"type": "string", "enum": ["nano", "small", "medium", "large", "research"], "description": "Complexity scope signal."},
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "description": "Replace the acceptance criteria list."},
                    "criteria_done": {"type": "array", "items": {"type": "integer"}, "description": "0-based indices of criteria that are now done."},
                    "comment": {"type": "string", "description": "Comment to append to the issue."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_get",
            "description": "View detailed information, comments, and status transitions of a specific ticket.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Issue ID (e.g. PM-12). Required."
                    }
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_list",
            "description": "List and search tickets filtered by status, sprint, priority, type, or query.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "Filter by status (TODO, IN_PROGRESS, REVIEW, DONE)."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "Filter by sprint ID (e.g. sprint-1), or 'backlog' for unassigned tickets."
                    },
                    "issue_type": {
                        "type": "string",
                        "description": "Filter by type (bug, story, task, epic)."
                    },
                    "priority": {
                        "type": "string",
                        "description": "Filter by priority."
                    },
                    "query": {
                        "type": "string",
                        "description": "Text search query on ID, title, or description."
                    }
                }
            }
        },
        {
            "name": "pm_sprint_manage",
            "description": "Manage sprint lifecycle: create, start, complete sprints, or list sprints. Sprints are 1 week (7 days) by default; configurable via duration_days. A sprint has a goal and references key epics/tasks. Usage: /pm:sprint <action> [sprint_id/name]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["create", "start", "complete", "list"], "description": "Lifecycle action. Required."},
                    "name": {"type": "string", "description": "Sprint name (required for action='create')."},
                    "goal": {"type": "string", "description": "Sprint goal — what the team aims to complete by end of week (required for action='create')."},
                    "duration_days": {"type": "integer", "description": "Sprint duration in days. Defaults to 7. Set at creation."},
                    "epic_ids": {"type": "array", "items": {"type": "string"}, "description": "List of epic or task IDs this sprint is focused on completing. E.g. ['PM-1', 'PM-5']."},
                    "sprint_id": {"type": "string", "description": "Sprint ID (required for action='start' or 'complete', e.g. 'sprint-1')."}
                },
                "required": ["action"]
            }
        },
        {
            "name": "pm_doc_create",
            "description": (
                "Create a new documentation page. Use doc_type='adr' for Architecture Decision Records. "
                "ADR doc_status lifecycle: proposed → accepted → deprecated → superseded. "
                "When superseding an existing ADR, set superseded_by on the OLD ADR to this new doc's ID, "
                "and set doc_status='superseded' on the old one."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title of the document. For ADRs use format: 'ADR-N: Decision Title'."
                    },
                    "content": {
                        "type": "string",
                        "description": "Markdown body. For ADRs include: ## Context, ## Decision, ## Consequences sections."
                    },
                    "doc_type": {
                        "type": "string",
                        "enum": ["wiki", "adr", "runbook", "learning", "plan", "brief"],
                        "description": "Document type. Use 'adr' for architecture decisions."
                    },
                    "doc_status": {
                        "type": "string",
                        "enum": ["proposed", "accepted", "deprecated", "superseded", ""],
                        "description": "ADR lifecycle status. New ADRs should start as 'proposed' or 'accepted'."
                    },
                    "superseded_by": {
                        "type": "string",
                        "description": "DOC-ID of the ADR that supersedes this one. Set when marking an ADR as superseded."
                    },
                    "parent_id": {
                        "type": "string",
                        "description": "Optional parent document ID for hierarchical nesting (e.g. DOC-1)."
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_doc_update",
            "description": "Update a documentation page. Use to advance ADR status (e.g. proposed → accepted) or record supersession.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Document ID (e.g. DOC-3). Required."
                    },
                    "title": {"type": "string", "description": "New title."},
                    "content": {"type": "string", "description": "New markdown body content."},
                    "doc_type": {
                        "type": "string",
                        "enum": ["wiki", "adr", "runbook", "learning", "plan", "brief"]
                    },
                    "doc_status": {
                        "type": "string",
                        "enum": ["proposed", "accepted", "deprecated", "superseded", ""],
                        "description": "New ADR lifecycle status."
                    },
                    "superseded_by": {
                        "type": "string",
                        "description": "DOC-ID of the ADR that supersedes this one."
                    },
                    "parent_id": {"type": "string", "description": "New parent document ID."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_doc_get",
            "description": "View the markdown content and metadata of a specific documentation page or ADR.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Document ID (e.g. DOC-3). Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_doc_list",
            "description": "List documentation pages. Filter by doc_type='adr' to retrieve all Architecture Decision Records.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Full-text search on ID, title, or body."
                    },
                    "doc_type": {
                        "type": "string",
                        "enum": ["wiki", "adr", "runbook", "learning", "plan", "brief"],
                        "description": "Filter by document type. Use 'adr' to list all ADRs."
                    }
                }
            }
        },
        {
            "name": "pm_status",
            "description": "Get a dashboard summary of the localized project management state (sprint stats, active board view, recent changes).",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        # ── New tools: Atlassian parity ───────────────────────────────────
        {
            "name": "pm_issue_comment",
            "description": "Add a comment to an issue. Atomic operation — does not touch any other issue fields. Use this instead of pm_issue_update when you only want to add a comment.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID (e.g. PM-5). Required."},
                    "body": {"type": "string", "description": "Comment text. Required."},
                    "author": {"type": "string", "description": "Author name. Defaults to current git user."}
                },
                "required": ["id", "body"]
            }
        },
        {
            "name": "pm_issue_link",
            "description": "Create a typed directional link between two issues. Link types: blocks, relates, duplicates, clones. Use to model dependencies between tasks.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from_id": {"type": "string", "description": "Source issue ID."},
                    "to_id": {"type": "string", "description": "Target issue ID."},
                    "link_type": {
                        "type": "string",
                        "description": "Relationship type.",
                        "enum": ["blocks", "is-blocked-by", "relates-to", "duplicates", "is-duplicated-by", "clones", "is-cloned-by"]
                    }
                },
                "required": ["from_id", "to_id", "link_type"]
            }
        },
        {
            "name": "pm_issue_get_transitions",
            "description": "Return the valid next status values for a given issue based on its current status. Use before pm_issue_transition to check allowed moves.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_transition",
            "description": "Transition an issue to a new status with validation. Enforces allowed transitions: TODO->IN_PROGRESS->REVIEW->DONE (or back). Rejects invalid jumps.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "status": {
                        "type": "string",
                        "description": "Target status.",
                        "enum": ["TODO", "IN_PROGRESS", "REVIEW", "DONE"]
                    },
                    "comment": {"type": "string", "description": "Optional comment to attach on transition."}
                },
                "required": ["id", "status"]
            }
        },
        {
            "name": "pm_issue_remote_link",
            "description": "Attach an external URL to an issue (e.g. a GitHub PR, design doc, Figma link). Stored as a named link on the issue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "url": {"type": "string", "description": "External URL. Required."},
                    "title": {"type": "string", "description": "Human-readable label for the link. Defaults to the URL."}
                },
                "required": ["id", "url"]
            }
        },
        {
            "name": "pm_search",
            "description": "Unified full-text search across issues AND documents in a single call. Returns ranked results with type, id, title, and a content excerpt. Use this instead of calling pm_issue_list + pm_doc_list separately.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search terms. Required."},
                    "types": {
                        "type": "string",
                        "description": "Comma-separated filter: 'issue', 'doc', or 'all'. Defaults to 'all'.",
                        "enum": ["issue", "doc", "all"]
                    },
                    "limit": {"type": "integer", "description": "Max results to return. Defaults to 10."}
                },
                "required": ["query"]
            }
        },
        {
            "name": "pm_user_info",
            "description": "Return current workspace identity: project name, key prefix, active sprint, and git user. Use at session start to orient yourself in the project.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "pm_doc_descendants",
            "description": "List all descendant pages under a given document, recursively. Returns the full page tree with titles and IDs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Root document ID. Required."},
                    "depth": {"type": "integer", "description": "Max recursion depth. Defaults to unlimited."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_doc_comment",
            "description": "Add a comment to a document page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Document ID. Required."},
                    "body": {"type": "string", "description": "Comment text. Required."},
                    "author": {"type": "string", "description": "Author name. Defaults to current git user."}
                },
                "required": ["id", "body"]
            }
        },
        {
            "name": "pm_fetch",
            "description": "Resolve any project resource by ID — issue ID (e.g. PM-5), doc ID (e.g. DOC-2), or sprint ID (e.g. sprint-1). Returns the full resource. Use when you have an ID but don't know the type.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Resource ID. Required."}
                },
                "required": ["id"]
            }
        },
        # ── Enforcement: redirect Atlassian tool calls ────────────────────
        {
            "name": "pm_redirect",
            "description": "ENFORCEMENT TOOL: If you are about to call an mcp__atlassian__* tool for project management, call this first. Pass the Atlassian tool name and get back the correct pm_* equivalent. This plugin IS the project management layer — never use mcp__atlassian__* for issues, docs, or sprints.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "atlassian_tool": {
                        "type": "string",
                        "description": "The mcp__atlassian__* tool name you were about to call (e.g. 'createJiraIssue')."
                    }
                },
                "required": ["atlassian_tool"]
            }
        },
        # ── v0.6.0 new tools ─────────────────────────────────────────────────
        {
            "name": "pm_context_pack",
            "description": "Single-call situational awareness for a Claude session. Returns active sprint + goal, all in-progress tickets with descriptions, accepted ADRs digest, the target ticket in full (if given), and any tickets blocking it. Call this once at session start instead of calling pm_status + pm_issue_list + pm_doc_list separately.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ticket_id": {"type": "string", "description": "Optional: the ticket this session will work on. Included in full with blocking issues."}
                }
            }
        },
        {
            "name": "pm_bulk_create",
            "description": "Create multiple issues atomically in a single call. Returns all created issues with assigned IDs. Use when decomposing an epic into child tasks to avoid multiple sequential pm_issue_create calls.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "issues": {
                        "type": "array",
                        "description": "List of issues to create.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "issue_type": {"type": "string"},
                                "priority": {"type": "string"},
                                "scope": {"type": "string", "enum": ["nano", "small", "medium", "large", "research"]},
                                "epic_id": {"type": "string"},
                                "sprint_id": {"type": "string"},
                                "acceptance_criteria": {"type": "array", "items": {"type": "string"}}
                            },
                            "required": ["title"]
                        }
                    }
                },
                "required": ["issues"]
            }
        },
        {
            "name": "pm_session_attach",
            "description": "Attach a Claude session summary to an issue after implementation completes. Writes a structured comment and stores the summary for future sessions to build on. Always call this before marking a ticket DONE.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "summary": {"type": "string", "description": "What was implemented. Be specific: decisions made, patterns used, things NOT done. Required."},
                    "files_changed": {"type": "array", "items": {"type": "string"}, "description": "List of files modified or created."},
                    "tests_added": {"type": "array", "items": {"type": "string"}, "description": "List of test files or test names added."}
                },
                "required": ["id", "summary"]
            }
        },
        {
            "name": "pm_workspace_health",
            "description": "Return a health report of the workspace: stale IN_PROGRESS tickets (>3 days untouched), issues with no description, epics with no children, ADRs stuck in 'proposed' for >7 days. Use to identify and fix hygiene issues.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_issue_clone",
            "description": "Clone an existing issue, creating a new one with the same title, description, type, priority, scope, and acceptance criteria. Useful for recurring work patterns. Add '[Clone] ' prefix is added automatically.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Source issue ID to clone. Required."},
                    "title": {"type": "string", "description": "Override title for the clone."},
                    "epic_id": {"type": "string", "description": "Override epic for the clone."},
                    "sprint_id": {"type": "string", "description": "Override sprint for the clone."},
                    "priority": {"type": "string", "description": "Override priority for the clone."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_decompose",
            "description": "Decompose an epic into child tasks. You (Claude) analyze the epic's title, description, and linked ADRs, then call pm_bulk_create with the resulting tasks. This tool returns the epic context + a decomposition prompt for you to fill in. Use strategy: 'sequential' for ordered steps, 'parallel' for independent workstreams, 'layer' for frontend/backend/tests split.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "epic_id": {"type": "string", "description": "Epic issue ID to decompose. Required."},
                    "strategy": {"type": "string", "enum": ["sequential", "parallel", "layer"], "description": "Decomposition strategy. Defaults to 'sequential'."},
                    "max_children": {"type": "integer", "description": "Maximum number of child tasks to create. Defaults to 8."}
                },
                "required": ["epic_id"]
            }
        },
        {
            "name": "pm_issue_triage",
            "description": "Triage raw text (a Slack message, bug report, email excerpt) into a structured ticket. Returns a proposed title, description, issue_type, priority, and acceptance_criteria for review. Then call pm_issue_create with the result.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "raw_text": {"type": "string", "description": "Raw problem statement to triage. Required."},
                    "default_type": {"type": "string", "description": "Hint for issue type if ambiguous. Defaults to 'task'."}
                },
                "required": ["raw_text"]
            }
        },
        {
            "name": "pm_sprint_retrospective",
            "description": "Generate a retrospective learning doc for a completed sprint. Summarises: tickets shipped (DONE), tickets rolled over, session count per ticket, and a narrative. Creates a 'learning' doc automatically. Call after pm_sprint_manage(action='complete').",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint ID to retrospect. Required."},
                    "narrative": {"type": "string", "description": "Optional one-paragraph narrative to include (you write this after reviewing the sprint)."}
                },
                "required": ["sprint_id"]
            }
        },
        {
            "name": "pm_commit_link",
            "description": "Attach a git commit reference to an issue. Call after any git commit that implements work on a ticket. The commit SHA, message, and optional GitHub URL are stored as a commit_links entry on the issue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "sha": {"type": "string", "description": "Full or short git commit SHA. Required."},
                    "message": {"type": "string", "description": "First line of the commit message."},
                    "url": {"type": "string", "description": "Optional GitHub commit URL."}
                },
                "required": ["id", "sha"]
            }
        },
        {
            "name": "pm_issue_ask",
            "description": "Answer a question about a ticket using its full knowledge context: description, comments, linked docs, accepted ADRs, prior session summaries, and blocking issues. Returns a synthesized answer. Use when you have a specific question before starting implementation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID to ask about. Required."},
                    "question": {"type": "string", "description": "Your question about this ticket. Required."}
                },
                "required": ["id", "question"]
            }
        },
        {
            "name": "pm_issue_flag",
            "description": "Flag an issue as NEEDS_INPUT — you hit a genuine decision point that requires human input. Sets status to NEEDS_INPUT, records the reason, and optionally offers choices for the human to pick. The dashboard shows a prominent amber banner on the ticket.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID to flag. Required."},
                    "reason": {"type": "string", "description": "Clear explanation of what decision is needed. Required."},
                    "options": {"type": "array", "items": {"type": "string"}, "description": "Optional list of choices for the human to pick from (e.g. ['Use JWT', 'Use session cookies'])."}
                },
                "required": ["id", "reason"]
            }
        },
        {
            "name": "pm_migrate",
            "description": (
                "Migrate the project management workspace from one backend to another. "
                "Supported directions: 'sqlite_to_jsonl' (convert pm.db to JSONL files — "
                "run this when moving to the new default text-based storage), "
                "'jsonl_to_sqlite' (convert JSONL files back to pm.db). "
                "The source data is preserved; only the target is written. "
                "After migration, remove the source manually or set keep_source=true to leave it. "
                "Returns counts of migrated issues, docs, and sprints."
            ),
            "inputSchema": {
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["sqlite_to_jsonl", "jsonl_to_sqlite"],
                        "description": "Migration direction. Required."
                    },
                    "keep_source": {
                        "type": "boolean",
                        "description": "If false (default), delete the source database/files after successful migration."
                    }
                },
                "required": ["direction"]
            }
        }
    ]


def _json_text(value: Any) -> Dict[str, str]:
    return {"type": "text", "text": json.dumps(value, indent=2, sort_keys=True)}


def _git_user() -> str:
    """Return the current git user name, falling back to 'User'."""
    import subprocess as _sp
    try:
        result = _sp.run(["git", "config", "user.name"], capture_output=True, text=True, timeout=3)
        name = result.stdout.strip()
        return name if name else "User"
    except Exception:
        return "User"


def call_pm_tool(name: str, arguments: Dict[str, Any]) -> Any:
    # Auto-resolve workspace path unless initializing a specific folder
    workspace_override = arguments.get("workspace_path")
    store = PMStore(workspace_override)

    # Allow initializing even if not already active
    if name == "pm_init":
        project_name = arguments.get("project_name", "Local Project")
        key_prefix = arguments.get("key_prefix", "PM")
        path = store.init_workspace(project_name, key_prefix)
        # Write .pm/.gitignore so the directory can be committed but data files stay local
        from pathlib import Path as _Path
        gitignore_path = _Path(path) / ".gitignore"
        if not gitignore_path.exists():
            gitignore_path.write_text(
                "# pm.db is machine-local project data — do not commit\n"
                "pm.db\n"
                "pm.db-shm\n"
                "pm.db-wal\n"
                "events.jsonl\n"
                "dashboard.pid\n"
                "dashboard.port\n"
            )
        return {
            "ok": True,
            "message": f"Workspace initialized successfully at {path}",
            "project_name": project_name,
            "key_prefix": key_prefix
        }

    # Verify initialization for all other tools
    if not store.is_initialized():
        return {
            "ok": False,
            "error": "Workspace not initialized. Run pm_init first or ensure you are in a project directory containing a .pm folder."
        }

    if name == "pm_issue_create":
        issue = store.create_issue(
            title=arguments["title"],
            description=arguments.get("description", ""),
            issue_type=arguments.get("issue_type", "task"),
            priority=arguments.get("priority", "medium"),
            epic_id=arguments.get("epic_id"),
            sprint_id=arguments.get("sprint_id"),
            scope=arguments.get("scope"),
            acceptance_criteria=arguments.get("acceptance_criteria"),
        )
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_update":
        issue_id = arguments["id"]
        updates = {}
        for field in ["title", "description", "issue_type", "priority", "epic_id", "sprint_id",
                      "scope", "acceptance_criteria", "criteria_done"]:
            if field in arguments:
                model_field = "type" if field == "issue_type" else field
                updates[model_field] = arguments[field]
        if "status" in arguments:
            updates["status"] = arguments["status"].strip().upper()
        issue = store.update_issue(
            issue_id=issue_id,
            updates=updates,
            comment=arguments.get("comment")
        )
        if not issue:
            return {"ok": False, "error": f"Ticket {issue_id} not found."}
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_get":
        issue_id = arguments["id"]
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Ticket {issue_id} not found."}
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_list":
        issues = store.list_issues(
            status=arguments.get("status"),
            sprint_id=arguments.get("sprint_id"),
            issue_type=arguments.get("issue_type"),
            priority=arguments.get("priority"),
            query=arguments.get("query")
        )
        return {"ok": True, "count": len(issues), "issues": issues}

    elif name == "pm_sprint_manage":
        action = arguments["action"]
        if action == "create":
            name_val = arguments.get("name")
            if not name_val:
                return {"ok": False, "error": "sprint name required for create action."}
            sprint = store.create_sprint(
                name=name_val,
                goal=arguments.get("goal", ""),
                duration_days=int(arguments.get("duration_days", 7)),
                epic_ids=arguments.get("epic_ids"),
            )
            return {"ok": True, "sprint": sprint}
        elif action == "start":
            sprint_id = arguments.get("sprint_id")
            if not sprint_id:
                return {"ok": False, "error": "sprint_id required for start action."}
            try:
                sprint = store.start_sprint(sprint_id)
                return {"ok": True, "sprint": sprint}
            except ValueError as e:
                return {"ok": False, "error": str(e)}
        elif action == "complete":
            sprint_id = arguments.get("sprint_id")
            if not sprint_id:
                return {"ok": False, "error": "sprint_id required for complete action."}
            try:
                sprint = store.complete_sprint(sprint_id)
                return {"ok": True, "sprint": sprint}
            except ValueError as e:
                return {"ok": False, "error": str(e)}
        elif action == "list":
            return {"ok": True, "active_sprint_id": store.get_active_sprint_id(), "sprints": store.list_sprints()}

    elif name == "pm_doc_create":
        doc = store.create_doc(
            title=arguments["title"],
            content=arguments.get("content", ""),
            parent_id=arguments.get("parent_id"),
            doc_type=arguments.get("doc_type", "wiki"),
            doc_status=arguments.get("doc_status", ""),
            superseded_by=arguments.get("superseded_by"),
        )
        return {"ok": True, "document": doc}

    elif name == "pm_doc_update":
        doc_id = arguments["id"]
        updates = {}
        for field in ["title", "content", "parent_id", "doc_type", "doc_status", "superseded_by"]:
            if field in arguments:
                updates[field] = arguments[field]
        doc = store.update_doc(doc_id, updates)
        if not doc:
            return {"ok": False, "error": f"Document {doc_id} not found."}
        return {"ok": True, "document": doc}

    elif name == "pm_doc_get":
        doc_id = arguments["id"]
        doc = store.get_doc(doc_id)
        if not doc:
            return {"ok": False, "error": f"Document {doc_id} not found."}
        return {"ok": True, "document": doc}

    elif name == "pm_doc_list":
        docs = store.list_docs(
            query=arguments.get("query"),
            doc_type=arguments.get("doc_type"),
        )
        return {"ok": True, "count": len(docs), "documents": docs}

    elif name == "pm_status":
        config = store.get_project_config()
        active_sprint_id = store.get_active_sprint_id()

        sprint_info = "No active sprint"
        sprint_tickets: List[Dict[str, Any]] = []
        if active_sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == active_sprint_id:
                    goal = s.get("goal", "")
                    sprint_info = f"Active Sprint: {s['name']}" + (f" (Goal: {goal})" if goal else "")
                    break
            sprint_tickets = store.list_issues(sprint_id=active_sprint_id)
        else:
            sprint_tickets = store.list_issues()

        board: Dict[str, List[str]] = {"TODO": [], "IN_PROGRESS": [], "REVIEW": [], "DONE": []}
        for t in sprint_tickets:
            stat = t.get("status", "TODO").upper()
            if stat not in board:
                stat = "TODO"
            board[stat].append(f"{t['id']} ({t['title']})")

        logs = list(reversed(config.get("activity_log", [])[:5]))

        # Resolve the live dashboard URL if the server is running
        dashboard_url: Optional[str] = None
        try:
            port_file = Path(store._backend.root) / "dashboard.port"
            if port_file.exists():
                port = int(port_file.read_text().strip())
                dashboard_url = f"http://localhost:{port}"
        except Exception:
            pass

        dashboard = {
            "project_name": config.get("project_name"),
            "key_prefix": config.get("key_prefix"),
            "active_sprint": sprint_info,
            "sprint_progress": {
                "total_tickets": len(sprint_tickets),
                "done_tickets": len([t for t in sprint_tickets if t.get("status", "").upper() == "DONE"]),
            },
            "columns": {
                "TODO": board["TODO"],
                "IN_PROGRESS": board["IN_PROGRESS"],
                "REVIEW": board["REVIEW"],
                "DONE": board["DONE"],
            },
            "recent_activity": logs,
        }
        if dashboard_url:
            dashboard["dashboard_url"] = dashboard_url
        return {"ok": True, "dashboard": dashboard}

    # ── New tool handlers ─────────────────────────────────────────────────

    elif name == "pm_issue_comment":
        issue_id = arguments["id"]
        body = arguments["body"]
        author = arguments.get("author", _git_user())
        result = store.update_issue(issue_id, updates={}, comment=body, comment_author=author)
        if not result:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        comments = result.get("comments", [])
        added = comments[-1] if comments else {}
        return {"ok": True, "comment": added, "issue_id": issue_id}

    elif name == "pm_issue_link":
        from_id = arguments["from_id"].strip().upper()
        to_id = arguments["to_id"].strip().upper()
        link_type = arguments["link_type"]
        if not store.get_issue(from_id):
            return {"ok": False, "error": f"Issue {from_id} not found."}
        if not store.get_issue(to_id):
            return {"ok": False, "error": f"Issue {to_id} not found."}
        link = store.add_issue_link(from_id, to_id, link_type)
        return {"ok": True, "link": link}

    elif name == "pm_issue_get_transitions":
        issue_id = arguments["id"]
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        status = issue.get("status", "TODO")
        allowed: Dict[str, List[str]] = {
            "TODO":        ["IN_PROGRESS"],
            "IN_PROGRESS": ["TODO", "REVIEW", "DONE", "NEEDS_INPUT"],
            "REVIEW":      ["IN_PROGRESS", "DONE", "NEEDS_INPUT"],
            "DONE":        ["REVIEW"],
            "NEEDS_INPUT": ["IN_PROGRESS", "TODO"],
        }
        return {"ok": True, "current_status": status, "allowed_transitions": allowed.get(status, [])}

    elif name == "pm_issue_transition":
        issue_id = arguments["id"]
        new_status = arguments["status"].strip().upper()
        comment = arguments.get("comment")
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        current = issue.get("status", "TODO")
        allowed: Dict[str, List[str]] = {
            "TODO":        ["IN_PROGRESS"],
            "IN_PROGRESS": ["TODO", "REVIEW", "DONE", "NEEDS_INPUT"],
            "REVIEW":      ["IN_PROGRESS", "DONE", "NEEDS_INPUT"],
            "DONE":        ["REVIEW"],
            "NEEDS_INPUT": ["IN_PROGRESS", "TODO"],
        }
        if new_status not in allowed.get(current, []):
            return {
                "ok": False,
                "error": f"Cannot transition from {current} to {new_status}. Allowed: {allowed.get(current, [])}",
                "hint": "Call pm_issue_get_transitions to see valid next states."
            }
        updates: Dict[str, Any] = {"status": new_status}
        if new_status != "NEEDS_INPUT":
            updates["flagged_reason"] = None
            updates["flagged_options"] = []
        result = store.update_issue(issue_id, updates=updates, comment=comment)
        return {"ok": True, "issue": result, "transitioned": f"{current} -> {new_status}"}

    elif name == "pm_issue_remote_link":
        issue_id = arguments["id"]
        url = arguments["url"]
        title = arguments.get("title") or url
        if not store.get_issue(issue_id):
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        entry = store.add_remote_link(issue_id, url, title)
        return {"ok": True, "remote_link": entry}

    elif name == "pm_search":
        query = arguments["query"].strip()
        types = arguments.get("types", "all")
        limit = int(arguments.get("limit", 10))
        results: List[Dict[str, Any]] = []
        if types in ("issue", "all"):
            issues = store.list_issues(query=query)
            for i in issues[:limit]:
                results.append({
                    "type": "issue", "id": i["id"], "title": i["title"],
                    "status": i.get("status"), "priority": i.get("priority"),
                    "excerpt": (i.get("description") or "")[:120],
                })
        if types in ("doc", "all"):
            docs = store.list_docs(query=query)
            for d in docs[: max(0, limit - len(results))]:
                results.append({
                    "type": "doc", "id": d["id"], "title": d["title"],
                    "doc_type": d.get("doc_type", "wiki"),
                    "excerpt": (d.get("content") or "")[:120],
                })
        return {"ok": True, "query": query, "count": len(results), "results": results}

    elif name == "pm_user_info":
        import subprocess as _sp
        git_user = _git_user()
        config = store.get_project_config() if store.is_initialized() else {}
        sprint_id = store.get_active_sprint_id() if store.is_initialized() else None
        sprint_name = None
        if sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == sprint_id:
                    sprint_name = s.get("name"); break
        return {
            "ok": True,
            "git_user": git_user,
            "project_name": config.get("project_name"),
            "key_prefix": config.get("key_prefix"),
            "active_sprint_id": sprint_id,
            "active_sprint_name": sprint_name,
        }

    elif name == "pm_doc_descendants":
        root_id = arguments["id"].strip().upper()
        max_depth = int(arguments.get("depth", 99))
        all_docs = store.list_docs()
        by_parent: Dict[str, List[Dict[str, Any]]] = {}
        for d in all_docs:
            p = d.get("parent_id") or "root"
            by_parent.setdefault(p, []).append(d)

        def collect(pid: str, depth: int) -> List[Dict[str, Any]]:
            if depth <= 0:
                return []
            children = by_parent.get(pid, [])
            result = []
            for c in children:
                result.append({"id": c["id"], "title": c["title"], "depth": max_depth - depth + 1})
                result.extend(collect(c["id"], depth - 1))
            return result

        root = store.get_doc(root_id)
        if not root:
            return {"ok": False, "error": f"Document {root_id} not found."}
        descendants = collect(root_id, max_depth)
        return {"ok": True, "root": root_id, "count": len(descendants), "descendants": descendants}

    elif name == "pm_doc_comment":
        doc_id = arguments["id"].strip().upper()
        body = arguments["body"]
        author = arguments.get("author", _git_user())
        doc = store.get_doc(doc_id)
        if not doc:
            return {"ok": False, "error": f"Document {doc_id} not found."}
        existing_content = doc.get("content", "")
        from datetime import datetime, timezone
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        comment_block = f"\n\n---\n**Comment** by {author} at {ts}\n{body}"
        store.update_doc(doc_id, {"content": existing_content + comment_block})
        return {"ok": True, "doc_id": doc_id, "comment": {"author": author, "body": body, "created_at": ts}}

    elif name == "pm_fetch":
        resource_id = arguments["id"].strip().upper()
        # Try issue first
        if "-" in resource_id and not resource_id.startswith("DOC-") and not resource_id.startswith("SPRINT-"):
            issue = store.get_issue(resource_id)
            if issue:
                return {"ok": True, "type": "issue", "resource": issue}
        # Try doc
        if resource_id.startswith("DOC-"):
            doc = store.get_doc(resource_id)
            if doc:
                return {"ok": True, "type": "doc", "resource": doc}
        # Try sprint
        if resource_id.lower().startswith("sprint-"):
            config = store.get_project_config()
            for s in config.get("sprints", []):
                if s["id"].lower() == resource_id.lower():
                    return {"ok": True, "type": "sprint", "resource": s}
        # Fallback: try issue anyway
        issue = store.get_issue(resource_id)
        if issue:
            return {"ok": True, "type": "issue", "resource": issue}
        return {"ok": False, "error": f"Resource '{resource_id}' not found. Try pm_issue_get, pm_doc_get, or pm_issue_list."}

    elif name == "pm_redirect":
        atlassian_tool = arguments.get("atlassian_tool", "").strip()
        mapping = {
            "createJiraIssue":          ("pm_issue_create", "Create an issue in the local workspace."),
            "editJiraIssue":            ("pm_issue_update", "Update any field on an existing issue."),
            "getJiraIssue":             ("pm_issue_get", "Get full issue detail including comments."),
            "searchJiraIssuesUsingJql": ("pm_issue_list", "Filter issues by status, sprint, assignee, type, or query text."),
            "addCommentToJiraIssue":    ("pm_issue_comment", "Add an atomic comment to an issue."),
            "transitionJiraIssue":      ("pm_issue_transition", "Transition issue status with validation."),
            "getTransitionsForJiraIssue": ("pm_issue_get_transitions", "Get allowed next statuses for an issue."),
            "createIssueLink":          ("pm_issue_link", "Create a typed link between two issues."),
            "createConfluencePage":     ("pm_doc_create", "Create a wiki/ADR/runbook page."),
            "updateConfluencePage":     ("pm_doc_update", "Update a page's title or content."),
            "getConfluencePage":        ("pm_doc_get", "Get a page's full content."),
            "getPagesInConfluenceSpace": ("pm_doc_list", "List or search all pages."),
            "getConfluencePageDescendants": ("pm_doc_descendants", "Recursively list child pages."),
            "search":                   ("pm_search", "Unified search across issues and docs."),
            "searchConfluenceUsingCql": ("pm_search", "Search docs using pm_search with a text query."),
            "atlassianUserInfo":        ("pm_user_info", "Get current workspace identity and git user."),
            "lookupJiraAccountId":      ("pm_user_info", "Get user identity from the local workspace config."),
            "addWorklogToJiraIssue":    ("pm_issue_comment", "Log session notes as a comment on the issue."),
            "getVisibleJiraProjects":   ("pm_status", "Get workspace/project summary."),
            "getJiraProjectIssueTypesMetadata": ("pm_status", "Issue types: task, bug, story, epic — see pm_issue_create."),
            "createConfluenceFooterComment": ("pm_doc_comment", "Add a comment to a document page."),
            "createConfluenceInlineComment": ("pm_doc_comment", "Add a comment to a document page."),
            "getConfluencePageFooterComments": ("pm_doc_get", "Comments are embedded in the doc content."),
            "fetch":                    ("pm_fetch", "Resolve any resource by ID."),
        }
        if atlassian_tool in mapping:
            pm_tool, description = mapping[atlassian_tool]
            return {
                "ok": True,
                "message": f"Do NOT use mcp__atlassian__{atlassian_tool}. This workspace uses local project management.",
                "use_instead": pm_tool,
                "description": description,
            }
        return {
            "ok": False,
            "error": f"Unknown Atlassian tool '{atlassian_tool}'.",
            "message": "All project management (issues, docs, sprints) must use pm_* tools, not mcp__atlassian__* tools.",
        }

    # ── v0.6.0 new tool handlers ──────────────────────────────────────────

    elif name == "pm_context_pack":
        config = store.get_project_config()
        active_sprint_id = store.get_active_sprint_id()
        ticket_id = (arguments.get("ticket_id") or "").strip().upper() or None

        # Active sprint info
        sprint_info: Dict[str, Any] = {}
        if active_sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == active_sprint_id:
                    sprint_info = {
                        "id": s["id"], "name": s["name"], "goal": s.get("goal", ""),
                        "end_date": s.get("end_date"), "epic_ids": s.get("epic_ids", []),
                    }

        # In-progress tickets
        in_progress = store.list_issues(status="IN_PROGRESS")

        # Accepted ADRs digest
        adrs = store.list_docs(doc_type="adr")
        adr_digest = [
            {"id": d["id"], "title": d["title"], "status": d.get("doc_status", ""),
             "superseded_by": d.get("superseded_by")}
            for d in adrs if d.get("doc_status") in ("accepted", "")
        ]

        # Target ticket + its blockers
        target_ticket: Optional[Dict[str, Any]] = None
        blockers: List[Dict[str, Any]] = []
        if ticket_id:
            target_ticket = store.get_issue(ticket_id)
            if target_ticket:
                for link in target_ticket.get("links", []):
                    if link.get("type") == "is-blocked-by":
                        blocker = store.get_issue(link["to_id"])
                        if blocker and blocker.get("status") not in ("DONE", "REVIEW"):
                            blockers.append({"id": blocker["id"], "title": blocker["title"],
                                             "status": blocker["status"]})

        return {
            "ok": True,
            "active_sprint": sprint_info,
            "in_progress_tickets": [{"id": i["id"], "title": i["title"],
                                      "description": (i.get("description") or "")[:300]}
                                     for i in in_progress],
            "adr_digest": adr_digest,
            "target_ticket": target_ticket,
            "blockers": blockers,
            "hint": "Use pm_doc_get to read full ADR content. Use pm_issue_get for full ticket details.",
        }

    elif name == "pm_bulk_create":
        issues_list = arguments.get("issues", [])
        if not issues_list:
            return {"ok": False, "error": "issues list is required and must be non-empty."}
        created = store.create_issues_bulk(issues_list)
        return {"ok": True, "count": len(created), "issues": created}

    elif name == "pm_session_attach":
        issue_id = arguments["id"]
        summary = arguments["summary"]
        try:
            issue = store.attach_session(
                issue_id=issue_id,
                summary=summary,
                files_changed=arguments.get("files_changed"),
                tests_added=arguments.get("tests_added"),
            )
            return {"ok": True, "issue_id": issue_id, "session_summary_stored": True}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_workspace_health":
        return store.workspace_health()

    elif name == "pm_issue_clone":
        source_id = arguments["id"]
        overrides = {k: v for k, v in arguments.items() if k != "id"}
        try:
            clone = store.clone_issue(source_id, overrides)
            return {"ok": True, "clone": clone, "cloned_from": source_id}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_decompose":
        epic_id = arguments["epic_id"].strip().upper()
        strategy = arguments.get("strategy", "sequential")
        max_children = int(arguments.get("max_children", 8))
        epic = store.get_issue(epic_id)
        if not epic:
            return {"ok": False, "error": f"Epic {epic_id} not found."}
        adrs = store.list_docs(doc_type="adr")
        adr_digest = [{"id": d["id"], "title": d["title"]} for d in adrs
                      if d.get("doc_status") in ("accepted", "")]
        return {
            "ok": True,
            "epic": epic,
            "strategy": strategy,
            "max_children": max_children,
            "adr_digest": adr_digest,
            "instruction": (
                f"You have the epic context above. Using strategy='{strategy}', "
                f"create up to {max_children} child tasks by calling pm_bulk_create. "
                f"Each task should have: title, description (with acceptance criteria), "
                f"issue_type='task', scope (nano/small/medium/large), epic_id='{epic_id}'. "
                f"For 'sequential': number them 1. 2. 3. in dependency order. "
                f"For 'parallel': all independent, can run concurrently. "
                f"For 'layer': group by frontend / backend / tests / infra."
            ),
        }

    elif name == "pm_issue_triage":
        raw_text = arguments["raw_text"].strip()
        default_type = arguments.get("default_type", "task")
        # Heuristic triage — Claude uses this output as a starting point
        import re as _re
        text_lower = raw_text.lower()
        detected_type = default_type
        detected_priority = "medium"
        if any(w in text_lower for w in ("crash", "error", "exception", "traceback", "500", "broken", "null pointer")):
            detected_type = "bug"
            detected_priority = "high"
        elif any(w in text_lower for w in ("feature", "add", "implement", "build", "create", "new")):
            detected_type = "task"
        elif any(w in text_lower for w in ("investigate", "research", "spike", "explore")):
            detected_type = "task"
            detected_priority = "medium"
        if any(w in text_lower for w in ("urgent", "critical", "asap", "production down", "p0")):
            detected_priority = "critical"
        elif any(w in text_lower for w in ("low priority", "nice to have", "someday")):
            detected_priority = "low"
        # Extract first sentence as title candidate
        sentences = _re.split(r'[.!?\n]', raw_text.strip())
        title_candidate = sentences[0].strip()[:120] if sentences else raw_text[:80]
        return {
            "ok": True,
            "proposed": {
                "title": title_candidate,
                "description": f"## Context\n\n{raw_text}\n\n## Goal\n\n_Fill in_\n\n## Out of scope\n\n_Fill in_",
                "issue_type": detected_type,
                "priority": detected_priority,
                "acceptance_criteria": ["_Add acceptance criteria here_"],
            },
            "instruction": "Review the proposed fields and adjust as needed, then call pm_issue_create with the final values.",
        }

    elif name == "pm_sprint_retrospective":
        sprint_id = arguments["sprint_id"].strip()
        narrative = arguments.get("narrative", "")
        config = store.get_project_config()
        sprint = next((s for s in config.get("sprints", []) if s["id"] == sprint_id), None)
        if not sprint:
            return {"ok": False, "error": f"Sprint {sprint_id} not found."}
        all_issues = store.list_issues()
        sprint_issues = [i for i in all_issues if (i.get("sprint_id") or "").lower() == sprint_id.lower()]
        done = [i for i in sprint_issues if i.get("status") == "DONE"]
        rolled = [i for i in sprint_issues if i.get("status") != "DONE"]
        content = (
            f"# Sprint Retrospective: {sprint.get('name', sprint_id)}\n\n"
            f"**Sprint ID:** {sprint_id}  \n"
            f"**Goal:** {sprint.get('goal', 'N/A')}  \n"
            f"**Started:** {sprint.get('started_at', 'N/A')}  \n"
            f"**Completed:** {sprint.get('completed_at', 'N/A')}  \n\n"
            f"## Shipped ({len(done)} tickets)\n\n"
            + "\n".join(f"- [{i['id']}] {i['title']} — "
                        f"{len(i.get('session_summaries', []))} session(s)" for i in done)
            + f"\n\n## Rolled Over ({len(rolled)} tickets)\n\n"
            + "\n".join(f"- [{i['id']}] {i['title']} ({i.get('status', '?')})" for i in rolled)
            + f"\n\n## Narrative\n\n{narrative or '_No narrative provided._'}"
        )
        doc = store.create_doc(
            title=f"Retro: {sprint.get('name', sprint_id)}",
            content=content,
            doc_type="learning",
        )
        return {"ok": True, "doc": doc, "done_count": len(done), "rolled_count": len(rolled)}

    elif name == "pm_commit_link":
        issue_id = arguments["id"]
        sha = arguments["sha"]
        try:
            entry = store.link_commit(
                issue_id=issue_id,
                sha=sha,
                message=arguments.get("message", ""),
                url=arguments.get("url", ""),
            )
            return {"ok": True, "commit_link": entry, "issue_id": issue_id}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_ask":
        issue_id = arguments["id"].strip().upper()
        question = arguments["question"].strip()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        # Assemble context bundle
        adrs = store.list_docs(doc_type="adr")
        accepted_adrs = [{"id": d["id"], "title": d["title"]} for d in adrs
                         if d.get("doc_status") in ("accepted", "")]
        session_summaries = issue.get("session_summaries", [])
        blocking_issues = []
        for link in issue.get("links", []):
            if link.get("type") == "is-blocked-by":
                b = store.get_issue(link["to_id"])
                if b:
                    blocking_issues.append({"id": b["id"], "title": b["title"], "status": b["status"]})
        return {
            "ok": True,
            "question": question,
            "context": {
                "issue": issue,
                "accepted_adrs": accepted_adrs,
                "prior_session_summaries": session_summaries,
                "blocking_issues": blocking_issues,
            },
            "instruction": (
                "Using the context above, answer the question: " + question + "\n"
                "Base your answer on the issue description, ADRs, and prior session summaries."
            ),
        }

    elif name == "pm_issue_flag":
        issue_id = arguments["id"]
        reason = arguments["reason"]
        options = arguments.get("options")
        try:
            issue = store.flag_issue(issue_id, reason, options)
            return {"ok": True, "issue": issue, "message": f"{issue_id} flagged as NEEDS_INPUT."}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_migrate":
        direction = arguments.get("direction", "").strip()
        keep_source = arguments.get("keep_source", False)

        # Resolve the .pm/ root from the store (already constructed above)
        pm_root = Path(store._backend.root) if hasattr(store._backend, "root") else Path(".pm")

        if direction == "sqlite_to_jsonl":
            db_path = pm_root / "pm.db"
            if not db_path.exists():
                return {"ok": False, "error": f"No pm.db found at {db_path}. Nothing to migrate."}
            from pm_backend_jsonl import JSONLBackend
            target = JSONLBackend(pm_root)
            result = target.migrate_from_sqlite(db_path)
            if result.get("ok") and not keep_source:
                for f in ["pm.db", "pm.db-shm", "pm.db-wal"]:
                    p = pm_root / f
                    if p.exists():
                        p.unlink()
                result["source_deleted"] = True
            return result

        elif direction == "jsonl_to_sqlite":
            config_path = pm_root / "config.json"
            if not config_path.exists():
                return {"ok": False, "error": f"No config.json found at {pm_root}. Nothing to migrate."}
            from pm_backend_jsonl import JSONLBackend
            from pm_backend_sqlite import SQLiteBackend
            src = JSONLBackend(pm_root)
            if not src.is_initialized():
                return {"ok": False, "error": "JSONL workspace is not initialized."}

            # Write to a fresh pm.db (temp path first to avoid clobbering)
            target_path = pm_root / "pm.db"
            if target_path.exists():
                return {
                    "ok": False,
                    "error": f"pm.db already exists at {target_path}. Remove it first or use direction='sqlite_to_jsonl'.",
                }
            target = SQLiteBackend(pm_root)
            src_config = src.get_project_config()
            target.init_workspace(src_config["project_name"], src_config["key_prefix"])

            issues = src.list_issues()
            docs = src.list_docs()
            sprints = src.list_sprints()

            # Replay all records into the SQLite backend
            for sprint in sprints:
                target.create_sprint(sprint["name"], sprint.get("goal", ""))
            for issue in issues:
                target.create_issue(
                    issue["title"], issue.get("description", ""),
                    issue.get("type", "task"), issue.get("priority", "medium"),
                    issue.get("epic_id"), issue.get("sprint_id"),
                )
                if issue.get("status", "TODO") != "TODO":
                    target.update_issue(issue["id"], {"status": issue["status"]})
                for c in issue.get("comments", []):
                    target.update_issue(issue["id"], {}, comment=c["body"], comment_author=c.get("author", "User"))
            for doc in docs:
                target.create_doc(
                    doc["title"], doc.get("content", ""),
                    doc.get("parent_id"), doc.get("doc_type", "wiki"),
                    doc.get("doc_status", ""), doc.get("superseded_by"),
                )

            result: Dict[str, Any] = {"ok": True, "issues": len(issues), "docs": len(docs), "sprints": len(sprints)}
            if not keep_source:
                for f in ["config.json", "issues.jsonl", "docs.jsonl"]:
                    p = pm_root / f
                    if p.exists():
                        p.unlink()
                result["source_deleted"] = True
            return result

        return {"ok": False, "error": f"Unknown direction '{direction}'. Use 'sqlite_to_jsonl' or 'jsonl_to_sqlite'."}

    return {"ok": False, "error": f"Unknown tool name: {name}"}


def handle_request(request: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    method = request.get("method")
    request_id = request.get("id")

    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "serverInfo": SERVER_INFO
            }
        }
    if method == "notifications/initialized":
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tool_definitions()}}
    if method == "tools/call":
        params = request.get("params", {})
        result = call_pm_tool(str(params.get("name", "")), dict(params.get("arguments", {})))
        return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [_json_text(result)]}}
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {"code": -32601, "message": f"Method not found: {method}"}
    }


def serve_stdio() -> int:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}}
        else:
            response = handle_request(request)
        if response is not None:
            sys.stdout.write(json.dumps(response, separators=(",", ":")) + "\n")
            sys.stdout.flush()
    return 0


def main() -> int:
    return serve_stdio()


if __name__ == "__main__":
    raise SystemExit(main())

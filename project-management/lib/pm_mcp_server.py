"""Minimal stdio MCP server for the localized project-management workspace."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from pm_store import PMStore

SERVER_INFO = {"name": "project-management", "version": "0.4.2"}


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
                    "title": {
                        "type": "string",
                        "description": "Title/summary of the issue. Required."
                    },
                    "description": {
                        "type": "string",
                        "description": "Detailed description of the issue."
                    },
                    "issue_type": {
                        "type": "string",
                        "description": "Type of the ticket (bug, story, task, epic). Defaults to 'task'."
                    },
                    "priority": {
                        "type": "string",
                        "description": "Priority (low, medium, high, critical). Defaults to 'medium'."
                    },
                    "epic_id": {
                        "type": "string",
                        "description": "ID of the parent epic (e.g., PM-1)."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "ID of the sprint (e.g., sprint-1) or 'backlog'."
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_issue_update",
            "description": "Update an existing ticket (change status, description, priority, add comments, etc.).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Issue ID (e.g. PM-12). Required."
                    },
                    "title": {
                        "type": "string",
                        "description": "New title/summary."
                    },
                    "description": {
                        "type": "string",
                        "description": "New description."
                    },
                    "status": {
                        "type": "string",
                        "description": "New status (TODO, IN_PROGRESS, REVIEW, DONE)."
                    },
                    "priority": {
                        "type": "string",
                        "description": "New priority."
                    },
                    "epic_id": {
                        "type": "string",
                        "description": "New parent epic ID (or null to clear)."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "New sprint ID (e.g., sprint-1, or null for backlog)."
                    },
                    "comment": {
                        "type": "string",
                        "description": "Comment to append to the issue."
                    }
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
            "description": "Manage sprint lifecycle: create, start, complete sprints, or list sprints. Usage: /pm:sprint <action> [sprint_id/name]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "description": "Lifecycle action: 'create', 'start', 'complete', or 'list'. Required.",
                        "enum": ["create", "start", "complete", "list"]
                    },
                    "name": {
                        "type": "string",
                        "description": "Sprint name (required for action='create')."
                    },
                    "goal": {
                        "type": "string",
                        "description": "Sprint goal (optional for action='create')."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "Sprint ID (required for action='start' or 'complete', e.g. 'sprint-1')."
                    }
                },
                "required": ["action"]
            }
        },
        {
            "name": "pm_doc_create",
            "description": "Create a new wiki/confluence documentation page. Usage: /pm:doc create <title> [--content BODY] [--parent ID]",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {
                        "type": "string",
                        "description": "Title of the document page. Required."
                    },
                    "content": {
                        "type": "string",
                        "description": "Markdown body content of the document."
                    },
                    "parent_id": {
                        "type": "string",
                        "description": "Optional parent document ID for hierarchical wiki pages (e.g. DOC-1)."
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_doc_update",
            "description": "Update title, body content, or parent page for a wiki document.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Document ID (e.g. DOC-3). Required."
                    },
                    "title": {
                        "type": "string",
                        "description": "New title."
                    },
                    "content": {
                        "type": "string",
                        "description": "New markdown body content."
                    },
                    "parent_id": {
                        "type": "string",
                        "description": "New parent document ID (or null to make root)."
                    }
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_doc_get",
            "description": "View the markdown content and metadata of a specific wiki page.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string",
                        "description": "Document ID (e.g. DOC-3). Required."
                    }
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_doc_list",
            "description": "List all documentation wiki pages or search content.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Text search query on ID, title, or body."
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
        )
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_update":
        issue_id = arguments["id"]
        # build updates dictionary
        updates = {}
        for field in ["title", "description", "issue_type", "priority", "epic_id", "sprint_id"]:
            if field in arguments:
                # Handle renaming from 'issue_type' arg to 'type' field in model
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
            sprint = store.create_sprint(name=name_val, goal=arguments.get("goal", ""))
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
            parent_id=arguments.get("parent_id")
        )
        return {"ok": True, "document": doc}

    elif name == "pm_doc_update":
        doc_id = arguments["id"]
        updates = {}
        for field in ["title", "content", "parent_id"]:
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
        docs = store.list_docs(query=arguments.get("query"))
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
        from_issue = store.get_issue(from_id)
        to_issue = store.get_issue(to_id)
        if not from_issue:
            return {"ok": False, "error": f"Issue {from_id} not found."}
        if not to_issue:
            return {"ok": False, "error": f"Issue {to_id} not found."}
        # Store link in description suffix (lightweight — no schema change required)
        existing = from_issue.get("description", "")
        link_line = f"\n\n[Link] {link_type}: {to_id} ({to_issue['title']})"
        if link_line.strip() not in existing:
            store.update_issue(from_id, updates={"description": existing + link_line})
        return {"ok": True, "link": {"from": from_id, "to": to_id, "type": link_type}}

    elif name == "pm_issue_get_transitions":
        issue_id = arguments["id"]
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        status = issue.get("status", "TODO")
        allowed: Dict[str, List[str]] = {
            "TODO":        ["IN_PROGRESS"],
            "IN_PROGRESS": ["TODO", "REVIEW", "DONE"],
            "REVIEW":      ["IN_PROGRESS", "DONE"],
            "DONE":        ["REVIEW"],
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
            "IN_PROGRESS": ["TODO", "REVIEW", "DONE"],
            "REVIEW":      ["IN_PROGRESS", "DONE"],
            "DONE":        ["REVIEW"],
        }
        if new_status not in allowed.get(current, []):
            return {
                "ok": False,
                "error": f"Cannot transition from {current} to {new_status}. Allowed: {allowed.get(current, [])}",
                "hint": "Call pm_issue_get_transitions to see valid next states."
            }
        updates: Dict[str, Any] = {"status": new_status}
        result = store.update_issue(issue_id, updates=updates, comment=comment)
        return {"ok": True, "issue": result, "transitioned": f"{current} -> {new_status}"}

    elif name == "pm_issue_remote_link":
        issue_id = arguments["id"]
        url = arguments["url"]
        title = arguments.get("title") or url
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        existing = issue.get("description", "")
        link_line = f"\n\n[External] [{title}]({url})"
        if url not in existing:
            store.update_issue(issue_id, updates={"description": existing + link_line})
        return {"ok": True, "remote_link": {"url": url, "title": title, "issue_id": issue_id}}

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

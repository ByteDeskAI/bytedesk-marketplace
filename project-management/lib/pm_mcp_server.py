"""Minimal stdio MCP server for the localized project-management workspace."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

from pm_store import PMStore

SERVER_INFO = {"name": "project-management", "version": "0.2.0"}


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
                    "assignee": {
                        "type": "string",
                        "description": "Name of the user assigned to this ticket."
                    },
                    "epic_id": {
                        "type": "string",
                        "description": "ID of the parent epic (e.g., PM-1)."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "ID of the sprint (e.g., sprint-1) or 'backlog'."
                    },
                    "story_points": {
                        "type": "integer",
                        "description": "Complexity estimate in story points."
                    }
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_issue_update",
            "description": "Update an existing ticket (change status, description, assignee, priority, add comments, etc.).",
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
                    "assignee": {
                        "type": "string",
                        "description": "New assignee name (or null to unassign)."
                    },
                    "epic_id": {
                        "type": "string",
                        "description": "New parent epic ID (or null to clear)."
                    },
                    "sprint_id": {
                        "type": "string",
                        "description": "New sprint ID (e.g., sprint-1, or null for backlog)."
                    },
                    "story_points": {
                        "type": "integer",
                        "description": "New story points count."
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
            "description": "List and search tickets filtered by status, sprint, assignee, priority, type, or query.",
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
                    "assignee": {
                        "type": "string",
                        "description": "Filter by assignee name."
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
        }
    ]


def _json_text(value: Any) -> Dict[str, str]:
    return {"type": "text", "text": json.dumps(value, indent=2, sort_keys=True)}


def call_pm_tool(name: str, arguments: Dict[str, Any]) -> Any:
    # Auto-resolve workspace path unless initializing a specific folder
    workspace_override = arguments.get("workspace_path")
    store = PMStore(workspace_override)

    # Allow initializing even if not already active
    if name == "pm_init":
        project_name = arguments.get("project_name", "Local Project")
        key_prefix = arguments.get("key_prefix", "PM")
        path = store.init_workspace(project_name, key_prefix)
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
            assignee=arguments.get("assignee"),
            epic_id=arguments.get("epic_id"),
            sprint_id=arguments.get("sprint_id"),
            story_points=arguments.get("story_points")
        )
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_update":
        issue_id = arguments["id"]
        # build updates dictionary
        updates = {}
        for field in ["title", "description", "issue_type", "priority", "assignee", "epic_id", "sprint_id", "story_points"]:
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
            assignee=arguments.get("assignee"),
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
        sp_completed = 0
        sp_total = 0
        for t in sprint_tickets:
            stat = t.get("status", "TODO").upper()
            if stat not in board:
                stat = "TODO"
            board[stat].append(f"{t['id']} ({t['title']})")
            pts = t.get("story_points") or 0
            sp_total += pts
            if stat == "DONE":
                sp_completed += pts

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
                "story_points_completed": sp_completed,
                "story_points_total": sp_total,
                "story_points_percent": int(sp_completed / sp_total * 100) if sp_total > 0 else 0,
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

"""Minimal stdio MCP server for the localized project-management workspace."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from pm_store import PMStore

SERVER_INFO = {"name": "project-management", "version": "0.9.0"}


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
                    "acceptance_criteria": {"type": "array", "items": {"type": "string"}, "description": "List of acceptance criteria strings. Claude marks these done as it implements."},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "List of free-form tags (e.g. ['auth', 'security'])."},
                    "assignee": {"type": "string", "description": "Assignee name or identifier."},
                    "pinned": {"type": "boolean", "description": "Pin this ticket to the top of its column."},
                    "weight": {"type": "integer", "description": "Priority weight within same priority band (0=highest, 100=lowest). Defaults to 50."}
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
                    "comment": {"type": "string", "description": "Comment to append to the issue."},
                    "tags": {"type": "array", "items": {"type": "string"}, "description": "Replace tags list."},
                    "assignee": {"type": "string", "description": "New assignee (or null to clear)."},
                    "pinned": {"type": "boolean", "description": "Pin/unpin the ticket."},
                    "weight": {"type": "integer", "description": "Priority weight."}
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
        # ── v0.7.0 new tools ─────────────────────────────────────────────────
        {
            "name": "pm_issue_checkin",
            "description": "Record a mid-session progress checkpoint on an issue (0–100%). Call this after completing each major sub-task within a session. Updates the progress bar visible on the Board card and writes a checkin event to the activity feed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "progress_pct": {"type": "integer", "description": "Progress percentage 0–100. Required."},
                    "what_done": {"type": "string", "description": "One-line summary of what was just completed. Required."},
                    "what_remains": {"type": "string", "description": "What still needs to be done."}
                },
                "required": ["id", "progress_pct", "what_done"]
            }
        },
        {
            "name": "pm_issue_split",
            "description": "Split an overgrown ticket into N smaller, independent child tickets. Each part inherits the parent's epic, sprint, and remote_links. The original ticket is closed with a 'Split into...' comment. Use when a ticket has >6 acceptance criteria or when pm_issue_estimate_tokens returns >80k.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Source issue ID to split. Required."},
                    "parts": {
                        "type": "array",
                        "description": "List of split parts. Required.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "title": {"type": "string"},
                                "description": {"type": "string"},
                                "criteria_indices": {"type": "array", "items": {"type": "integer"}, "description": "0-based indices of acceptance criteria to move to this part."},
                                "scope": {"type": "string"},
                                "epic_id": {"type": "string"},
                                "sprint_id": {"type": "string"}
                            },
                            "required": ["title"]
                        }
                    }
                },
                "required": ["id", "parts"]
            }
        },
        {
            "name": "pm_issue_summarize_thread",
            "description": "Compress an issue's comment thread when it has grown too long (>15 comments). Archives older comments into a summary block, keeps the 2 most recent. Reduces context bloat for future Claude sessions reading the ticket.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_standup",
            "description": "Generate an async standup summary covering the last N hours: tickets moved to DONE/REVIEW, tickets currently IN_PROGRESS with last session summary, NEEDS_INPUT tickets, and newly created tickets. Use instead of a standup meeting.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since_hours": {"type": "integer", "description": "Hours to look back. Defaults to 24."},
                    "sprint_id": {"type": "string", "description": "Scope to a specific sprint. Defaults to active sprint."}
                }
            }
        },
        {
            "name": "pm_changelog_generate",
            "description": "Generate a user-facing CHANGELOG entry from DONE tickets in a sprint or date range. Groups by type (bug→Fixed, story/task→Added, refactor→Changed). Creates a 'brief' doc. Call at the end of each sprint before releasing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint to summarise. Defaults to last completed sprint."},
                    "version": {"type": "string", "description": "Version string for the changelog header (e.g. v1.2.0)."},
                    "since_date": {"type": "string", "description": "ISO date — alternative to sprint_id."}
                }
            }
        },
        {
            "name": "pm_epic_progress_report",
            "description": "Return a structured progress snapshot for a specific epic: child counts by status, % complete, cumulative session count, scope distribution, and timeline of recent status changes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "epic_id": {"type": "string", "description": "Epic issue ID. Required."}
                },
                "required": ["epic_id"]
            }
        },
        {
            "name": "pm_knowledge_extract",
            "description": "Scan session_summaries from the last N days, identify recurring decisions and patterns, and propose new 'learning' docs to create. Returns a list of suggested docs — call pm_doc_create to accept each one.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since_days": {"type": "integer", "description": "Days to scan back. Defaults to 7."},
                    "auto_create": {"type": "boolean", "description": "If true, automatically create the suggested learning docs. Defaults to false."}
                }
            }
        },
        {
            "name": "pm_issue_estimate_tokens",
            "description": "Estimate the Claude context token count for a ticket's implementation prompt — description, acceptance criteria, linked ADRs, session summaries. Returns a budget signal: low (<20k), medium (20-60k), high (>60k). Use before spawning a session to decide if the ticket needs splitting first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_goal_check",
            "description": "Mid-sprint health check: assesses whether completed and in-progress tickets are advancing the sprint goal, flags off-goal tickets (scope creep), and identifies goal-critical tickets not yet started. Returns a 0-100 goal relevance score.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint ID to evaluate. Defaults to active sprint."}
                }
            }
        },
        {
            "name": "pm_diff_review",
            "description": "Verify whether a git diff satisfies a ticket's acceptance criteria. Returns per-criterion verdict: Met / Not Met / Uncertain, with specific diff evidence. If criteria are not met, proposes a follow-up ticket. Run before marking a ticket DONE.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID to check against. Required."},
                    "diff": {"type": "string", "description": "Git diff text. If omitted, runs 'git diff HEAD~1' automatically."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_smart_assign_sprint",
            "description": "Assign backlog tickets to a sprint using dependency-aware packing: topological sort (blocked tickets after their dependencies), scope budget (default 20 scope-units/week), and epic grouping. Calls pm_issue_update for each selected ticket.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Target sprint ID. Required."},
                    "max_scope_units": {"type": "integer", "description": "Max scope units to assign (nano=1, small=2, medium=4, large=8, research=3). Defaults to 20."},
                    "epic_ids": {"type": "array", "items": {"type": "string"}, "description": "Only consider tickets under these epics."}
                },
                "required": ["sprint_id"]
            }
        },
        {
            "name": "pm_template_create",
            "description": "Save a ticket template for reuse. Templates store a default title, description skeleton, type, scope, and acceptance criteria. Apply with pm_template_apply.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Template name (e.g. 'bug-report', 'api-endpoint'). Required."},
                    "fields": {
                        "type": "object",
                        "description": "Default field values: title, description, issue_type, priority, scope, acceptance_criteria.",
                        "properties": {
                            "title": {"type": "string"},
                            "description": {"type": "string"},
                            "issue_type": {"type": "string"},
                            "priority": {"type": "string"},
                            "scope": {"type": "string"},
                            "acceptance_criteria": {"type": "array", "items": {"type": "string"}}
                        }
                    }
                },
                "required": ["name", "fields"]
            }
        },
        {
            "name": "pm_template_list",
            "description": "List all saved ticket templates.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_template_apply",
            "description": "Create a ticket from a named template, with optional field overrides. Returns the created issue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Template name. Required."},
                    "overrides": {"type": "object", "description": "Field values that override the template defaults."}
                },
                "required": ["name"]
            }
        },
        {
            "name": "pm_template_delete",
            "description": "Delete a saved ticket template.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Template name. Required."}
                },
                "required": ["name"]
            }
        },
        {
            "name": "pm_filter_create",
            "description": "Save a named issue filter (up to 8). Filters appear as chip pills in the Board and Backlog toolbar. Criteria: status, issue_type, priority, scope, query, sprint_id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Filter name (e.g. 'Critical bugs', 'Sprint 1 blockers'). Required."},
                    "criteria": {
                        "type": "object",
                        "description": "Filter criteria fields.",
                        "properties": {
                            "status": {"type": "string"},
                            "issue_type": {"type": "string"},
                            "priority": {"type": "string"},
                            "scope": {"type": "string"},
                            "query": {"type": "string"},
                            "sprint_id": {"type": "string"}
                        }
                    }
                },
                "required": ["name", "criteria"]
            }
        },
        {
            "name": "pm_filter_list",
            "description": "List all saved issue filters.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_filter_delete",
            "description": "Delete a saved issue filter by name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Filter name. Required."}
                },
                "required": ["name"]
            }
        },
        {
            "name": "pm_watch_ci",
            "description": "Register a CI watcher for a ticket → GitHub PR URL. The dashboard server polls gh pr view every 60s. On CI success + PR merged: auto-transitions ticket to DONE. On CI failure: adds comment and moves ticket back to IN_PROGRESS. Uses the gh CLI — must be authenticated.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID to watch. Required."},
                    "pr_url": {"type": "string", "description": "GitHub PR URL (e.g. https://github.com/org/repo/pull/42). Required."},
                    "unwatch": {"type": "boolean", "description": "Set true to remove an existing watcher instead of adding."}
                },
                "required": ["id", "pr_url"]
            }
        },
        {
            "name": "pm_agent_pool",
            "description": "Spawn parallel Claude sessions for all pending child tickets of an epic — executing independent tasks concurrently and sequencing blocked ones. Returns session_keys for all spawned agents. Requires tmux. The Board shows live multi-session status.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "epic_id": {"type": "string", "description": "Epic issue ID. Required."},
                    "max_parallel": {"type": "integer", "description": "Maximum concurrent sessions. Defaults to 3."}
                },
                "required": ["epic_id"]
            }
        },
        # ── v0.8.0 new tools ─────────────────────────────────────────────────
        {
            "name": "pm_issue_assign",
            "description": "Assign a ticket to a person or agent. Stores the assignee name on the issue and shows an avatar on the Board card.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "assignee": {"type": "string", "description": "Assignee name or identifier. Pass null or empty string to clear."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_pin",
            "description": "Pin or unpin a ticket to the top of its Board column. Pinned tickets always render first, separated by a divider. Use to surface the most critical ticket in a sprint.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "pinned": {"type": "boolean", "description": "True to pin, false to unpin. Defaults to true."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_weight",
            "description": "Set the priority weight for an issue within its priority band (0=highest urgency, 100=lowest). The Backlog sorts by priority then weight ASC. Use to express 'PM-12 before PM-17' within the same priority level.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "weight": {"type": "integer", "description": "Weight 0-100. Lower = higher priority within band. Required."}
                },
                "required": ["id", "weight"]
            }
        },
        {
            "name": "pm_issue_reopen",
            "description": "Reopen a DONE or REVIEW ticket with a reason. Transitions back to TODO, increments reopen_count, and adds a comment. Use when a regression is found or requirements changed after close.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "reason": {"type": "string", "description": "Why the ticket is being reopened. Required."},
                    "reporter": {"type": "string", "description": "Who found the regression. Defaults to current git user."}
                },
                "required": ["id", "reason"]
            }
        },
        {
            "name": "pm_session_abort",
            "description": "Structured session abort - call when you hit an unresolvable blocker (missing credentials, broken dependency, conflicting architecture). Resets ticket to TODO, records what was attempted and the codebase state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "reason": {"type": "string", "description": "Why the session cannot continue. Required."},
                    "what_was_attempted": {"type": "string", "description": "What you tried before giving up."},
                    "codebase_state": {"type": "string", "enum": ["clean", "changes_made"], "description": "Whether the working tree has uncommitted changes. Required for human to know if revert is needed."}
                },
                "required": ["id", "reason"]
            }
        },
        {
            "name": "pm_session_handoff",
            "description": "Record a mid-session handoff when you cannot continue due to context limits. Stores next_step so the next session can resume exactly where you stopped without re-exploring the codebase.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "next_step": {"type": "string", "description": "The specific next action the next session should take (file path, function name, line number). Required."},
                    "files_in_progress": {"type": "array", "items": {"type": "string"}, "description": "Files currently being modified."},
                    "partial_criteria_done": {"type": "array", "items": {"type": "integer"}, "description": "0-based indices of criteria already met."}
                },
                "required": ["id", "next_step"]
            }
        },
        {
            "name": "pm_issue_checklist_set",
            "description": "Set the human-operated checklist on an issue (distinct from AI-owned acceptance_criteria). Use for operational steps the human needs to complete: deploy to staging, notify design, update runbook.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "items": {
                        "type": "array",
                        "description": "Checklist items.",
                        "items": {"type": "object", "properties": {"text": {"type": "string"}, "done": {"type": "boolean"}}, "required": ["text"]}
                    }
                },
                "required": ["id", "items"]
            }
        },
        {
            "name": "pm_issue_checklist_check",
            "description": "Mark a checklist item done or undone by its 0-based index.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "index": {"type": "integer", "description": "0-based checklist item index. Required."},
                    "done": {"type": "boolean", "description": "True to mark done, false to unmark. Required."}
                },
                "required": ["id", "index", "done"]
            }
        },
        {
            "name": "pm_issue_risk_flag",
            "description": "Flag an issue as carrying technical risk. Risk-flagged tickets show a red warning badge on the Board card and require a pm_diff_review before moving to DONE. Types: security, data_loss, breaking_change, external_integration, compliance.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "risk_type": {"type": "string", "enum": ["security", "data_loss", "breaking_change", "external_integration", "compliance"], "description": "Risk category. Required."},
                    "reason": {"type": "string", "description": "Why this ticket carries risk. Required."}
                },
                "required": ["id", "risk_type", "reason"]
            }
        },
        {
            "name": "pm_issue_batch_update",
            "description": "Apply the same field updates to multiple issues atomically. Use when reassigning a sprint, bulk-changing priority, or setting scope on a set of tickets.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {"type": "array", "items": {"type": "string"}, "description": "List of issue IDs to update. Required."},
                    "updates": {
                        "type": "object",
                        "description": "Fields to update on all issues (same fields as pm_issue_update).",
                        "properties": {
                            "status": {"type": "string"},
                            "priority": {"type": "string"},
                            "scope": {"type": "string"},
                            "sprint_id": {"type": "string"},
                            "epic_id": {"type": "string"},
                            "assignee": {"type": "string"},
                            "weight": {"type": "integer"},
                            "tags": {"type": "array", "items": {"type": "string"}}
                        }
                    }
                },
                "required": ["ids", "updates"]
            }
        },
        {
            "name": "pm_issue_duplicate_detect",
            "description": "Check if similar issues already exist before creating a new one. Returns ranked list of existing tickets by title and description similarity. Call before pm_issue_create to avoid duplicates.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Proposed ticket title. Required."},
                    "description": {"type": "string", "description": "Optional proposed description for better matching."}
                },
                "required": ["title"]
            }
        },
        {
            "name": "pm_velocity_forecast",
            "description": "Project forward based on the last N completed sprints: average tickets done, scope units completed, sessions per ticket. Returns estimated sprints and weeks to clear the current backlog.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprints_back": {"type": "integer", "description": "How many completed sprints to average over. Defaults to 3."}
                }
            }
        },
        {
            "name": "pm_sprint_compare",
            "description": "Compare two completed sprints side by side: tickets done, scope distribution, sessions per ticket, NEEDS_INPUT count, reopens. Helps measure whether process improvements are working.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_a": {"type": "string", "description": "First sprint ID. Required."},
                    "sprint_b": {"type": "string", "description": "Second sprint ID. Required."}
                },
                "required": ["sprint_a", "sprint_b"]
            }
        },
        {
            "name": "pm_board_export",
            "description": "Export current board state as markdown table, JSON snapshot, or a brief doc. Use when sharing sprint status in a PR description or with stakeholders.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "format": {"type": "string", "enum": ["markdown", "json", "doc"], "description": "Export format. Defaults to markdown."},
                    "sprint_id": {"type": "string", "description": "Scope to a specific sprint. Defaults to active sprint."}
                }
            }
        },
        {
            "name": "pm_qa_checklist",
            "description": "Pre-implementation quality gate: score a ticket 0-100 before running a session. Checks description completeness, acceptance criteria count, scope set, ADR links, token estimate. Returns score, grade, and specific improvement actions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_cost_report",
            "description": "Aggregate session cost analytics: total estimated tokens and sessions per ticket, sprint, or epic. Identifies most expensive tickets and compares to prior sprint. Use to understand where AI budget was spent.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Scope to a sprint."},
                    "epic_id": {"type": "string", "description": "Scope to an epic."}
                }
            }
        },
        {
            "name": "pm_issue_health_score",
            "description": "Compute a 0-100 health score for a ticket: spec quality (description + criteria), implementation stability (reopens + retries), freshness (days since update), progress. Returns grade A-F and top improvement action.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_workload_balance",
            "description": "Check the health of all in-flight sessions for an epic's children. Detects stuck sessions (low progress after many retries), flagged tickets, and sessions that may be off-track.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "epic_id": {"type": "string", "description": "Epic to check. Required."}
                },
                "required": ["epic_id"]
            }
        },
        {
            "name": "pm_sprint_goal_set",
            "description": "Update the sprint goal on an active or planned sprint. Lighter-weight than pm_sprint_manage - just updates the goal text and logs the change. The Board header becomes inline-editable.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint ID. Required."},
                    "goal": {"type": "string", "description": "New sprint goal text. Required."}
                },
                "required": ["sprint_id", "goal"]
            }
        },
        {
            "name": "pm_code_context",
            "description": "Discover the most relevant codebase files for a ticket using git grep and commit history. Returns an ordered list of files to read first. Call at session start instead of manually exploring the codebase.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "max_files": {"type": "integer", "description": "Maximum files to return. Defaults to 10."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_dependency_path",
            "description": "Find the shortest is-blocked-by chain from an issue to its root blockers. Returns the blocking chain in order so you know what to unblock first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID to trace from. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_auto_link_pr",
            "description": "Scan recent GitHub PRs for mentions of ticket IDs matching this workspace's key prefix and auto-link them via pm_issue_remote_link. Eliminates manual PR linking.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "repo": {"type": "string", "description": "GitHub repo in owner/name format (e.g. 'acme/backend'). Required."},
                    "since_days": {"type": "integer", "description": "How many days back to scan. Defaults to 7."}
                },
                "required": ["repo"]
            }
        },
        {
            "name": "pm_epic_roadmap_sync",
            "description": "Update each epic's expected_completion_sprint and expected_completion_date based on where its latest non-DONE child is assigned. Call after pm_smart_assign_sprint to keep the roadmap current.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "epic_id": {"type": "string", "description": "Specific epic to sync. Omit to sync all epics."}
                }
            }
        },
        {
            "name": "pm_comment_reply",
            "description": "Reply to a specific comment on an issue, creating a threaded discussion. Use to respond to session summaries with follow-up questions or clarifications.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "parent_comment_id": {"type": "integer", "description": "ID of the comment to reply to. Required."},
                    "body": {"type": "string", "description": "Reply text. Required."},
                    "author": {"type": "string", "description": "Author name. Defaults to current git user."}
                },
                "required": ["id", "parent_comment_id", "body"]
            }
        },
        {
            "name": "pm_wip_limit_set",
            "description": "Set or clear a Work-In-Progress limit for a Board column. When exceeded, the column header shows an amber warning. Claude respects WIP limits when using pm_agent_pool.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "REVIEW", "DONE"], "description": "Column to limit. Required."},
                    "limit": {"type": "integer", "description": "Max tickets in this column. Set 0 to clear the limit. Required."}
                },
                "required": ["column", "limit"]
            }
        },
        {
            "name": "pm_session_template_create",
            "description": "Save a session prompt template that auto-prepends to implementation prompts when a ticket's type or tags match. Built-in starters: 'bug-fix', 'security-review', 'api-endpoint'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Template name (e.g. 'bug-fix'). Required."},
                    "prompt_prefix": {"type": "string", "description": "Text prepended to the session prompt when this template matches. Required."},
                    "match_types": {"type": "array", "items": {"type": "string"}, "description": "Issue types to match (bug, task, story, epic)."},
                    "match_tags": {"type": "array", "items": {"type": "string"}, "description": "Tags to match."}
                },
                "required": ["name", "prompt_prefix"]
            }
        },
        {
            "name": "pm_session_template_list",
            "description": "List all saved session prompt templates.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_session_template_delete",
            "description": "Delete a saved session prompt template by name.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Template name. Required."}
                },
                "required": ["name"]
            }
        },
        {
            "name": "pm_session_quality_score",
            "description": "Score the most recent session on a ticket against behavioral rubric: called pm_issue_checkin (+20), called pm_session_attach (+25), linked commit (+15), updated criteria_done (+20), no reopen in 48h (+20). Returns 0-100 with missed behaviors.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_daily_briefing",
            "description": "Generate a forward-looking daily brief: sprint status + days remaining, recommended work order (top 3 tickets), NEEDS_INPUT queue, CI watch alerts, and sprint health summary.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_sprint_health_dashboard",
            "description": "Single-call sprint health cockpit: goal alignment score, days remaining, scope done vs remaining, WIP violations, NEEDS_INPUT queue, CI failures, stale tickets, cost burn. One scan answers all 'how are we doing?' questions.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint ID. Defaults to active sprint."}
                }
            }
        },
        {
            "name": "pm_sprint_theme_create",
            "description": "Create a strategic theme that spans multiple sprints (e.g. 'Security Hardening Q3', 'Developer Experience'). Themes appear as colored bands in the roadmap view.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Theme name. Required."},
                    "description": {"type": "string", "description": "What this theme is about."},
                    "color": {"type": "string", "description": "Hex color (e.g. '#0052CC'). Defaults to Jira blue."}
                },
                "required": ["name"]
            }
        },
        {
            "name": "pm_sprint_theme_list",
            "description": "List all sprint themes.",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_prioritize_backlog",
            "description": "Score and rank all backlog TODO tickets by: blocking leverage (unblocks most others), scope efficiency (small+goal-aligned ranks high), staleness boost (old tickets), and sprint goal keyword alignment. Returns ranked list with per-ticket reasoning.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_goal": {"type": "string", "description": "Sprint goal text to use for alignment scoring. Defaults to active sprint goal."},
                    "limit": {"type": "integer", "description": "Max tickets to return. Defaults to 20."}
                }
            }
        },
        {
            "name": "pm_issue_merge",
            "description": "Merge a duplicate ticket into another. Unions acceptance criteria, transfers comments and links, closes the source ticket with 'Merged into PM-X'. Use when pm_issue_duplicate_detect finds a near-duplicate.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "source_id": {"type": "string", "description": "Ticket to merge FROM (will be closed). Required."},
                    "target_id": {"type": "string", "description": "Ticket to merge INTO (will receive all data). Required."}
                },
                "required": ["source_id", "target_id"]
            }
        },
        # ── v0.9.0 new tools ─────────────────────────────────────────────────
        {
            "name": "pm_issue_snapshot",
            "description": "Take a full point-in-time snapshot of an issue's complete state. Call before risky implementations to create a restore point. Snapshots are stored in .pm/snapshots/ and can be listed and restored.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "label": {"type": "string", "description": "Optional label for this snapshot (e.g. 'before auth refactor')."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_snapshot_list",
            "description": "List all saved snapshots for an issue, newest first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_issue_snapshot_restore",
            "description": "Restore an issue to a previously saved snapshot state. All fields (description, acceptance criteria, status, comments, etc.) revert to the snapshot moment.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "snapshot_id": {"type": "string", "description": "Snapshot ID from pm_issue_snapshot_list. Required."}
                },
                "required": ["id", "snapshot_id"]
            }
        },
        {
            "name": "pm_board_sort_set",
            "description": "Set the sort mode for a Board column. Modes: creation (default), priority (critical first), weight (lower weight first), updated (newest activity first), scope (small first), sessions (least-worked first).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "column": {"type": "string", "enum": ["TODO", "IN_PROGRESS", "REVIEW", "DONE"], "description": "Column to configure. Required."},
                    "mode": {"type": "string", "enum": ["creation", "priority", "weight", "updated", "scope", "sessions"], "description": "Sort mode. Required."}
                },
                "required": ["column", "mode"]
            }
        },
        {
            "name": "pm_issue_estimate_scope",
            "description": "AI-suggest a scope (nano/small/medium/large/research) for a ticket based on acceptance criteria count, description complexity, linked ADRs, and analogous historical tickets. Returns recommendation with confidence and reasoning.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_sprint_simulation",
            "description": "Simulate a proposed sprint before committing: estimate total sessions needed, flag dependency conflicts, identify WIP violations, compute completion probability 0–100. Use in the Plan view before confirming a sprint.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ticket_ids": {"type": "array", "items": {"type": "string"}, "description": "List of ticket IDs to simulate. Required."},
                    "duration_days": {"type": "integer", "description": "Sprint duration. Defaults to 7."}
                },
                "required": ["ticket_ids"]
            }
        },
        {
            "name": "pm_codebase_health",
            "description": "Git-based codebase health from the PM perspective: high-churn files (in 3+ ticket commit_links), orphan commits (not linked to any ticket), silent implementations (DONE tickets with sessions but no commit_links).",
            "inputSchema": {"type": "object", "properties": {}}
        },
        {
            "name": "pm_issue_acceptance_auto",
            "description": "Retroactively generate acceptance criteria from an issue's implementation record (session summaries, commits, files changed). Useful for DONE tickets with empty criteria. Returns proposed criteria for review.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID (should be DONE or REVIEW). Required."},
                    "auto_apply": {"type": "boolean", "description": "If true, immediately writes the generated criteria. Defaults to false (returns for review)."}
                },
                "required": ["id"]
            }
        },
        {
            "name": "pm_workspace_analytics",
            "description": "Comprehensive productivity analytics: tickets created/closed per week, session quality distribution, cost per scope, average time-in-status, most reopened tickets, best/worst sprint by completion. Returns data suitable for dashboard visualization.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since_date": {"type": "string", "description": "ISO date to filter from. Defaults to 30 days ago."}
                }
            }
        },
        {
            "name": "pm_sprint_autopilot",
            "description": "Plan or check the state of sprint autopilot: returns the next N tickets ready to run (no blockers, within WIP limits), ordered by pm_prioritize_backlog score. Call sequentially after each session completes to drive the sprint forward. Pauses on NEEDS_INPUT tickets.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "sprint_id": {"type": "string", "description": "Sprint to autopilot. Defaults to active sprint."},
                    "max_parallel": {"type": "integer", "description": "Max concurrent sessions. Defaults to 2."}
                }
            }
        },
        {
            "name": "pm_issue_debate",
            "description": "Set up a two-approach implementation comparison for a high-stakes ticket. Returns two structured prompts (approach A and B) for spawning separate sessions. After both complete, call again with judge=true to get a synthesis.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "description": "Issue ID. Required."},
                    "approach_a": {"type": "string", "description": "Description of approach A. Defaults to 'standard implementation'."},
                    "approach_b": {"type": "string", "description": "Description of approach B. Defaults to 'alternative implementation'."},
                    "judge": {"type": "boolean", "description": "If true, reads existing session summaries and produces a verdict. Call after both sessions complete."}
                },
                "required": ["id"]
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
            tags=arguments.get("tags"),
            assignee=arguments.get("assignee"),
            pinned=bool(arguments.get("pinned", False)),
            weight=int(arguments.get("weight", 50)),
        )
        return {"ok": True, "issue": issue}

    elif name == "pm_issue_update":
        issue_id = arguments["id"]
        updates = {}
        for field in ["title", "description", "issue_type", "priority", "epic_id", "sprint_id",
                      "scope", "acceptance_criteria", "criteria_done", "tags", "assignee", "pinned", "weight"]:
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

    # ── v0.7.0 tool handlers ──────────────────────────────────────────────────

    elif name == "pm_issue_checkin":
        issue_id = arguments["id"]
        try:
            entry = store.checkin_issue(
                issue_id=issue_id,
                progress_pct=int(arguments.get("progress_pct", 0)),
                what_done=arguments.get("what_done", ""),
                what_remains=arguments.get("what_remains", ""),
            )
            return {"ok": True, "checkin": entry, "issue_id": issue_id}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_split":
        issue_id = arguments["id"]
        parts = arguments.get("parts", [])
        if not parts:
            return {"ok": False, "error": "parts list is required and must be non-empty."}
        try:
            result = store.split_issue(issue_id, parts)
            return {"ok": True, "original_id": issue_id,
                    "child_ids": [c["id"] for c in result["children"]],
                    "children": result["children"]}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_summarize_thread":
        issue_id = arguments["id"]
        try:
            result = store.summarize_thread(issue_id)
            return result
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_standup":
        from datetime import timedelta
        since_hours = int(arguments.get("since_hours", 24))
        now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        cutoff = (now - timedelta(hours=since_hours)).isoformat()

        active_sprint_id = arguments.get("sprint_id") or store.get_active_sprint_id()
        all_issues = store.list_issues(sprint_id=active_sprint_id) if active_sprint_id else store.list_issues()
        config = store.get_project_config()

        recently_done: List[Dict[str, Any]] = []
        in_progress: List[Dict[str, Any]] = []
        needs_input: List[Dict[str, Any]] = []
        newly_created: List[Dict[str, Any]] = []

        for issue in all_issues:
            status = issue.get("status", "").upper()
            updated = issue.get("updated_at", "")
            created = issue.get("created_at", "")
            if status in ("DONE", "REVIEW") and updated >= cutoff:
                summaries = issue.get("session_summaries", [])
                recently_done.append({
                    "id": issue["id"], "title": issue["title"],
                    "status": status,
                    "last_summary": summaries[-1]["summary"][:200] if summaries else None,
                })
            elif status == "IN_PROGRESS":
                summaries = issue.get("session_summaries", [])
                in_progress.append({
                    "id": issue["id"], "title": issue["title"],
                    "progress": issue.get("progress", 0),
                    "last_checkin": issue.get("checkins", [{}])[-1].get("what_done") if issue.get("checkins") else None,
                    "last_summary": summaries[-1]["summary"][:200] if summaries else None,
                })
            elif status == "NEEDS_INPUT":
                needs_input.append({
                    "id": issue["id"], "title": issue["title"],
                    "reason": issue.get("flagged_reason", ""),
                })
            if created >= cutoff and status == "TODO":
                newly_created.append({"id": issue["id"], "title": issue["title"]})

        sprint_name = "No active sprint"
        if active_sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == active_sprint_id:
                    sprint_name = s.get("name", active_sprint_id)
                    break

        markdown = (
            f"# Standup — {now.strftime('%Y-%m-%d')}\n"
            f"**Sprint:** {sprint_name}\n\n"
            f"## ✅ Done / Review (last {since_hours}h) — {len(recently_done)} tickets\n"
            + "\n".join(f"- [{i['id']}] {i['title']}" + (f"\n  _{i['last_summary']}_" if i.get('last_summary') else "") for i in recently_done)
            + f"\n\n## 🔄 In Progress — {len(in_progress)} tickets\n"
            + "\n".join(f"- [{i['id']}] {i['title']} ({i['progress']}%)" + (f"\n  _{i['last_checkin']}_" if i.get('last_checkin') else "") for i in in_progress)
            + (f"\n\n## 🚫 Needs Input — {len(needs_input)} tickets\n" + "\n".join(f"- [{i['id']}] {i['title']}: {i['reason']}" for i in needs_input) if needs_input else "")
            + (f"\n\n## 🆕 New Today — {len(newly_created)} tickets\n" + "\n".join(f"- [{i['id']}] {i['title']}" for i in newly_created) if newly_created else "")
        )
        return {
            "ok": True,
            "markdown": markdown,
            "recently_done": recently_done,
            "in_progress": in_progress,
            "needs_input": needs_input,
            "newly_created": newly_created,
        }

    elif name == "pm_changelog_generate":
        sprint_id_arg = arguments.get("sprint_id")
        since_date = arguments.get("since_date")
        version = arguments.get("version", "vX.Y.Z")
        config = store.get_project_config()

        if not sprint_id_arg:
            sprints = config.get("sprints", [])
            closed = [s for s in sprints if s.get("status") == "CLOSED"]
            sprint_id_arg = closed[-1]["id"] if closed else None

        if sprint_id_arg:
            issues = store.list_issues(sprint_id=sprint_id_arg)
        elif since_date:
            issues = [i for i in store.list_issues() if i.get("updated_at", "") >= since_date]
        else:
            issues = store.list_issues()

        done = [i for i in issues if i.get("status") == "DONE"]
        added: List[str] = []
        fixed: List[str] = []
        changed: List[str] = []

        for issue in done:
            itype = issue.get("type", "task").lower()
            title = issue["title"]
            if itype == "bug":
                fixed.append(f"- {title} ({issue['id']})")
            elif itype in ("story", "epic"):
                added.append(f"- {title} ({issue['id']})")
            else:
                changed.append(f"- {title} ({issue['id']})")

        from datetime import date
        content = (
            f"## [{version}] — {date.today().isoformat()}\n\n"
            + (f"### Added\n\n" + "\n".join(added) + "\n\n" if added else "")
            + (f"### Changed\n\n" + "\n".join(changed) + "\n\n" if changed else "")
            + (f"### Fixed\n\n" + "\n".join(fixed) + "\n\n" if fixed else "")
        )
        doc = store.create_doc(
            title=f"CHANGELOG {version}",
            content=content,
            doc_type="brief",
        )
        return {"ok": True, "document": doc, "added": len(added), "changed": len(changed), "fixed": len(fixed)}

    elif name == "pm_epic_progress_report":
        epic_id = arguments["epic_id"].strip().upper()
        epic = store.get_issue(epic_id)
        if not epic:
            return {"ok": False, "error": f"Epic {epic_id} not found."}
        all_issues = store.list_issues()
        children = [i for i in all_issues if i.get("epic_id", "").upper() == epic_id]
        by_status: Dict[str, List[str]] = {"TODO": [], "IN_PROGRESS": [], "REVIEW": [], "DONE": [], "NEEDS_INPUT": []}
        total_sessions = 0
        scope_dist: Dict[str, int] = {}
        for child in children:
            st = child.get("status", "TODO").upper()
            by_status.setdefault(st, []).append(child["id"])
            total_sessions += len(child.get("session_summaries", []))
            sc = child.get("scope") or "unset"
            scope_dist[sc] = scope_dist.get(sc, 0) + 1
        done_count = len(by_status.get("DONE", []))
        pct = int(done_count / len(children) * 100) if children else 0
        return {
            "ok": True,
            "epic": {"id": epic["id"], "title": epic["title"], "status": epic.get("status")},
            "total_children": len(children),
            "by_status": {k: len(v) for k, v in by_status.items()},
            "percent_complete": pct,
            "total_sessions": total_sessions,
            "scope_distribution": scope_dist,
            "child_ids": [c["id"] for c in children],
        }

    elif name == "pm_knowledge_extract":
        from datetime import timedelta
        since_days = int(arguments.get("since_days", 7))
        auto_create = bool(arguments.get("auto_create", False))
        now_dt = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
        cutoff = (now_dt - timedelta(days=since_days)).isoformat()

        all_issues = store.list_issues()
        # Gather all session summaries newer than cutoff
        summaries: List[Dict[str, Any]] = []
        for issue in all_issues:
            for ss in issue.get("session_summaries", []):
                if ss.get("created_at", "") >= cutoff:
                    summaries.append({"issue_id": issue["id"], "title": issue["title"], **ss})

        if not summaries:
            return {"ok": True, "proposed_docs": [], "message": "No session summaries in the given window."}

        # Simple frequency analysis on files_changed
        from collections import Counter
        file_counter: Counter = Counter()
        for ss in summaries:
            for f in ss.get("files_changed", []):
                file_counter[f] += 1

        hot_files = [f for f, c in file_counter.most_common(5) if c >= 2]
        proposed_docs: List[Dict[str, Any]] = []

        if hot_files:
            proposed_docs.append({
                "suggested_title": f"Implementation Notes: {', '.join(hot_files[:2])}",
                "suggested_content": (
                    "## Overview\n\nFiles changed frequently across sessions:\n\n"
                    + "\n".join(f"- `{f}` (changed {file_counter[f]}×)" for f in hot_files)
                    + "\n\n## Key patterns\n\n_Fill in from session summaries._"
                ),
                "doc_type": "learning",
                "reason": f"Files {hot_files} were modified in {len(summaries)} sessions.",
            })

        if len(summaries) >= 3:
            proposed_docs.append({
                "suggested_title": f"Session Learning Digest — last {since_days}d",
                "suggested_content": (
                    f"## Sessions ({len(summaries)} total)\n\n"
                    + "\n\n".join(
                        f"### {ss['issue_id']}: {ss['title']}\n{ss['summary'][:300]}"
                        for ss in summaries[:5]
                    )
                ),
                "doc_type": "learning",
                "reason": f"Digest of {len(summaries)} session summaries.",
            })

        created_docs: List[Dict[str, Any]] = []
        if auto_create:
            for prop in proposed_docs:
                doc = store.create_doc(
                    title=prop["suggested_title"],
                    content=prop["suggested_content"],
                    doc_type=prop["doc_type"],
                )
                created_docs.append(doc)

        return {
            "ok": True,
            "proposed_docs": proposed_docs,
            "auto_created": created_docs,
            "summary_count": len(summaries),
            "hot_files": hot_files,
        }

    elif name == "pm_issue_estimate_tokens":
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        adrs = store.list_docs(doc_type="adr")
        accepted_adrs = [d for d in adrs if d.get("doc_status") in ("accepted", "")]

        # Rough token estimate: 1 token ≈ 4 chars
        def _tok(s: str) -> int:
            return max(1, len(s) // 4)

        components: Dict[str, int] = {
            "title": _tok(issue.get("title", "")),
            "description": _tok(issue.get("description", "")),
            "acceptance_criteria": _tok(" ".join(issue.get("acceptance_criteria") or [])),
            "session_summaries": sum(_tok(ss.get("summary", "")) for ss in issue.get("session_summaries", [])),
            "comments": sum(_tok(c.get("body", "")) for c in issue.get("comments", [])),
            "adr_digests": sum(_tok(d.get("title", "")) for d in accepted_adrs),
            "workspace_context": 500,  # fixed overhead estimate
        }
        total = sum(components.values())

        if total < 20_000:
            budget_signal = "low"
            recommendation = "Good to go — context fits comfortably."
        elif total < 60_000:
            budget_signal = "medium"
            recommendation = "Medium context load — session will work but may be slow on large models."
        else:
            budget_signal = "high"
            recommendation = "High context load — consider calling pm_issue_split before running this ticket."

        return {
            "ok": True,
            "issue_id": issue_id,
            "estimated_tokens": total,
            "budget_signal": budget_signal,
            "components": components,
            "recommendation": recommendation,
        }

    elif name == "pm_goal_check":
        active_sprint_id = arguments.get("sprint_id") or store.get_active_sprint_id()
        if not active_sprint_id:
            return {"ok": False, "error": "No active sprint. Pass sprint_id explicitly."}
        config = store.get_project_config()
        sprint = next((s for s in config.get("sprints", []) if s["id"] == active_sprint_id), None)
        if not sprint:
            return {"ok": False, "error": f"Sprint {active_sprint_id} not found."}
        goal = sprint.get("goal", "").lower()
        issues = store.list_issues(sprint_id=active_sprint_id)

        goal_words = set(goal.split()) if goal else set()

        def _relevance(issue: Dict[str, Any]) -> int:
            text = (issue.get("title", "") + " " + (issue.get("description") or "")).lower()
            return sum(1 for w in goal_words if w in text and len(w) > 3)

        scored = sorted(issues, key=_relevance, reverse=True)
        on_goal = [i for i in scored if _relevance(i) > 0]
        off_goal = [i for i in scored if _relevance(i) == 0 and i.get("status") not in ("DONE", "REVIEW")]
        not_started = [i for i in issues if i.get("status") == "TODO" and _relevance(i) > 0]

        total = len(on_goal) + len(off_goal) or 1
        score = int(len(on_goal) / total * 100)

        return {
            "ok": True,
            "sprint_id": active_sprint_id,
            "sprint_goal": sprint.get("goal"),
            "goal_relevance_score": score,
            "on_goal_tickets": [{"id": i["id"], "title": i["title"], "status": i.get("status")} for i in on_goal[:5]],
            "off_goal_tickets": [{"id": i["id"], "title": i["title"], "status": i.get("status")} for i in off_goal[:5]],
            "goal_critical_not_started": [{"id": i["id"], "title": i["title"]} for i in not_started],
            "assessment": f"{score}% of tickets align with the sprint goal." + (" Consider descoping off-goal work." if off_goal else ""),
        }

    elif name == "pm_diff_review":
        import subprocess as _sp
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        diff = arguments.get("diff")
        if not diff:
            try:
                result = _sp.run(["git", "diff", "HEAD~1"], capture_output=True, text=True, timeout=10)
                diff = result.stdout
            except Exception as e:
                return {"ok": False, "error": f"Could not run git diff: {e}"}
        criteria = issue.get("acceptance_criteria") or []
        if not criteria:
            return {"ok": False, "error": "Issue has no acceptance criteria to check against."}
        diff_lower = diff.lower()
        verdicts: List[Dict[str, Any]] = []
        unmet: List[str] = []
        for idx, criterion in enumerate(criteria):
            keywords = [w for w in criterion.lower().split() if len(w) > 3]
            matches = [kw for kw in keywords if kw in diff_lower]
            if len(matches) >= max(1, len(keywords) // 3):
                verdict = "Met"
            elif matches:
                verdict = "Uncertain"
            else:
                verdict = "Not Met"
                unmet.append(criterion)
            verdicts.append({"criterion": criterion, "verdict": verdict, "matching_keywords": matches})

        met_count = sum(1 for v in verdicts if v["verdict"] == "Met")
        follow_up = None
        if unmet:
            follow_up = {
                "suggested_title": f"Follow-up: unmet criteria from {issue_id}",
                "suggested_criteria": unmet,
                "instruction": "Call pm_issue_create with this data to create a follow-up ticket.",
            }
        return {
            "ok": True,
            "issue_id": issue_id,
            "criteria_count": len(criteria),
            "met_count": met_count,
            "verdicts": verdicts,
            "follow_up_ticket": follow_up,
            "overall": "Pass" if met_count == len(criteria) else ("Partial" if met_count > 0 else "Fail"),
        }

    elif name == "pm_smart_assign_sprint":
        sprint_id_target = arguments["sprint_id"].strip()
        max_units = int(arguments.get("max_scope_units", 20))
        filter_epics = [e.strip().upper() for e in (arguments.get("epic_ids") or [])]
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}

        backlog = store.list_issues(sprint_id="backlog")
        if filter_epics:
            backlog = [i for i in backlog if (i.get("epic_id") or "").upper() in filter_epics]

        # Topological sort by is-blocked-by
        def _blocked_by(issue: Dict[str, Any]) -> List[str]:
            return [lk["to_id"] for lk in issue.get("links", []) if lk.get("type") == "is-blocked-by"]

        resolved: set = set()
        ordered: List[Dict[str, Any]] = []
        remaining = list(backlog)
        for _ in range(len(remaining) + 1):
            if not remaining:
                break
            unblocked = [i for i in remaining if all(b in resolved for b in _blocked_by(i))]
            if not unblocked:
                ordered.extend(remaining)
                break
            ordered.extend(unblocked)
            for i in unblocked:
                resolved.add(i["id"])
            remaining = [i for i in remaining if i["id"] not in resolved]

        # Pack by scope budget
        assigned: List[Dict[str, Any]] = []
        units_used = 0
        for issue in ordered:
            w = scope_weights.get(issue.get("scope") or "", 2)
            if units_used + w <= max_units:
                assigned.append(issue)
                units_used += w

        for issue in assigned:
            store.update_issue(issue["id"], {"sprint_id": sprint_id_target})

        return {
            "ok": True,
            "sprint_id": sprint_id_target,
            "assigned_count": len(assigned),
            "scope_units_used": units_used,
            "scope_units_max": max_units,
            "assigned_ids": [i["id"] for i in assigned],
        }

    elif name == "pm_template_create":
        tmpl = store.create_template(arguments["name"], arguments.get("fields", {}))
        return {"ok": True, "template": tmpl}

    elif name == "pm_template_list":
        return {"ok": True, "templates": store.list_templates()}

    elif name == "pm_template_apply":
        try:
            issue = store.apply_template(arguments["name"], arguments.get("overrides"))
            return {"ok": True, "issue": issue}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_template_delete":
        removed = store.delete_template(arguments["name"])
        return {"ok": removed, "name": arguments["name"]}

    elif name == "pm_filter_create":
        f = store.create_filter(arguments["name"], arguments.get("criteria", {}))
        return {"ok": True, "filter": f}

    elif name == "pm_filter_list":
        return {"ok": True, "filters": store.list_filters()}

    elif name == "pm_filter_delete":
        removed = store.delete_filter(arguments["name"])
        return {"ok": removed, "name": arguments["name"]}

    elif name == "pm_watch_ci":
        issue_id = arguments["id"]
        pr_url = arguments["pr_url"]
        unwatch = bool(arguments.get("unwatch", False))
        if unwatch:
            removed = store.remove_ci_watcher(issue_id)
            return {"ok": True, "unwatched": removed, "issue_id": issue_id}
        entry = store.add_ci_watcher(issue_id, pr_url)
        return {"ok": True, "watcher": entry, "message": f"CI watcher registered for {issue_id} → {pr_url}"}

    elif name == "pm_agent_pool":
        epic_id = arguments["epic_id"].strip().upper()
        max_parallel = int(arguments.get("max_parallel", 3))
        epic = store.get_issue(epic_id)
        if not epic:
            return {"ok": False, "error": f"Epic {epic_id} not found."}
        all_issues = store.list_issues()
        children = [i for i in all_issues
                    if i.get("epic_id", "").upper() == epic_id
                    and i.get("status") not in ("DONE", "REVIEW")]
        if not children:
            return {"ok": True, "message": "No pending children found.", "spawned": []}

        # Topological sort respecting is-blocked-by links
        def _blocked_by(issue: Dict[str, Any]) -> List[str]:
            return [lk["to_id"] for lk in issue.get("links", []) if lk.get("type") == "is-blocked-by"]

        ready = [c for c in children if all(b not in [ch["id"] for ch in children] for b in _blocked_by(c))]
        to_spawn = ready[:max_parallel]

        # Return the context for the caller (pm_agent_pool is a planning tool;
        # actual session spawning happens via POST /api/run per child)
        return {
            "ok": True,
            "epic_id": epic_id,
            "total_pending": len(children),
            "ready_to_run": [c["id"] for c in ready],
            "spawning_now": [c["id"] for c in to_spawn],
            "blocked": [c["id"] for c in children if c not in ready],
            "instruction": (
                f"Spawn a session for each ticket in 'spawning_now' by calling POST /api/run for each. "
                f"Monitor them via GET /api/run/<id>. When one finishes, spawn the next from 'blocked' "
                f"if its blockers are now DONE. Max parallel: {max_parallel}."
            ),
        }

    # ── v0.9.0 tool handlers ──────────────────────────────────────────────────

    elif name == "pm_issue_snapshot":
        issue_id = arguments["id"]
        label = arguments.get("label", "")
        try:
            snap = store.take_snapshot(issue_id, label)
            return {"ok": True, "snapshot": snap}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_snapshot_list":
        issue_id = arguments["id"]
        snaps = store.list_snapshots(issue_id)
        return {"ok": True, "snapshots": snaps}

    elif name == "pm_issue_snapshot_restore":
        issue_id = arguments["id"]
        snapshot_id = arguments["snapshot_id"]
        try:
            issue = store.restore_snapshot(issue_id, snapshot_id)
            return {"ok": True, "issue": issue, "restored_from": snapshot_id}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_board_sort_set":
        column = arguments["column"]
        mode = arguments["mode"]
        result = store.set_board_sort(column, mode)
        return {"ok": True, "board_sort": result}

    elif name == "pm_issue_estimate_scope":
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        all_issues = store.list_issues()
        crit_count = len(issue.get("acceptance_criteria") or [])
        desc_len = len((issue.get("description") or "").strip())
        adrs = store.list_docs(doc_type="adr")
        linked_adrs = sum(1 for d in adrs if issue_id in (d.get("linked_issues") or []))
        # Find analogous historical tickets by type + rough desc length
        analogous = [i for i in all_issues
                     if i.get("status") == "DONE"
                     and i.get("type") == issue.get("type")
                     and abs(len((i.get("description") or "")) - desc_len) < 200
                     and i.get("scope")]
        analogous_scopes = [i["scope"] for i in analogous[:5]]
        if crit_count == 0 and desc_len < 50:
            recommended, confidence = "nano", 0.7
        elif crit_count <= 2 and desc_len < 200 and linked_adrs == 0:
            recommended, confidence = "small", 0.75
        elif crit_count <= 4 and linked_adrs <= 1:
            recommended, confidence = "medium", 0.72
        elif crit_count > 5 or linked_adrs > 2:
            recommended, confidence = "large", 0.70
        else:
            recommended, confidence = "medium", 0.65
        if analogous_scopes:
            mode_scope = max(set(analogous_scopes), key=analogous_scopes.count)
            if mode_scope != recommended:
                recommended = mode_scope
                confidence = max(0.5, confidence - 0.1)
            confidence = min(0.95, confidence + 0.05 * len(analogous_scopes))
        reasoning = (
            f"{crit_count} acceptance criteria, "
            f"description {desc_len} chars, "
            f"{linked_adrs} linked ADRs"
            + (f", {len(analogous)} analogous {issue.get('type')} tickets suggest {analogous_scopes[:3]}" if analogous else "")
        )
        return {
            "ok": True,
            "issue_id": issue_id,
            "recommended_scope": recommended,
            "confidence": round(confidence, 2),
            "reasoning": reasoning,
            "instruction": f"Call pm_issue_update(id='{issue_id}', scope='{recommended}') to apply.",
        }

    elif name == "pm_sprint_simulation":
        ticket_ids = [t.strip().upper() for t in arguments.get("ticket_ids", [])]
        duration_days = int(arguments.get("duration_days", 7))
        if not ticket_ids:
            return {"ok": False, "error": "ticket_ids is required."}
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}
        typical_sessions = {"nano": 1, "small": 1.5, "medium": 2.5, "large": 4, "research": 2}
        issues = [store.get_issue(tid) for tid in ticket_ids]
        found = [i for i in issues if i is not None]
        not_found = [tid for tid, i in zip(ticket_ids, issues) if i is None]
        total_scope = sum(scope_weights.get(i.get("scope") or "", 2) for i in found)
        est_sessions = sum(typical_sessions.get(i.get("scope") or "", 2) for i in found)
        dependency_conflicts: List[str] = []
        ticket_set = set(ticket_ids)
        for issue in found:
            for link in (issue.get("links") or []):
                if link.get("type") == "is-blocked-by" and link["to_id"] not in ticket_set:
                    blocker = store.get_issue(link["to_id"])
                    if blocker and blocker.get("status") not in ("DONE", "REVIEW"):
                        dependency_conflicts.append(f"{issue['id']} blocked by {link['to_id']} ({blocker.get('title','?')}) which is NOT in this sprint")
        scope_risk = 0
        if total_scope > 20:
            scope_risk += 30
        elif total_scope > 14:
            scope_risk += 15
        dep_risk = min(len(dependency_conflicts) * 15, 40)
        large_count = sum(1 for i in found if i.get("scope") == "large")
        large_risk = min(large_count * 10, 20)
        base_completion = max(10, 100 - scope_risk - dep_risk - large_risk)
        risk_factors = []
        if scope_risk:
            risk_factors.append(f"Total scope {total_scope} units exceeds recommended ~14/week")
        if dependency_conflicts:
            risk_factors.append(f"{len(dependency_conflicts)} dependency conflict(s)")
        if large_count:
            risk_factors.append(f"{large_count} large-scope ticket(s) with high session variance")
        return {
            "ok": True,
            "ticket_count": len(found),
            "not_found": not_found,
            "total_scope_units": total_scope,
            "estimated_sessions": round(est_sessions, 1),
            "dependency_conflicts": dependency_conflicts,
            "completion_probability": base_completion,
            "risk_factors": risk_factors,
            "recommendation": "Good to go" if base_completion >= 75 else ("Reduce scope or resolve dependencies" if base_completion >= 50 else "High risk — significant scope reduction recommended"),
        }

    elif name == "pm_codebase_health":
        import subprocess as _sp
        all_issues = store.list_issues()
        file_to_tickets: Dict[str, List[str]] = {}
        for issue in all_issues:
            for cl in (issue.get("commit_links") or []):
                sha = cl.get("sha", "")
                if not sha:
                    continue
                try:
                    result = _sp.run(["git", "diff-tree", "--no-commit-id", "-r", "--name-only", sha],
                                     capture_output=True, text=True, timeout=10)
                    for f in result.stdout.strip().splitlines():
                        file_to_tickets.setdefault(f, []).append(issue["id"])
                except Exception:
                    pass
        churn_files = sorted(
            [{"file": f, "ticket_count": len(set(tids)), "tickets": list(set(tids))}
             for f, tids in file_to_tickets.items() if len(set(tids)) >= 3],
            key=lambda x: x["ticket_count"], reverse=True
        )[:10]
        linked_shas: set = set()
        for issue in all_issues:
            for cl in (issue.get("commit_links") or []):
                sha = cl.get("sha", "")
                if sha:
                    linked_shas.add(sha[:7])
        orphan_commits: List[Dict[str, str]] = []
        try:
            result = _sp.run(["git", "log", "--oneline", "-50"], capture_output=True, text=True, timeout=10)
            for line in result.stdout.strip().splitlines():
                parts = line.split(" ", 1)
                if parts and parts[0] not in linked_shas:
                    orphan_commits.append({"sha": parts[0], "message": parts[1] if len(parts) > 1 else ""})
        except Exception:
            pass
        silent = [
            {"id": i["id"], "title": i["title"], "session_count": len(i.get("session_summaries") or [])}
            for i in all_issues
            if i.get("status") == "DONE"
            and len(i.get("session_summaries") or []) > 0
            and not i.get("commit_links")
        ]
        return {
            "ok": True,
            "high_churn_files": churn_files,
            "orphan_commits": orphan_commits[:10],
            "silent_implementations": silent,
            "summary": {
                "churn_file_count": len(churn_files),
                "orphan_commit_count": len(orphan_commits),
                "silent_implementation_count": len(silent),
            },
        }

    elif name == "pm_issue_acceptance_auto":
        issue_id = arguments["id"].strip().upper()
        auto_apply = bool(arguments.get("auto_apply", False))
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        summaries = issue.get("session_summaries") or []
        commit_links = issue.get("commit_links") or []
        if not summaries and not commit_links:
            return {"ok": False, "error": "No session summaries or commit links found to infer from."}
        inferred: List[str] = []
        for ss in summaries:
            summary_text = ss.get("summary", "")
            for sent in summary_text.replace(". ", "\n").split("\n"):
                sent = sent.strip()
                if len(sent) > 20 and any(w in sent.lower() for w in
                                          ("implement", "add", "create", "fix", "update", "refactor", "support", "enable")):
                    criterion = sent[:120]
                    if criterion not in inferred:
                        inferred.append(criterion)
            for f in (ss.get("files_changed") or [])[:3]:
                crit = f"Changes to `{f}` are correct and tested"
                if crit not in inferred:
                    inferred.append(crit)
            for t in (ss.get("tests_added") or [])[:3]:
                crit = f"Tests pass: `{t}`"
                if crit not in inferred:
                    inferred.append(crit)
        inferred = inferred[:6]
        if auto_apply and inferred:
            store.update_issue(issue_id, {"acceptance_criteria": inferred})
        return {
            "ok": True,
            "issue_id": issue_id,
            "inferred_criteria": inferred,
            "applied": auto_apply and bool(inferred),
            "instruction": "Review and call pm_issue_update with acceptance_criteria to apply." if not auto_apply else "Applied directly.",
        }

    elif name == "pm_workspace_analytics":
        from datetime import timedelta
        since_date_str = arguments.get("since_date")
        now_dt = datetime.now(timezone.utc)
        if since_date_str:
            try:
                since_dt = datetime.fromisoformat(since_date_str.replace("Z", "+00:00"))
            except Exception:
                since_dt = now_dt - timedelta(days=30)
        else:
            since_dt = now_dt - timedelta(days=30)
        since_iso = since_dt.isoformat()
        all_issues = store.list_issues()
        config = store.get_project_config()
        recent_issues = [i for i in all_issues if i.get("created_at", "") >= since_iso]
        done_recent = [i for i in all_issues if i.get("updated_at", "") >= since_iso and i.get("status") == "DONE"]
        total_sessions = sum(len(i.get("session_summaries") or []) for i in all_issues)
        def _tok(s: str) -> int:
            return max(1, len(s) // 4)
        total_tokens = sum(
            sum(_tok(ss.get("summary", "")) for ss in (i.get("session_summaries") or []))
            for i in all_issues
        )
        by_scope: Dict[str, Dict[str, float]] = {}
        for i in all_issues:
            sc = i.get("scope") or "unset"
            sessions = len(i.get("session_summaries") or [])
            tokens = sum(_tok(ss.get("summary", "")) for ss in (i.get("session_summaries") or []))
            if sc not in by_scope:
                by_scope[sc] = {"count": 0, "sessions": 0, "tokens": 0}
            by_scope[sc]["count"] += 1
            by_scope[sc]["sessions"] += sessions
            by_scope[sc]["tokens"] += tokens
        most_reopened = sorted(
            [{"id": i["id"], "title": i["title"], "reopen_count": i.get("reopen_count", 0)}
             for i in all_issues if i.get("reopen_count", 0) > 0],
            key=lambda x: x["reopen_count"], reverse=True
        )[:5]
        sprints = config.get("sprints", [])
        sprint_completion = []
        for s in sprints:
            if s.get("status") == "CLOSED":
                sid = s["id"]
                sprint_issues = [i for i in all_issues if (i.get("sprint_id") or "").lower() == sid.lower()]
                if sprint_issues:
                    done_count = sum(1 for i in sprint_issues if i.get("status") == "DONE")
                    pct = int(done_count / len(sprint_issues) * 100)
                    sprint_completion.append({"id": sid, "name": s.get("name"), "completion_pct": pct})
        return {
            "ok": True,
            "since_date": since_iso[:10],
            "total_issues": len(all_issues),
            "issues_created_in_period": len(recent_issues),
            "issues_completed_in_period": len(done_recent),
            "total_sessions_all_time": total_sessions,
            "total_estimated_tokens_all_time": total_tokens,
            "by_scope": by_scope,
            "most_reopened_tickets": most_reopened,
            "sprint_completion_rates": sprint_completion,
            "avg_sessions_per_ticket": round(total_sessions / max(len(all_issues), 1), 2),
        }

    elif name == "pm_sprint_autopilot":
        active_sprint_id = arguments.get("sprint_id") or store.get_active_sprint_id()
        max_parallel = int(arguments.get("max_parallel", 2))
        if not active_sprint_id:
            return {"ok": False, "error": "No active sprint. Pass sprint_id explicitly."}
        config = store.get_project_config()
        wip = store.get_wip_limits() if hasattr(store, "get_wip_limits") else {}
        all_sprint_issues = store.list_issues(sprint_id=active_sprint_id)
        in_progress = [i for i in all_sprint_issues if i.get("status") == "IN_PROGRESS"]
        needs_input = [i for i in all_sprint_issues if i.get("status") == "NEEDS_INPUT"]
        issue_map = {i["id"]: i for i in store.list_issues()}
        wip_limit = wip.get("IN_PROGRESS", max_parallel) if wip else max_parallel
        available_slots = max(0, wip_limit - len(in_progress))
        if needs_input:
            return {
                "ok": True,
                "status": "paused",
                "reason": "NEEDS_INPUT tickets require human resolution before autopilot can continue.",
                "needs_input": [{"id": i["id"], "title": i["title"], "reason": i.get("flagged_reason", "")} for i in needs_input],
                "in_progress": [{"id": i["id"], "title": i["title"]} for i in in_progress],
            }
        todo = [i for i in all_sprint_issues if i.get("status") == "TODO"]
        def _blocked(issue: Dict[str, Any]) -> bool:
            for lk in (issue.get("links") or []):
                if lk.get("type") == "is-blocked-by":
                    blocker = issue_map.get(lk["to_id"])
                    if blocker and blocker.get("status") not in ("DONE", "REVIEW"):
                        return True
            return False
        ready = [i for i in todo if not _blocked(i)]
        ready.sort(key=lambda i: (i.get("weight", 50), {"critical":0,"high":1,"medium":2,"low":3}.get(i.get("priority","medium"),2)))
        next_tickets = ready[:available_slots]
        done_count = sum(1 for i in all_sprint_issues if i.get("status") == "DONE")
        return {
            "ok": True,
            "status": "running" if next_tickets else ("complete" if not todo else "blocked"),
            "sprint_id": active_sprint_id,
            "progress": f"{done_count}/{len(all_sprint_issues)} done",
            "in_progress_count": len(in_progress),
            "available_slots": available_slots,
            "next_to_run": [{"id": i["id"], "title": i["title"], "scope": i.get("scope"), "priority": i.get("priority")} for i in next_tickets],
            "blocked_todo": [{"id": i["id"]} for i in todo if _blocked(i)],
            "instruction": (f"Spawn sessions for: {[i['id'] for i in next_tickets]}. Then call pm_sprint_autopilot again after each completes."
                            if next_tickets else "No tickets ready. Resolve blockers or NEEDS_INPUT."),
        }

    elif name == "pm_issue_debate":
        issue_id = arguments["id"].strip().upper()
        approach_a = arguments.get("approach_a", "Standard implementation following existing patterns in the codebase")
        approach_b = arguments.get("approach_b", "Alternative implementation — minimise dependencies, prefer simpler abstractions")
        is_judge = bool(arguments.get("judge", False))
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        if is_judge:
            summaries = issue.get("session_summaries") or []
            if len(summaries) < 2:
                return {"ok": False, "error": "Need at least 2 session summaries (one per approach) to judge. Run both sessions first."}
            a_summary = summaries[-2]
            b_summary = summaries[-1]
            return {
                "ok": True,
                "mode": "judge",
                "issue_id": issue_id,
                "approach_a_summary": a_summary.get("summary", "")[:500],
                "approach_b_summary": b_summary.get("summary", "")[:500],
                "judge_instruction": (
                    f"Compare the two implementation approaches above for ticket {issue_id}: '{issue['title']}'.\n"
                    f"Evaluate: code simplicity, test coverage, adherence to existing patterns, alignment with acceptance criteria.\n"
                    f"Pick the better approach and explain why. Call pm_session_attach with your verdict as the summary."
                ),
            }
        return {
            "ok": True,
            "mode": "setup",
            "issue_id": issue_id,
            "prompt_a": (
                f"Implement ticket {issue_id}: {issue['title']}\n\n"
                f"APPROACH A: {approach_a}\n\n"
                f"Description: {issue.get('description','')[:400]}\n"
                f"Criteria: {issue.get('acceptance_criteria',[])}\n\n"
                f"Complete implementation, then call pm_session_attach with summary tagged '[APPROACH A]'."
            ),
            "prompt_b": (
                f"Implement ticket {issue_id}: {issue['title']}\n\n"
                f"APPROACH B: {approach_b}\n\n"
                f"Description: {issue.get('description','')[:400]}\n"
                f"Criteria: {issue.get('acceptance_criteria',[])}\n\n"
                f"Complete implementation, then call pm_session_attach with summary tagged '[APPROACH B]'."
            ),
            "instruction": "Spawn two separate Claude sessions using prompt_a and prompt_b. After both complete, call pm_issue_debate again with judge=true.",
        }

    # ── v0.8.0 tool handlers ──────────────────────────────────────────────────

    elif name == "pm_issue_assign":
        issue_id = arguments["id"]
        assignee = arguments.get("assignee") or None
        try:
            issue = store.assign_issue(issue_id, assignee)
            return {"ok": True, "issue_id": issue_id, "assignee": issue.get("assignee")}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_pin":
        issue_id = arguments["id"]
        pinned = bool(arguments.get("pinned", True))
        try:
            issue = store.pin_issue(issue_id, pinned)
            return {"ok": True, "issue_id": issue_id, "pinned": pinned}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_weight":
        issue_id = arguments["id"]
        weight = int(arguments.get("weight", 50))
        try:
            store.set_issue_weight(issue_id, weight)
            return {"ok": True, "issue_id": issue_id, "weight": weight}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_reopen":
        issue_id = arguments["id"]
        reason = arguments.get("reason", "").strip()
        reporter = arguments.get("reporter", _git_user())
        try:
            issue = store.reopen_issue(issue_id, reason, reporter)
            return {"ok": True, "issue": issue, "reopen_count": issue.get("reopen_count", 1)}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_session_abort":
        issue_id = arguments["id"]
        reason = arguments.get("reason", "").strip()
        try:
            issue = store.abort_session(
                issue_id, reason,
                arguments.get("what_was_attempted", ""),
                arguments.get("codebase_state", "clean"),
            )
            return {"ok": True, "issue_id": issue_id, "status": "TODO", "reason": reason}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_session_handoff":
        issue_id = arguments["id"]
        next_step = arguments.get("next_step", "").strip()
        try:
            issue = store.set_session_handoff(
                issue_id, next_step,
                arguments.get("files_in_progress"),
                arguments.get("partial_criteria_done"),
            )
            return {"ok": True, "issue_id": issue_id, "handoff": issue.get("handoff")}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_checklist_set":
        issue_id = arguments["id"]
        items = arguments.get("items", [])
        try:
            issue = store.set_issue_checklist(issue_id, items)
            return {"ok": True, "checklist": issue.get("checklist", [])}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_checklist_check":
        issue_id = arguments["id"]
        index = int(arguments.get("index", 0))
        done = bool(arguments.get("done", True))
        try:
            issue = store.check_checklist_item(issue_id, index, done)
            return {"ok": True, "checklist": issue.get("checklist", [])}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_risk_flag":
        issue_id = arguments["id"]
        risk_type = arguments.get("risk_type", "security")
        reason = arguments.get("reason", "").strip()
        try:
            issue = store.risk_flag_issue(issue_id, risk_type, reason)
            return {"ok": True, "issue_id": issue_id, "risk": issue.get("risk")}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_issue_batch_update":
        ids = arguments.get("ids", [])
        updates = arguments.get("updates", {})
        if not ids:
            return {"ok": False, "error": "ids list is required."}
        success, failed = [], []
        for issue_id in ids:
            try:
                store.update_issue(issue_id.strip().upper(), updates)
                success.append(issue_id)
            except Exception as e:
                failed.append({"id": issue_id, "error": str(e)})
        return {"ok": True, "updated": len(success), "failed": failed}

    elif name == "pm_issue_duplicate_detect":
        candidate_title = arguments["title"].strip().lower()
        candidate_desc = (arguments.get("description") or "").strip().lower()
        all_issues = store.list_issues()
        scored: List[Dict[str, Any]] = []
        candidate_words = set(candidate_title.split())
        for issue in all_issues:
            title_words = set(issue.get("title", "").lower().split())
            overlap = len(candidate_words & title_words) / max(len(candidate_words | title_words), 1)
            desc_boost = 0.0
            if candidate_desc:
                issue_desc_words = set((issue.get("description") or "").lower().split())
                candidate_desc_words = set(candidate_desc.split())
                desc_boost = len(candidate_desc_words & issue_desc_words) / max(len(candidate_desc_words), 1) * 0.3
            score = overlap + desc_boost
            if score > 0.3:
                scored.append({"id": issue["id"], "title": issue["title"], "status": issue.get("status"),
                               "score": round(score, 2)})
        scored.sort(key=lambda x: x["score"], reverse=True)
        return {
            "ok": True,
            "candidate_title": arguments["title"],
            "possible_duplicates": scored[:5],
            "recommendation": "Consider merging with " + scored[0]["id"] if scored and scored[0]["score"] > 0.7 else "No strong duplicates found.",
        }

    elif name == "pm_velocity_forecast":
        sprints_back = int(arguments.get("sprints_back", 3))
        config = store.get_project_config()
        all_issues = store.list_issues()
        closed_sprints = [s for s in config.get("sprints", []) if s.get("status") == "CLOSED"][-sprints_back:]
        if not closed_sprints:
            return {"ok": False, "error": "No completed sprints found to base forecast on."}
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}
        sprint_stats: List[Dict[str, Any]] = []
        for sprint in closed_sprints:
            sprint_issues = [i for i in all_issues if (i.get("sprint_id") or "").lower() == sprint["id"].lower()]
            done = [i for i in sprint_issues if i.get("status") == "DONE"]
            scope_units = sum(scope_weights.get(i.get("scope") or "", 2) for i in done)
            sprint_stats.append({"id": sprint["id"], "tickets_done": len(done), "scope_units": scope_units})
        avg_tickets = sum(s["tickets_done"] for s in sprint_stats) / len(sprint_stats)
        avg_scope = sum(s["scope_units"] for s in sprint_stats) / len(sprint_stats)
        backlog = [i for i in all_issues if i.get("status") in ("TODO", "DRAFT", "NEEDS_INPUT") and not i.get("sprint_id")]
        backlog_tickets = len(backlog)
        backlog_scope = sum(scope_weights.get(i.get("scope") or "", 2) for i in backlog)
        estimated_sprints = max(backlog_scope / max(avg_scope, 1), backlog_tickets / max(avg_tickets, 1))
        return {
            "ok": True,
            "avg_tickets_per_sprint": round(avg_tickets, 1),
            "avg_scope_units_per_sprint": round(avg_scope, 1),
            "backlog_tickets": backlog_tickets,
            "backlog_scope_units": backlog_scope,
            "estimated_sprints_to_clear": round(estimated_sprints, 1),
            "estimated_weeks": round(estimated_sprints * (closed_sprints[0].get("duration_days", 7) / 7), 1),
            "sprint_history": sprint_stats,
        }

    elif name == "pm_sprint_compare":
        sprint_a_id = arguments["sprint_a"].strip()
        sprint_b_id = arguments["sprint_b"].strip()
        config = store.get_project_config()
        all_issues = store.list_issues()
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}

        def _sprint_stats(sid: str) -> Dict[str, Any]:
            sprint = next((s for s in config.get("sprints", []) if s["id"] == sid), None)
            if not sprint:
                return {}
            issues = [i for i in all_issues if (i.get("sprint_id") or "").lower() == sid.lower()]
            done = [i for i in issues if i.get("status") == "DONE"]
            sessions = sum(len(i.get("session_summaries", [])) for i in issues)
            needs_input = sum(1 for i in issues if i.get("status") == "NEEDS_INPUT")
            reopens = sum(i.get("reopen_count", 0) for i in issues)
            scope_done = sum(scope_weights.get(i.get("scope") or "", 2) for i in done)
            return {"id": sid, "name": sprint.get("name"), "goal": sprint.get("goal"),
                    "tickets_done": len(done), "total_tickets": len(issues),
                    "scope_units_done": scope_done, "total_sessions": sessions,
                    "sessions_per_ticket": round(sessions / max(len(issues), 1), 2),
                    "needs_input_count": needs_input, "total_reopens": reopens}

        a = _sprint_stats(sprint_a_id)
        b = _sprint_stats(sprint_b_id)
        if not a or not b:
            return {"ok": False, "error": "One or both sprint IDs not found."}

        def _delta(key: str) -> str:
            av, bv = a.get(key, 0), b.get(key, 0)
            if bv > av:
                return f"+{round(bv - av, 1)}"
            return f"{round(bv - av, 1)}"

        return {
            "ok": True,
            "sprint_a": a,
            "sprint_b": b,
            "deltas": {k: _delta(k) for k in ("tickets_done", "scope_units_done", "sessions_per_ticket", "needs_input_count", "total_reopens")},
        }

    elif name == "pm_board_export":
        fmt = arguments.get("format", "markdown")
        sprint_id = arguments.get("sprint_id") or store.get_active_sprint_id()
        issues = store.list_issues(sprint_id=sprint_id) if sprint_id else store.list_issues()
        if fmt == "json":
            return {"ok": True, "format": "json", "issues": issues, "count": len(issues)}
        elif fmt == "doc":
            from datetime import date
            content = (
                f"# Board Export — {date.today().isoformat()}\n\n"
                + "\n".join(f"| {i['id']} | {i['title']} | {i.get('status')} | {i.get('priority')} |" for i in issues)
            )
            doc = store.create_doc(title=f"Board Export {date.today().isoformat()}", content=content, doc_type="brief")
            return {"ok": True, "format": "doc", "document": doc}
        else:  # markdown
            lines = ["| ID | Title | Status | Priority | Scope |", "|---|---|---|---|---|"]
            for i in issues:
                lines.append(f"| {i['id']} | {i['title']} | {i.get('status','?')} | {i.get('priority','?')} | {i.get('scope','?')} |")
            return {"ok": True, "format": "markdown", "markdown": "\n".join(lines), "count": len(issues)}

    elif name == "pm_qa_checklist":
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        adrs = store.list_docs(doc_type="adr")
        accepted_adrs = [d for d in adrs if d.get("doc_status") in ("accepted", "")]
        score = 0
        checks: List[Dict[str, Any]] = []
        if len((issue.get("description") or "").strip()) >= 50:
            score += 20; checks.append({"check": "Description", "passed": True, "detail": "Sufficient length"})
        else:
            checks.append({"check": "Description", "passed": False, "detail": "Under 50 chars -- add context"})
        crit = issue.get("acceptance_criteria") or []
        if len(crit) >= 3:
            score += 25; checks.append({"check": "Acceptance criteria", "passed": True, "detail": f"{len(crit)} criteria"})
        elif crit:
            score += 10; checks.append({"check": "Acceptance criteria", "passed": False, "detail": f"Only {len(crit)} -- aim for 3+"})
        else:
            checks.append({"check": "Acceptance criteria", "passed": False, "detail": "None -- required before running"})
        if issue.get("scope"):
            score += 15; checks.append({"check": "Scope", "passed": True, "detail": issue["scope"]})
        else:
            checks.append({"check": "Scope", "passed": False, "detail": "Not set -- set scope before running"})
        if issue.get("tags"):
            score += 10; checks.append({"check": "Tags", "passed": True, "detail": ", ".join(issue["tags"])})
        else:
            checks.append({"check": "Tags", "passed": False, "detail": "No tags"})
        if any(True for d in accepted_adrs if issue_id in (d.get("linked_issues") or [])):
            score += 15; checks.append({"check": "ADR linked", "passed": True})
        else:
            checks.append({"check": "ADR linked", "passed": False, "detail": "Consider linking relevant ADRs"})
        title_len = len(issue.get("title", ""))
        if 10 <= title_len <= 80:
            score += 15; checks.append({"check": "Title quality", "passed": True})
        else:
            checks.append({"check": "Title quality", "passed": False, "detail": "Title too short or too long"})
        grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
        top_fail = next((c["detail"] for c in checks if not c["passed"] and c.get("detail")), "All checks passed")
        return {"ok": True, "issue_id": issue_id, "score": score, "grade": grade, "checks": checks,
                "top_recommendation": top_fail, "ready_to_run": score >= 60}

    elif name == "pm_cost_report":
        sprint_id_arg = arguments.get("sprint_id")
        epic_id_arg = (arguments.get("epic_id") or "").strip().upper() or None
        all_issues = store.list_issues()
        if sprint_id_arg:
            issues = [i for i in all_issues if (i.get("sprint_id") or "").lower() == sprint_id_arg.lower()]
        elif epic_id_arg:
            issues = [i for i in all_issues if (i.get("epic_id") or "").upper() == epic_id_arg]
        else:
            issues = all_issues
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}

        def _tok(s: str) -> int:
            return max(1, len(s) // 4)

        ticket_costs: List[Dict[str, Any]] = []
        total_tokens, total_sessions = 0, 0
        for issue in issues:
            summaries = issue.get("session_summaries") or []
            est_tokens = sum(_tok(ss.get("summary", "")) + _tok(" ".join(ss.get("files_changed", []))) for ss in summaries) + _tok(issue.get("description", "")) + sum(_tok(c) for c in (issue.get("acceptance_criteria") or []))
            sessions = len(summaries)
            total_tokens += est_tokens
            total_sessions += sessions
            ticket_costs.append({"id": issue["id"], "title": issue["title"][:50], "sessions": sessions, "est_tokens": est_tokens, "scope": issue.get("scope")})

        ticket_costs.sort(key=lambda x: x["est_tokens"], reverse=True)
        return {
            "ok": True,
            "scope": sprint_id_arg or epic_id_arg or "all",
            "total_estimated_tokens": total_tokens,
            "total_sessions": total_sessions,
            "ticket_count": len(issues),
            "top_5_expensive": ticket_costs[:5],
            "avg_tokens_per_ticket": total_tokens // max(len(issues), 1),
        }

    elif name == "pm_issue_health_score":
        from datetime import datetime, timezone
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        now_dt = datetime.now(timezone.utc)
        score = 0
        components: Dict[str, int] = {}
        desc_len = len((issue.get("description") or "").strip())
        crit_count = len(issue.get("acceptance_criteria") or [])
        scope_set = bool(issue.get("scope"))
        spec_score = min(25, (10 if desc_len >= 50 else 0) + (10 if crit_count >= 3 else 5 if crit_count >= 1 else 0) + (5 if scope_set else 0))
        components["spec_quality"] = spec_score
        score += spec_score
        reopens = issue.get("reopen_count", 0)
        sessions = len(issue.get("session_summaries") or [])
        stability = max(0, 25 - reopens * 8 - (10 if sessions > 3 else 0))
        components["implementation_stability"] = stability
        score += stability
        try:
            updated = datetime.fromisoformat(issue.get("updated_at", "").replace("Z", "+00:00"))
            age_days = (now_dt - updated).days
            freshness = max(0, 25 - int(age_days / 14 * 25))
        except Exception:
            freshness = 0
        components["freshness"] = freshness
        score += freshness
        status = issue.get("status", "TODO")
        progress_score = 25 if status == "DONE" else 20 if status == "REVIEW" else int(issue.get("progress", 0) / 100 * 25) if status == "IN_PROGRESS" else 5
        components["progress"] = progress_score
        score += progress_score
        grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
        worst = min(components, key=lambda k: components[k])
        return {"ok": True, "issue_id": issue_id, "score": score, "grade": grade, "components": components,
                "top_improvement": f"Improve {worst} (currently {components[worst]}/25)"}

    elif name == "pm_workload_balance":
        epic_id = arguments["epic_id"].strip().upper()
        all_issues = store.list_issues()
        children = [i for i in all_issues if (i.get("epic_id") or "").upper() == epic_id]
        if not children:
            return {"ok": False, "error": f"No children found for epic {epic_id}."}
        on_track, lagging, flagged_list, complete = [], [], [], []
        for child in children:
            status = child.get("status", "TODO")
            if status in ("DONE", "REVIEW"):
                complete.append(child["id"])
            elif status == "NEEDS_INPUT":
                flagged_list.append({"id": child["id"], "title": child["title"], "reason": child.get("flagged_reason", "")})
            elif status == "IN_PROGRESS":
                sessions = len(child.get("session_summaries") or [])
                progress = child.get("progress", 0)
                if sessions >= 2 and progress < 30:
                    lagging.append({"id": child["id"], "title": child["title"], "sessions": sessions, "progress": progress})
                else:
                    on_track.append({"id": child["id"], "title": child["title"], "progress": progress})
        return {
            "ok": True,
            "epic_id": epic_id,
            "on_track": on_track,
            "lagging": lagging,
            "flagged": flagged_list,
            "complete": complete,
            "recommendation": "Focus on lagging tickets" if lagging else ("Resolve flagged tickets" if flagged_list else "Epic on track"),
        }

    elif name == "pm_sprint_goal_set":
        sprint_id = arguments["sprint_id"].strip()
        goal = arguments["goal"].strip()
        config = store.get_project_config()
        sprints = config.get("sprints", [])
        target = next((s for s in sprints if s["id"] == sprint_id), None)
        if not target:
            return {"ok": False, "error": f"Sprint {sprint_id} not found."}
        old_goal = target.get("goal", "")
        try:
            with store._backend._lock, store._backend._exclusive(store._backend.config_path):
                cfg = store._backend._read_config()
                for s in cfg.get("sprints", []):
                    if s["id"] == sprint_id:
                        s["goal"] = goal
                        break
                store._backend._write_config(cfg)
        except AttributeError:
            # Fallback for backends that don't expose _lock/_exclusive
            for s in sprints:
                if s["id"] == sprint_id:
                    s["goal"] = goal
        store.log_activity("Sprint Goal Updated", f"{sprint_id}: '{old_goal}' to '{goal}'")
        return {"ok": True, "sprint_id": sprint_id, "old_goal": old_goal, "new_goal": goal}

    elif name == "pm_code_context":
        import subprocess as _sp
        issue_id = arguments["id"].strip().upper()
        max_files = int(arguments.get("max_files", 10))
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        keywords = list(set(
            w.lower() for w in (issue.get("title", "") + " " + (issue.get("description") or "")).split()
            if len(w) > 4 and w.isalpha()
        ))[:5]
        found_files: Dict[str, int] = {}
        for kw in keywords:
            try:
                result = _sp.run(["git", "grep", "-l", "-i", kw], capture_output=True, text=True, timeout=10)
                for f in result.stdout.strip().splitlines():
                    found_files[f] = found_files.get(f, 0) + 1
            except Exception:
                pass
        for link in issue.get("commit_links") or []:
            try:
                result = _sp.run(["git", "diff-tree", "--no-commit-id", "-r", "--name-only", link.get("sha", "")],
                                 capture_output=True, text=True, timeout=10)
                for f in result.stdout.strip().splitlines():
                    found_files[f] = found_files.get(f, 0) + 3
            except Exception:
                pass
        ranked = sorted(found_files.items(), key=lambda x: x[1], reverse=True)[:max_files]
        return {
            "ok": True,
            "issue_id": issue_id,
            "keywords_searched": keywords,
            "relevant_files": [{"path": f, "relevance_score": s} for f, s in ranked],
            "hint": "Read the highest-scored files first before implementing.",
        }

    elif name == "pm_issue_dependency_path":
        start_id = arguments["id"].strip().upper()
        all_issues = store.list_issues()
        issue_map = {i["id"]: i for i in all_issues}
        start = issue_map.get(start_id)
        if not start:
            return {"ok": False, "error": f"Issue {start_id} not found."}
        chains: List[List[Dict[str, Any]]] = []
        def _trace(current_id: str, path: List[str], visited: set) -> None:
            if current_id in visited:
                return
            visited = visited | {current_id}
            issue = issue_map.get(current_id)
            if not issue:
                return
            blockers = [lk["to_id"] for lk in (issue.get("links") or []) if lk.get("type") == "is-blocked-by"]
            if not blockers:
                chains.append(path + [current_id])
                return
            for bid in blockers:
                _trace(bid, path + [current_id], visited)
        _trace(start_id, [], set())
        result_chains = []
        for chain in chains[:3]:
            result_chains.append([
                {"id": cid, "title": issue_map.get(cid, {}).get("title", "?"), "status": issue_map.get(cid, {}).get("status", "?")}
                for cid in chain
            ])
        return {
            "ok": True,
            "issue_id": start_id,
            "dependency_chains": result_chains,
            "root_blockers": [c[-1]["id"] for c in result_chains if c],
            "blocked_count": len(chains),
        }

    elif name == "pm_auto_link_pr":
        import subprocess as _sp, re as _re
        repo = arguments["repo"].strip()
        since_days = int(arguments.get("since_days", 7))
        config = store.get_project_config()
        key_prefix = config.get("key_prefix", "PM")
        try:
            result = _sp.run(
                ["gh", "pr", "list", "--repo", repo, "--state", "all", "--limit", "50",
                 "--json", "title,body,url,number"],
                capture_output=True, text=True, timeout=30,
            )
            if result.returncode != 0:
                return {"ok": False, "error": f"gh pr list failed: {result.stderr[:200]}"}
            prs = __import__("json").loads(result.stdout)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        pattern = _re.compile(rf"\b{_re.escape(key_prefix)}-(\d+)\b", _re.IGNORECASE)
        linked, skipped = [], []
        for pr in prs:
            text = (pr.get("title", "") or "") + " " + (pr.get("body", "") or "")
            matches = pattern.findall(text)
            for num in set(matches):
                issue_id = f"{key_prefix.upper()}-{num}"
                issue = store.get_issue(issue_id)
                if not issue:
                    continue
                pr_url = pr.get("url", "")
                existing_urls = [r.get("url") for r in (issue.get("remote_links") or [])]
                if pr_url in existing_urls:
                    skipped.append(issue_id)
                else:
                    store.add_remote_link(issue_id, pr_url, f"PR #{pr['number']}: {pr['title'][:60]}")
                    linked.append(issue_id)
        return {"ok": True, "repo": repo, "prs_scanned": len(prs), "linked": linked, "already_linked": len(skipped)}

    elif name == "pm_epic_roadmap_sync":
        epic_id_filter = (arguments.get("epic_id") or "").strip().upper() or None
        config = store.get_project_config()
        all_issues = store.list_issues()
        sprints = {s["id"]: s for s in config.get("sprints", [])}
        epics = [i for i in all_issues if i.get("type") == "epic"]
        if epic_id_filter:
            epics = [e for e in epics if e["id"] == epic_id_filter]
        synced: List[Dict[str, Any]] = []
        for epic in epics:
            children = [i for i in all_issues if (i.get("epic_id") or "").upper() == epic["id"].upper()
                        and i.get("status") not in ("DONE", "REVIEW")]
            latest_sprint_id = None
            latest_end_date = None
            for child in children:
                sid = child.get("sprint_id")
                if sid and sid in sprints:
                    end = sprints[sid].get("end_date")
                    if end and (latest_end_date is None or end > latest_end_date):
                        latest_end_date = end
                        latest_sprint_id = sid
            synced.append({
                "epic_id": epic["id"],
                "title": epic["title"],
                "expected_completion_sprint": latest_sprint_id,
                "expected_completion_date": latest_end_date,
                "pending_children": len(children),
            })
        return {"ok": True, "synced_epics": len(synced), "results": synced}

    elif name == "pm_comment_reply":
        issue_id = arguments["id"]
        parent_id = int(arguments["parent_comment_id"])
        body = arguments["body"]
        author = arguments.get("author", _git_user())
        try:
            reply = store.comment_reply(issue_id, parent_id, body, author)
            return {"ok": True, "reply": reply}
        except ValueError as e:
            return {"ok": False, "error": str(e)}

    elif name == "pm_wip_limit_set":
        column = arguments["column"].strip().upper()
        limit = int(arguments.get("limit", 0))
        result = store.set_wip_limit(column, limit)
        return {"ok": True, "wip_limits": result, "message": f"WIP limit for {column} {'cleared' if limit <= 0 else f'set to {limit}'}"}

    elif name == "pm_session_template_create":
        tmpl = store.create_session_template(
            arguments["name"],
            arguments["prompt_prefix"],
            arguments.get("match_types"),
            arguments.get("match_tags"),
        )
        return {"ok": True, "template": tmpl}

    elif name == "pm_session_template_list":
        return {"ok": True, "templates": store.list_session_templates()}

    elif name == "pm_session_template_delete":
        removed = store.delete_session_template(arguments["name"])
        return {"ok": removed, "name": arguments["name"]}

    elif name == "pm_session_quality_score":
        issue_id = arguments["id"].strip().upper()
        issue = store.get_issue(issue_id)
        if not issue:
            return {"ok": False, "error": f"Issue {issue_id} not found."}
        summaries = issue.get("session_summaries") or []
        if not summaries:
            return {"ok": True, "issue_id": issue_id, "score": 0, "grade": "F", "reason": "No sessions recorded."}
        last_session = summaries[-1]
        score = 0
        checks: List[Dict[str, Any]] = []
        checkins = [c for c in (issue.get("checkins") or []) if c.get("created_at", "") >= (last_session.get("created_at", "") or "")]
        if checkins:
            score += 20; checks.append({"check": "Called pm_issue_checkin", "passed": True, "points": 20})
        else:
            checks.append({"check": "Called pm_issue_checkin", "passed": False, "points": 0})
        if not last_session.get("aborted"):
            score += 25; checks.append({"check": "Session attached (pm_session_attach)", "passed": True, "points": 25})
        else:
            checks.append({"check": "Session attached (pm_session_attach)", "passed": False, "points": 0})
        recent_commits = [l for l in (issue.get("commit_links") or []) if l.get("created_at", "") >= (last_session.get("created_at", "") or "")]
        if recent_commits:
            score += 15; checks.append({"check": "Linked commit (pm_commit_link)", "passed": True, "points": 15})
        else:
            checks.append({"check": "Linked commit (pm_commit_link)", "passed": False, "points": 0})
        if issue.get("criteria_done"):
            score += 20; checks.append({"check": "Updated criteria_done", "passed": True, "points": 20})
        else:
            checks.append({"check": "Updated criteria_done", "passed": False, "points": 0})
        if issue.get("reopen_count", 0) == 0:
            score += 20; checks.append({"check": "No reopen within 48h", "passed": True, "points": 20})
        else:
            checks.append({"check": "No reopen within 48h", "passed": False, "points": 0})
        grade = "A" if score >= 90 else "B" if score >= 75 else "C" if score >= 60 else "D" if score >= 40 else "F"
        return {"ok": True, "issue_id": issue_id, "score": score, "grade": grade, "checks": checks}

    elif name == "pm_daily_briefing":
        from datetime import datetime, timezone
        now_dt = datetime.now(timezone.utc)
        config = store.get_project_config()
        active_sprint_id = store.get_active_sprint_id()
        all_issues = store.list_issues()
        sprint_issues = store.list_issues(sprint_id=active_sprint_id) if active_sprint_id else all_issues
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}
        sprint_info: Dict[str, Any] = {}
        if active_sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == active_sprint_id:
                    sprint_info = s
                    break
        days_remaining = None
        if sprint_info.get("end_date"):
            try:
                end = datetime.fromisoformat(sprint_info["end_date"].replace("Z", "+00:00"))
                days_remaining = max(0, (end - now_dt).days)
            except Exception:
                pass
        done = [i for i in sprint_issues if i.get("status") == "DONE"]
        in_progress = [i for i in sprint_issues if i.get("status") == "IN_PROGRESS"]
        needs_input = [i for i in sprint_issues if i.get("status") == "NEEDS_INPUT"]
        todo = [i for i in sprint_issues if i.get("status") == "TODO"]
        scope_remaining = sum(scope_weights.get(i.get("scope") or "", 2) for i in todo + in_progress)
        top_tickets = sorted(todo, key=lambda i: (i.get("weight", 50), -{"critical":3,"high":2,"medium":1,"low":0}.get(i.get("priority","medium"),0)))[:3]
        ci_watchers = store.list_ci_watchers()
        ci_alerts = [w for w in ci_watchers if w.get("last_status") == "FAILURE"]
        return {
            "ok": True,
            "sprint_name": sprint_info.get("name", "No active sprint"),
            "sprint_goal": sprint_info.get("goal", ""),
            "days_remaining": days_remaining,
            "tickets_done": len(done),
            "tickets_in_progress": len(in_progress),
            "tickets_remaining": len(todo),
            "scope_units_remaining": scope_remaining,
            "recommended_next": [{"id": i["id"], "title": i["title"], "scope": i.get("scope"), "priority": i.get("priority")} for i in top_tickets],
            "needs_input_queue": [{"id": i["id"], "title": i["title"], "reason": i.get("flagged_reason", "")} for i in needs_input],
            "ci_alerts": [{"issue_id": w["issue_id"], "pr_url": w["pr_url"]} for w in ci_alerts],
        }

    elif name == "pm_sprint_health_dashboard":
        from datetime import datetime, timezone, timedelta
        active_sprint_id = arguments.get("sprint_id") or store.get_active_sprint_id()
        if not active_sprint_id:
            return {"ok": False, "error": "No active sprint."}
        now_dt = datetime.now(timezone.utc)
        config = store.get_project_config()
        sprint = next((s for s in config.get("sprints", []) if s["id"] == active_sprint_id), None)
        if not sprint:
            return {"ok": False, "error": f"Sprint {active_sprint_id} not found."}
        issues = store.list_issues(sprint_id=active_sprint_id)
        scope_weights = {"nano": 1, "small": 2, "medium": 4, "large": 8, "research": 3}
        done = [i for i in issues if i.get("status") == "DONE"]
        in_progress = [i for i in issues if i.get("status") == "IN_PROGRESS"]
        needs_input = [i for i in issues if i.get("status") == "NEEDS_INPUT"]
        todo = [i for i in issues if i.get("status") == "TODO"]
        scope_done = sum(scope_weights.get(i.get("scope") or "", 2) for i in done)
        scope_total = sum(scope_weights.get(i.get("scope") or "", 2) for i in issues)
        goal = (sprint.get("goal") or "").lower()
        goal_words = set(w for w in goal.split() if len(w) > 3)
        def _relevant(i):
            text = (i.get("title","") + " " + (i.get("description") or "")).lower()
            return any(w in text for w in goal_words)
        goal_score = int(sum(1 for i in issues if _relevant(i)) / max(len(issues), 1) * 100)
        wip = store.get_wip_limits()
        wip_violations = {col: (len([i for i in issues if i.get("status", "").upper() == col.upper()]), lim)
                          for col, lim in wip.items()
                          if len([i for i in issues if i.get("status", "").upper() == col.upper()]) > lim}
        stale_cutoff = (now_dt - timedelta(days=3)).isoformat()
        stale = [i for i in in_progress if (i.get("updated_at") or "") < stale_cutoff]
        days_remaining = None
        if sprint.get("end_date"):
            try:
                end = datetime.fromisoformat(sprint["end_date"].replace("Z", "+00:00"))
                days_remaining = max(0, (end - now_dt).days)
            except Exception:
                pass
        return {
            "ok": True,
            "sprint_id": active_sprint_id,
            "sprint_name": sprint.get("name"),
            "days_remaining": days_remaining,
            "goal_alignment_score": goal_score,
            "tickets": {"done": len(done), "in_progress": len(in_progress), "todo": len(todo), "needs_input": len(needs_input)},
            "scope": {"done": scope_done, "total": scope_total, "pct": int(scope_done / max(scope_total, 1) * 100)},
            "wip_violations": {col: f"{cnt}/{lim}" for col, (cnt, lim) in wip_violations.items()},
            "stale_tickets": [{"id": i["id"], "title": i["title"]} for i in stale],
            "needs_input_queue": [{"id": i["id"], "reason": i.get("flagged_reason","")} for i in needs_input],
        }

    elif name == "pm_sprint_theme_create":
        tmpl = store.create_sprint_theme(
            arguments["name"],
            arguments.get("description", ""),
            arguments.get("color", "#0052CC"),
        )
        return {"ok": True, "theme": tmpl}

    elif name == "pm_sprint_theme_list":
        return {"ok": True, "themes": store.list_sprint_themes()}

    elif name == "pm_prioritize_backlog":
        from datetime import datetime, timezone
        config = store.get_project_config()
        active_sprint_id = store.get_active_sprint_id()
        sprint_goal = (arguments.get("sprint_goal") or "").strip()
        if not sprint_goal and active_sprint_id:
            for s in config.get("sprints", []):
                if s["id"] == active_sprint_id:
                    sprint_goal = s.get("goal", "")
                    break
        limit = int(arguments.get("limit", 20))
        all_issues = store.list_issues()
        backlog = [i for i in all_issues if i.get("status") in ("TODO", "DRAFT") and not i.get("sprint_id")]
        goal_words = set(w.lower() for w in sprint_goal.split() if len(w) > 3)
        scope_scores = {"nano": 4, "small": 3, "medium": 2, "large": 1, "research": 2}
        priority_scores = {"critical": 4, "high": 3, "medium": 2, "low": 1}
        issue_map = {i["id"]: i for i in all_issues}
        now_dt = datetime.now(timezone.utc)
        scored = []
        for issue in backlog:
            text = (issue.get("title","") + " " + (issue.get("description") or "")).lower()
            goal_score = sum(1 for w in goal_words if w in text) * 10
            scope_score = scope_scores.get(issue.get("scope") or "", 2) * 5
            priority_score = priority_scores.get(issue.get("priority", "medium"), 2) * 8
            blocking_count = sum(1 for i2 in all_issues for lk in (i2.get("links") or [])
                                 if lk.get("type") == "is-blocked-by" and lk.get("to_id") == issue["id"])
            blocking_score = min(blocking_count * 15, 30)
            try:
                created = datetime.fromisoformat(issue.get("created_at", "").replace("Z", "+00:00"))
                age_days = (now_dt - created).days
                staleness_score = min(age_days * 0.5, 10)
            except Exception:
                staleness_score = 0
            weight_penalty = -(issue.get("weight", 50) - 50) * 0.2
            total = goal_score + scope_score + priority_score + blocking_score + staleness_score + weight_penalty
            scored.append({
                "id": issue["id"], "title": issue["title"],
                "priority": issue.get("priority"), "scope": issue.get("scope"),
                "weight": issue.get("weight", 50),
                "score": round(total, 1),
                "reasoning": f"goal:{goal_score} scope:{scope_score} priority:{priority_score} blocking:{blocking_score} staleness:{round(staleness_score,1)}",
            })
        scored.sort(key=lambda x: x["score"], reverse=True)
        return {"ok": True, "sprint_goal": sprint_goal, "ranked": scored[:limit], "total_backlog": len(backlog)}

    elif name == "pm_issue_merge":
        source_id = arguments["source_id"].strip().upper()
        target_id = arguments["target_id"].strip().upper()
        source = store.get_issue(source_id)
        target = store.get_issue(target_id)
        if not source:
            return {"ok": False, "error": f"Source issue {source_id} not found."}
        if not target:
            return {"ok": False, "error": f"Target issue {target_id} not found."}
        merged_criteria = list(target.get("acceptance_criteria") or [])
        for c in (source.get("acceptance_criteria") or []):
            if c not in merged_criteria:
                merged_criteria.append(c)
        merged_remote_links = list(target.get("remote_links") or [])
        for rl in (source.get("remote_links") or []):
            if not any(r["url"] == rl["url"] for r in merged_remote_links):
                merged_remote_links.append(rl)
        merged_commit_links = list(target.get("commit_links") or [])
        for cl in (source.get("commit_links") or []):
            if not any(c["sha"] == cl["sha"] for c in merged_commit_links):
                merged_commit_links.append(cl)
        store.update_issue(target_id, {
            "acceptance_criteria": merged_criteria,
            "remote_links": merged_remote_links,
            "commit_links": merged_commit_links,
        }, comment=f"[Merged from {source_id}] {source.get('description', '')[:200]}")
        store.update_issue(source_id, {"status": "DONE"}, comment=f"Merged into {target_id}.")
        return {"ok": True, "source_closed": source_id, "target_updated": target_id,
                "merged_criteria": len(merged_criteria), "merged_links": len(merged_remote_links)}

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

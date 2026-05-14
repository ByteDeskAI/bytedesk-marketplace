"""Minimal stdio MCP server for the design-pattern catalog."""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

from pattern_context import context_pack, decision_simulation, migration_plan, snippet_matches
from pattern_catalog import load_language_profiles, load_patterns, scope_names
from pattern_graph import catalog_graph, graph_query
from pattern_inference import infer_request_context
from pattern_intelligence import all_entries, adr_payload, find_entry, recommend_entries
from pattern_scanner import scan_path

import pattern_memory


SERVER_INFO = {"name": "design-patterns", "version": "0.9.0"}
PLUGIN_ROOT = Path(__file__).resolve().parents[1]
RISK_TERMS = {
    "operability": {
        "dead-letter",
        "dlq",
        "failure",
        "idempotent",
        "latency",
        "observability",
        "outage",
        "production",
        "replay",
        "resilience",
        "retry",
        "slo",
    },
    "conservative": {
        "audit",
        "compliance",
        "critical",
        "legacy",
        "migration",
        "regulated",
        "rollback",
        "safe",
        "stability",
    },
    "delivery": {
        "fast",
        "incremental",
        "mvp",
        "quick",
        "quickly",
        "simple",
        "small",
        "thin",
    },
}


SLASH_COMMAND_HELP: dict[str, dict[str, Any]] = {
    "patterns-recommend": {
        "tool": "patterns_recommend",
        "purpose": "Recommend patterns, playbooks, recipes, and smells for an architecture force or problem.",
        "usage": '/patterns-recommend "<query>" [--language <language>] [--scope <scope>] [--risk <risk>] [--limit <n>]',
        "helpCommand": "/patterns-recommend help",
        "options": [
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope <scope>: optional; inferred as object-design, integration-design, a catalog domain, or all when omitted.",
            "--risk <risk>: optional; inferred as operability, conservative, delivery, or balanced when omitted.",
            "--limit <n>: maximum recommendation count; defaults to 8.",
            "Missing query: returned as structured missing-argument detail because intent is not safely inferable.",
        ],
        "examples": [
            '/patterns-recommend "add a new SCM provider without changing rule execution code" --limit 5',
            '/patterns-recommend "streaming job events to multiple UI consumers"',
            '/patterns-recommend "duplicate delivery repeats side effects" --risk operability',
        ],
        "arguments": {
            "query": "add a new SCM provider without changing rule execution code",
            "language": "python",
            "scope": "object-design",
            "limit": 5,
        },
    },
    "patterns-scan": {
        "tool": "patterns_scan",
        "purpose": "Scan a file or directory for pattern-relevant architecture smells.",
        "usage": "/patterns-scan [path] [--min-confidence <0-1>] [--pack <pack>] [--include-docs] [--include-generated]",
        "helpCommand": "/patterns-scan help",
        "options": [
            "path: optional when the MCP working directory is a project; otherwise returned as missing detail.",
            "--min-confidence <0-1>: hide weak findings below the confidence threshold; defaults to 0.0.",
            "--pack <pack>: optional; inferred from path/query/scope signals, otherwise all.",
            "--include-docs: optional; inferred true for documentation paths, otherwise false.",
            "--include-generated: optional; defaults false unless explicitly requested.",
        ],
        "examples": [
            "/patterns-scan backend/app/workflow_engine --min-confidence 0.45",
            "/patterns-scan backend/app/repositories/jobs.py --min-confidence 0.5",
            "/patterns-scan docs/architecture --include-docs --pack integration",
        ],
        "arguments": {"path": "backend/app/workflow_engine", "min_confidence": 0.45},
    },
    "patterns-context": {
        "tool": "patterns_context",
        "purpose": "Build a model-ready context pack with scan findings, recommendations, snippets, and an ADR seed.",
        "usage": '/patterns-context [path] [--query "<problem>"] [--language <language>] [--scope <scope>] [--pack <pack>]',
        "helpCommand": "/patterns-context help",
        "options": [
            "path: optional when the MCP working directory is a project; otherwise returned as missing detail.",
            '--query "<problem>": optional; inferred as a generic architecture-guidance query from the resolved path when omitted.',
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope <scope>: optional; inferred as object-design, integration-design, a catalog domain, or all when omitted.",
            "--pack <pack>: optional; inferred from path/query/scope signals, otherwise all.",
        ],
        "examples": [
            '/patterns-context backend/app/providers/ai --query "adding a new AI provider safely"',
            '/patterns-context frontend/src/state --query "managing streaming job state"',
            '/patterns-context services/orders --query "duplicate message handling and replay"',
        ],
        "arguments": {
            "path": "backend/app/providers/ai",
            "query": "adding a new AI provider safely",
            "language": "python",
            "scope": "object-design",
        },
    },
    "patterns-simulate": {
        "tool": "patterns_simulate",
        "purpose": "Score likely pattern options against the architecture decision scorecard.",
        "usage": '/patterns-simulate "<decision or competing options>" [--language <language>] [--risk <risk>] [--limit <n>]',
        "helpCommand": "/patterns-simulate help",
        "options": [
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope is inferred for result context even though this command scores options across the matched catalog set.",
            "--risk <risk>: optional; inferred as operability, conservative, delivery, or balanced when omitted.",
            "--limit <n>: number of options to score; defaults to 5.",
            "Missing query: returned as structured missing-argument detail because a decision cannot be safely inferred.",
        ],
        "examples": [
            '/patterns-simulate "Strategy vs Chain of Responsibility for AI provider failover" --risk operability',
            '/patterns-simulate "Command vs State for workflow node execution lifecycle"',
            '/patterns-simulate "event fanout with replay and dead-letter handling" --limit 4',
        ],
        "arguments": {
            "query": "Strategy vs Chain of Responsibility for AI provider failover",
            "language": "python",
            "risk": "operability",
        },
    },
    "patterns-migrate": {
        "tool": "patterns_migrate",
        "purpose": "Create a staged migration plan from a current smell or source shape to a target pattern.",
        "usage": '/patterns-migrate "<current smell or source shape>" --to <target-pattern> [--language <language>] [--query "<context>"]',
        "helpCommand": "/patterns-migrate help",
        "options": [
            "--to <target-pattern>: required unless the request names exactly one target catalog pattern.",
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope is inferred for result context even though migration is driven by source and target.",
            '--query "<context>": extra project context; can act as source context when source is omitted.',
            "Missing source or target: returned as structured missing-argument detail when not inferable.",
        ],
        "examples": [
            '/patterns-migrate "hardcoded if/elif provider selection" --to strategy',
            '/patterns-migrate "fat router with inline persistence and branching" --to facade',
            '/patterns-migrate provider-switch-sprawl --to bridge --query "providers are GitHub, GitLab, and Bitbucket"',
        ],
        "arguments": {
            "source": "hardcoded if/elif provider selection",
            "target": "strategy",
            "language": "python",
        },
    },
    "patterns-snippets": {
        "tool": "patterns_snippets",
        "purpose": "Return language-specific implementation snippets for catalog pattern slugs.",
        "usage": "/patterns-snippets [<pattern-slug>[,<pattern-slug>...]] [--query <problem>] [--language <language>]",
        "helpCommand": "/patterns-snippets help",
        "options": [
            "--query <problem>: optional problem statement used to infer pattern slugs when slugs are omitted.",
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope is inferred for result context even though snippet lookup is pattern-slug driven.",
            "Missing patterns/query: returned as structured missing-argument detail when not inferable.",
        ],
        "examples": [
            "/patterns-snippets strategy,idempotent-receiver",
            "/patterns-snippets strategy",
            "/patterns-snippets content-based-router,dead-letter-channel",
        ],
        "arguments": {"patterns": ["strategy", "idempotent-receiver"], "language": "python"},
    },
    "patterns-adr": {
        "tool": "patterns_adr",
        "purpose": "Generate an ADR-style decision seed backed by the pattern catalog.",
        "usage": '/patterns-adr "<architecture decision>" [--language <language>] [--scope <scope>] [--status <status>]',
        "helpCommand": "/patterns-adr help",
        "options": [
            "--language <language>: optional; inferred from codebase and prompt context when omitted.",
            "--scope <scope>: optional; inferred as object-design, integration-design, a catalog domain, or all when omitted.",
            "--status <status>: optional; inferred from decision wording or defaulted to Proposed.",
            "Missing query: returned as structured missing-argument detail because a decision cannot be safely inferred.",
        ],
        "examples": [
            '/patterns-adr "durable event storage for SSE replay: Redis vs PostgreSQL"',
            '/patterns-adr "choosing between Registry and Chain of Responsibility for executor dispatch"',
            '/patterns-adr "message replay and dead-letter handling for order events"',
        ],
        "arguments": {
            "query": "durable event storage for SSE replay: Redis vs PostgreSQL",
            "language": "python",
            "scope": "integration-design",
        },
    },
    "patterns-graph": {
        "tool": "patterns_graph",
        "purpose": "Query the typed catalog graph and relationship map.",
        "usage": '/patterns-graph ["relationship question"] [--format json]',
        "helpCommand": "/patterns-graph help",
        "options": [
            "--format json: optional; defaults to json for MCP tool responses.",
            "--language and --scope are not needed; graph queries use the full catalog relationship map.",
        ],
        "examples": [
            '/patterns-graph "what patterns mitigate naive exactly once"',
            "/patterns-graph",
            '/patterns-graph "what patterns are related to observer"',
            '/patterns-graph "which patterns are companions of content-based-router" --format json',
        ],
        "arguments": {"query": "what patterns mitigate naive exactly once"},
    },
    "patterns-examples": {
        "tool": "patterns_examples",
        "purpose": "Show copyable /patterns-* request examples and their backing MCP tool arguments.",
        "usage": "/patterns-examples [topic]",
        "helpCommand": "/patterns-examples help",
        "options": [
            "topic: optional focus area such as scan, context, migrate, adr, graph, snippets, or recommend.",
            "Examples intentionally omit language and scope when inference should choose them from codebase and context.",
        ],
        "examples": [
            "/patterns-examples",
            "/patterns-examples scan",
            "/patterns-examples migration",
        ],
        "arguments": {"topic": "all"},
    },
    "patterns-help": {
        "tool": "patterns_help",
        "purpose": "Show help for all design-pattern slash commands or one command.",
        "usage": "/patterns-help [command]",
        "helpCommand": "/patterns-help help",
        "options": [
            "command: optional command name such as patterns-scan, /patterns-scan, or scan.",
            "Help explains when language and scope are inferred instead of supplied.",
        ],
        "examples": [
            "/patterns-help",
            "/patterns-help patterns-scan",
            "/patterns-help recommend",
        ],
        "arguments": {},
    },
    "patterns-history": {
        "tool": "patterns_recall",
        "purpose": "Recall this project's pattern memory — prior scans, recommendations, ADR decisions, and applied refactors. Consult before recommending or scanning so answers build on prior decisions instead of repeating them.",
        "usage": '/patterns-history ["<force or topic>"] [--path <path>] [--limit <n>]',
        "helpCommand": "/patterns-history help",
        "options": [
            "query: optional architecture force or topic; matching prior ADR decisions are surfaced first.",
            "--path <path>: optional file or directory; includes the most recent scan of that path.",
            "--limit <n>: optional cap on how many recent events to return. Defaults to 20.",
        ],
        "examples": [
            "/patterns-history",
            '/patterns-history "provider dispatch"',
            "/patterns-history --path backend/app/providers",
        ],
        "arguments": {},
    },
}

SLASH_COMMAND_EXAMPLES: list[dict[str, Any]] = [
    {
        "command": entry["examples"][0],
        "helpCommand": entry["helpCommand"],
        "tool": entry["tool"],
        "arguments": entry["arguments"],
    }
    for name, entry in SLASH_COMMAND_HELP.items()
]


def help_payload(command: str = "") -> dict[str, Any]:
    normalized = command.strip().lower().removeprefix("/").replace("_", "-")
    for suffix in (" help", " --help", " -h"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)].strip()
    if normalized and not normalized.startswith("patterns-"):
        normalized = f"patterns-{normalized}"
    if normalized:
        entry = SLASH_COMMAND_HELP.get(normalized)
        return {
            "command": normalized,
            "found": bool(entry),
            "help": entry,
            "availableCommands": sorted(SLASH_COMMAND_HELP),
        }
    return {
        "usage": "Run /<command> help for command-specific help, for example /patterns-scan help.",
        "commands": SLASH_COMMAND_HELP,
    }


def _arg(description: str, schema_type: str = "string", **extra: Any) -> dict[str, Any]:
    schema: dict[str, Any] = {"type": schema_type, "description": description}
    schema.update(extra)
    return schema


def _array_arg(description: str, item_description: str) -> dict[str, Any]:
    return {
        "type": "array",
        "description": description,
        "items": _arg(item_description),
    }


def tool_definitions() -> list[dict[str, Any]]:
    return [
        {
            "name": "patterns_recommend",
            "description": 'Recommend catalog patterns, playbooks, recipes, and smells for an architecture force. User slash command: /patterns-recommend "<query>" [--limit 5]. Language and scope are inferred when omitted.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": _arg("Architecture force, design problem, smell, or decision context to match against the catalog. Required because it is usually not safely inferable."),
                    "scope": _arg("Optional catalog scope override. Omit to infer object-design, integration-design, a catalog domain, or all from the prompt and codebase."),
                    "language": _arg("Optional implementation language override. Omit to infer from nearby files, project manifests, and request text."),
                    "risk": _arg("Optional decision bias. Omit to infer operability, conservative, delivery, or balanced from the request."),
                    "limit": _arg("Optional maximum number of recommendations to return. Defaults to 8 when omitted.", "integer"),
                },
            },
        },
        {
            "name": "patterns_scan",
            "description": "Scan a repository path or file for pattern-relevant architecture smells. User slash command: /patterns-scan <path> [--min-confidence 0.45] [--include-docs].",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": _arg("File or directory path to scan. Omit to infer the current project directory when the MCP process is running inside a project."),
                    "pack": _arg("Optional smell rule pack. Omit to infer object-design, integration, or all from path and query signals."),
                    "include_docs": _arg("Optional docs toggle. Omit to infer true for documentation paths and false for code paths.", "boolean"),
                    "include_generated": _arg("Optional generated-file toggle. Defaults false when omitted because generated paths are skipped unless explicitly requested.", "boolean"),
                    "min_confidence": _arg("Optional minimum confidence threshold from 0.0 to 1.0 for returned findings. Defaults to 0.0 when omitted.", "number"),
                },
            },
        },
        {
            "name": "patterns_adr",
            "description": 'Generate an ADR-style catalog-backed architecture decision seed. User slash command: /patterns-adr "<decision>". Language and scope are inferred when omitted.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": _arg("Architecture decision, competing option, force, or design context for the ADR seed. Required because the decision intent is not safely inferable."),
                    "language": _arg("Optional implementation language override. Omit to infer from codebase and request context."),
                    "scope": _arg("Optional catalog scope override. Omit to infer object-design, integration-design, a domain, or all."),
                    "status": _arg("Optional ADR status label. Omit to infer Accepted, Superseded, Deprecated, or default Proposed from decision wording."),
                },
            },
        },
        {
            "name": "patterns_context",
            "description": 'Build a model-ready context pack with scan findings, recommendations, snippets, and ADR seed. User slash command: /patterns-context <path> --query "<problem>". Language and scope are inferred when omitted.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "path": _arg("File or directory path that provides code evidence for scanning and inference. Omit to infer the current project directory when available."),
                    "query": _arg("Design question, feature goal, smell, or architecture force. Omit to infer a generic architecture-guidance query from the resolved path."),
                    "language": _arg("Optional implementation language override. Omit to infer from files, manifests, and request text."),
                    "scope": _arg("Optional catalog scope override. Omit to infer object-design, integration-design, a domain, or all."),
                    "pack": _arg("Optional scan rule pack. Omit to infer object-design, integration, or all from path and query signals."),
                },
            },
        },
        {
            "name": "patterns_graph",
            "description": 'Return the typed catalog graph or answer graph relationship questions. User slash command: /patterns-graph ["relationship question"].',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": _arg("Optional graph relationship question, such as patterns related to a slug, mitigations, alternatives, or companions."),
                    "format": _arg("Optional output preference. Defaults to json for MCP because tool responses are machine-readable JSON."),
                },
            },
        },
        {
            "name": "patterns_simulate",
            "description": 'Score likely pattern options against the architecture decision scorecard. User slash command: /patterns-simulate "<decision>" [--risk operability]. Language and scope context are inferred when omitted.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": _arg("Architecture decision, force, tradeoff, or competing pattern options to score. Required because the decision intent is not safely inferable."),
                    "language": _arg("Optional implementation language override. Omit to infer from codebase and request context."),
                    "risk": _arg("Optional scorecard bias. Omit to infer operability, conservative, delivery, or balanced from the request."),
                    "limit": _arg("Optional maximum number of candidate options to score. Defaults to 5 when omitted.", "integer"),
                },
            },
        },
        {
            "name": "patterns_migrate",
            "description": 'Create a recipe-backed migration plan from a smell/current shape to a target pattern. User slash command: /patterns-migrate "<current smell>" --to <target-pattern>. Language and scope context are inferred when omitted.',
            "inputSchema": {
                "type": "object",
                "properties": {
                    "source": _arg("Current smell, code shape, architecture problem, or source pattern to migrate from. Omit only when query supplies the current shape."),
                    "target": _arg("Target pattern slug or name to migrate toward. Omit only when it can be inferred from a unique pattern named in source or query."),
                    "language": _arg("Optional implementation language override. Omit to infer from source, target, query, and codebase context."),
                    "query": _arg("Optional extra project context, constraints, framework notes, or rollout requirements."),
                },
            },
        },
        {
            "name": "patterns_snippets",
            "description": "Return language-specific implementation snippets for catalog pattern slugs. User slash command: /patterns-snippets strategy,idempotent-receiver. Language and scope context are inferred when omitted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "patterns": _array_arg(
                        "Catalog pattern slugs to retrieve snippets for. Omit only when query names or implies patterns that can be inferred.",
                        "Catalog pattern slug, such as strategy, repository, idempotent-receiver, or content-based-router.",
                    ),
                    "query": _arg("Optional problem statement used to infer snippet pattern slugs when patterns are omitted."),
                    "language": _arg("Optional implementation language override. Omit to infer from requested patterns and codebase context."),
                },
            },
        },
        {
            "name": "patterns_examples",
            "description": "Return copyable /patterns-* slash-command examples for the design-patterns plugin. Use this when a user asks for example MCP requests or how to call the design patterns tool.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "topic": _arg("Optional focus area such as scan, context, migrate, adr, graph, snippets, recommend, or all."),
                },
            },
        },
        {
            "name": "patterns_help",
            "description": "Return help for all /patterns-* commands or one command. Use when a user asks what a design-pattern command does, including /<command> help.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": _arg("Optional command name or help phrase, such as patterns-scan, /patterns-scan, scan, or /patterns-scan help."),
                },
            },
        },
        {
            "name": "patterns_record",
            "description": "Record a durable pattern-memory outcome to the project journal: an applied refactor, an ADR status change, or a note. Skill-invoked — there is no slash command. The MCP server cannot see Edit/Write, so a skill calls this after a change actually lands.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": _arg("Record kind: applied (a refactor that landed), decision (an ADR status change), or note. Required."),
                    "pattern": _arg("For kind=applied: the catalog pattern slug that was applied, such as strategy or idempotent-receiver."),
                    "target": _arg("For kind=applied: the file or module the pattern was applied to."),
                    "adr": _arg("For kind=applied: an ADR number to link this refactor to. For kind=decision: the ADR number whose status is changing (required for kind=decision).", "integer"),
                    "status": _arg("For kind=decision: the new ADR status — accepted, superseded, or deprecated."),
                    "outcome": _arg("For kind=applied: done, partial, or reverted. Defaults to done when omitted."),
                    "summary": _arg("A short human-readable summary of what was done or decided."),
                    "sourceShape": _arg("For kind=applied: optional description of the code shape before the refactor."),
                    "verified": _arg("For kind=applied: whether the change was verified by tests or runtime checks.", "boolean"),
                },
            },
        },
        {
            "name": "patterns_recall",
            "description": "Recall what this project's pattern memory already knows — prior scans, recommendations, ADR decisions, and applied refactors. User slash command: /patterns-history. Consult this BEFORE recommending or scanning so answers build on prior decisions instead of repeating them.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": _arg("Optional architecture force or topic. When supplied, matching prior ADR decisions are surfaced first."),
                    "path": _arg("Optional file or directory. When supplied, the most recent scan of that path is included."),
                    "limit": _arg("Optional cap on how many recent events to return. Defaults to 20 when omitted.", "integer"),
                },
            },
        },
    ]


def _json_text(value: Any) -> dict[str, str]:
    return {"type": "text", "text": json.dumps(value, indent=2, sort_keys=True)}


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return not value
    return False


def _first_argument(arguments: dict[str, Any], *names: str) -> Any:
    for name in names:
        if name in arguments and not _is_blank(arguments[name]):
            return arguments[name]
    return None


def _new_resolution(tool: str) -> dict[str, Any]:
    return {
        "tool": tool,
        "provided": [],
        "inferred": [],
        "defaulted": [],
        "missing": [],
        "invalid": [],
    }


def _record(resolution: dict[str, Any], bucket: str, name: str, value: Any = None, **details: Any) -> None:
    item = {"name": name}
    if value is not None:
        item["value"] = value
    item.update({key: detail for key, detail in details.items() if detail is not None})
    resolution[bucket].append(item)


def _has_blockers(resolution: dict[str, Any]) -> bool:
    return bool(resolution["missing"] or resolution["invalid"])


def _tool_help(name: str) -> dict[str, Any] | None:
    for command, entry in SLASH_COMMAND_HELP.items():
        if entry["tool"] == name:
            return {"command": command, **entry}
    return None


def _missing_response(name: str, resolution: dict[str, Any]) -> dict[str, Any]:
    return {
        "ok": False,
        "tool": name,
        "message": "The MCP tool could not safely infer every argument it needs. Supply the listed arguments or use the help command for examples.",
        "missingArguments": resolution["missing"],
        "invalidArguments": resolution["invalid"],
        "argumentResolution": resolution,
        "help": _tool_help(name),
    }


def _with_resolution(payload: Any, resolution: dict[str, Any]) -> Any:
    if isinstance(payload, dict):
        enriched = dict(payload)
        enriched["argumentResolution"] = resolution
        return enriched
    return {"ok": True, "items": payload, "argumentResolution": resolution}


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _looks_like_project(path: Path) -> bool:
    if not path.exists() or _inside(path, PLUGIN_ROOT):
        return False
    markers = {
        ".git",
        "pyproject.toml",
        "package.json",
        "go.mod",
        "Cargo.toml",
        "pom.xml",
        "build.gradle",
        "tsconfig.json",
    }
    current = path if path.is_dir() else path.parent
    for parent in [current, *list(current.parents)[:4]]:
        if any((parent / marker).exists() for marker in markers):
            return True
    return any((current / child).exists() for child in ("src", "app", "backend", "frontend", "services"))


def _resolve_path(arguments: dict[str, Any], resolution: dict[str, Any], *, purpose: str) -> str:
    supplied = _first_argument(arguments, "path", "file", "directory")
    if supplied is not None:
        value = str(supplied).strip()
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = Path.cwd() / candidate
        if not candidate.exists():
            _record(
                resolution,
                "invalid",
                "path",
                value,
                reason=f"Resolved path does not exist for {purpose}.",
                howToFix="Pass an existing file or directory path relative to the project.",
            )
            return value
        _record(resolution, "provided", "path", value)
        return value
    cwd = Path(os.environ.get("PWD") or Path.cwd()).expanduser().resolve()
    if _looks_like_project(cwd):
        _record(resolution, "inferred", "path", str(cwd), evidence="current MCP working directory looks like a project")
        return str(cwd)
    _record(
        resolution,
        "missing",
        "path",
        whyNotInferable=f"No path was supplied and the MCP working directory does not look like a user project for {purpose}.",
        howToProvide="Pass path, for example /patterns-scan backend/app or /patterns-context services/orders --query \"duplicate delivery\".",
    )
    return ""


def _resolve_text_argument(
    arguments: dict[str, Any],
    resolution: dict[str, Any],
    name: str,
    *,
    aliases: tuple[str, ...] = (),
    required_reason: str,
    how_to_provide: str,
    inferred_value: str | None = None,
    inferred_evidence: str | None = None,
) -> str:
    supplied = _first_argument(arguments, name, *aliases)
    if supplied is not None:
        value = str(supplied).strip()
        _record(resolution, "provided", name, value)
        return value
    if inferred_value:
        _record(resolution, "inferred", name, inferred_value, evidence=inferred_evidence)
        return inferred_value
    _record(resolution, "missing", name, whyNotInferable=required_reason, howToProvide=how_to_provide)
    return ""


def _resolve_limit(arguments: dict[str, Any], resolution: dict[str, Any], *, default: int, maximum: int = 25) -> int:
    supplied = _first_argument(arguments, "limit")
    if supplied is None:
        _record(resolution, "defaulted", "limit", default, reason="No limit supplied; using the tool default.")
        return default
    try:
        value = int(supplied)
    except (TypeError, ValueError):
        _record(resolution, "invalid", "limit", supplied, reason="Limit must be an integer.", howToFix=f"Use a number from 1 to {maximum}.")
        return default
    if value < 1 or value > maximum:
        _record(resolution, "invalid", "limit", value, reason=f"Limit must be between 1 and {maximum}.", howToFix=f"Use a number from 1 to {maximum}.")
        return default
    _record(resolution, "provided", "limit", value)
    return value


def _resolve_float(
    arguments: dict[str, Any],
    resolution: dict[str, Any],
    name: str,
    *,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    supplied = _first_argument(arguments, name)
    if supplied is None:
        _record(resolution, "defaulted", name, default, reason="No value supplied; using the broadest safe default.")
        return default
    try:
        value = float(supplied)
    except (TypeError, ValueError):
        _record(resolution, "invalid", name, supplied, reason=f"{name} must be a number.", howToFix=f"Use a number from {minimum} to {maximum}.")
        return default
    if value < minimum or value > maximum:
        _record(resolution, "invalid", name, value, reason=f"{name} must be between {minimum} and {maximum}.", howToFix=f"Use a number from {minimum} to {maximum}.")
        return default
    _record(resolution, "provided", name, value)
    return value


def _resolve_bool(arguments: dict[str, Any], resolution: dict[str, Any], name: str, *, default: bool, reason: str) -> bool:
    supplied = _first_argument(arguments, name)
    if supplied is None:
        _record(resolution, "defaulted", name, default, reason=reason)
        return default
    if isinstance(supplied, bool):
        _record(resolution, "provided", name, supplied)
        return supplied
    if isinstance(supplied, str):
        folded = supplied.strip().casefold()
        if folded in {"1", "true", "yes", "y", "on"}:
            _record(resolution, "provided", name, True)
            return True
        if folded in {"0", "false", "no", "n", "off"}:
            _record(resolution, "provided", name, False)
            return False
    _record(resolution, "invalid", name, supplied, reason=f"{name} must be a boolean.", howToFix="Use true or false.")
    return default


def _query_terms(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9_.#+-]+", text.casefold()))


def _resolve_risk(arguments: dict[str, Any], resolution: dict[str, Any], query: str) -> str:
    supplied = _first_argument(arguments, "risk")
    valid = {"balanced", *RISK_TERMS}
    if supplied is not None:
        value = str(supplied).strip().casefold()
        if value not in valid:
            _record(resolution, "invalid", "risk", supplied, reason=f"Risk must be one of {', '.join(sorted(valid))}.", howToFix="Use balanced, conservative, delivery, or operability.")
            return "balanced"
        _record(resolution, "provided", "risk", value)
        return value
    terms = _query_terms(query)
    scores = {
        risk: len(terms & risk_terms) + sum(1 for term in risk_terms if term in query.casefold())
        for risk, risk_terms in RISK_TERMS.items()
    }
    risk, score = max(scores.items(), key=lambda item: (item[1], item[0]))
    if score:
        _record(resolution, "inferred", "risk", risk, evidence=f"matched {risk} terms in request")
        return risk
    _record(resolution, "defaulted", "risk", "balanced", reason="No strong risk signal found in the request.")
    return "balanced"


def _resolve_status(arguments: dict[str, Any], resolution: dict[str, Any], query: str) -> str:
    supplied = _first_argument(arguments, "status")
    if supplied is not None:
        value = str(supplied).strip()
        _record(resolution, "provided", "status", value)
        return value
    folded = query.casefold()
    for status, terms in {
        "Superseded": ("supersede", "replace previous", "replaces prior"),
        "Deprecated": ("deprecated", "retire", "sunset"),
        "Accepted": ("accepted", "decided", "approved"),
    }.items():
        if any(term in folded for term in terms):
            _record(resolution, "inferred", "status", status, evidence=f"decision wording suggests {status}")
            return status
    _record(resolution, "defaulted", "status", "Proposed", reason="No ADR lifecycle wording supplied.")
    return "Proposed"


def _resolve_format(arguments: dict[str, Any], resolution: dict[str, Any]) -> str:
    supplied = _first_argument(arguments, "format")
    if supplied is not None:
        value = str(supplied).strip().casefold()
        if value not in {"json", "mermaid", "dot"}:
            _record(resolution, "invalid", "format", supplied, reason="Format must be json, mermaid, or dot.", howToFix="Use json for MCP-friendly output.")
            return "json"
        _record(resolution, "provided", "format", value)
        return value
    _record(resolution, "defaulted", "format", "json", reason="MCP tool responses are JSON content.")
    return "json"


def _resolve_topic(arguments: dict[str, Any], resolution: dict[str, Any]) -> str:
    supplied = _first_argument(arguments, "topic")
    if supplied is not None:
        value = str(supplied).strip()
        _record(resolution, "provided", "topic", value)
        return value
    _record(resolution, "defaulted", "topic", "all", reason="No example topic supplied.")
    return "all"


def _resolve_command(arguments: dict[str, Any], resolution: dict[str, Any]) -> str:
    supplied = _first_argument(arguments, "command")
    if supplied is not None:
        value = str(supplied).strip()
        _record(resolution, "provided", "command", value)
        return value
    _record(resolution, "defaulted", "command", "all", reason="No command supplied; returning the full help index.")
    return ""


def _resolve_docs_toggle(arguments: dict[str, Any], resolution: dict[str, Any], path: str) -> bool:
    supplied = _first_argument(arguments, "include_docs")
    if supplied is not None:
        return _resolve_bool(arguments, resolution, "include_docs", default=False, reason="")
    path_text = path.casefold()
    suffix = Path(path_text).suffix
    if suffix in {".md", ".mdx", ".rst", ".adoc", ".txt", ".yaml", ".yml"} or any(part in path_text for part in ("/docs", "docs/", "architecture")):
        _record(resolution, "inferred", "include_docs", True, evidence="path looks like documentation")
        return True
    _record(resolution, "defaulted", "include_docs", False, reason="Path does not look documentation-focused.")
    return False


def _normalize_pack(value: str) -> str | None:
    folded = value.strip().casefold()
    aliases = {
        "all": "all",
        "object": "object-design",
        "objects": "object-design",
        "object-design": "object-design",
        "integration": "integration",
        "integration-design": "integration",
        "messaging": "integration",
    }
    return aliases.get(folded)


def _resolve_pack(arguments: dict[str, Any], resolution: dict[str, Any], query: str, path: str, inference: dict[str, Any]) -> str:
    supplied = _first_argument(arguments, "pack")
    if supplied is not None:
        value = _normalize_pack(str(supplied))
        if not value:
            _record(resolution, "invalid", "pack", supplied, reason="Pack must be all, object-design, integration, or integration-design.", howToFix="Use --pack all, --pack object-design, or --pack integration.")
            return "all"
        _record(resolution, "provided", "pack", value)
        return value
    scope = str(inference.get("scope") or "")
    if scope == "integration-design":
        _record(resolution, "inferred", "pack", "integration", evidence="inferred catalog scope is integration-design")
        return "integration"
    if scope == "object-design":
        _record(resolution, "inferred", "pack", "object-design", evidence="inferred catalog scope is object-design")
        return "object-design"
    text = f"{query} {path}".casefold()
    if any(term in text for term in ("queue", "topic", "message", "event", "broker", "consumer", "producer", "integration")):
        _record(resolution, "inferred", "pack", "integration", evidence="request/path contains integration terms")
        return "integration"
    if any(term in text for term in ("provider", "factory", "state", "strategy", "repository", "service", "workflow")):
        _record(resolution, "inferred", "pack", "object-design", evidence="request/path contains object-design terms")
        return "object-design"
    _record(resolution, "defaulted", "pack", "all", reason="No specific scan-pack signal found.")
    return "all"


def _add_context_inference(arguments: dict[str, Any], resolution: dict[str, Any], *, query: str = "", paths: list[str] | None = None) -> dict[str, Any]:
    explicit_language = _first_argument(arguments, "language")
    explicit_scope = _first_argument(arguments, "scope")
    inference = _inference(arguments, query=query, paths=paths)
    if explicit_language is not None:
        language_value = str(explicit_language).strip()
        if language_value not in load_language_profiles():
            _record(
                resolution,
                "invalid",
                "language",
                language_value,
                reason="Unknown language filter.",
                howToFix=f"Use one of: {', '.join(sorted(load_language_profiles()))}.",
            )
        else:
            _record(resolution, "provided", "language", language_value)
    elif inference.get("language"):
        _record(resolution, "inferred", "language", inference["language"], evidence="; ".join(inference.get("evidence", {}).get("language", [])[:3]))
    else:
        _record(resolution, "defaulted", "language", None, reason="No reliable language signal found; not filtering by language.")
    if explicit_scope is not None:
        scope_value = str(explicit_scope).strip()
        valid_scopes = scope_names(load_patterns())
        if scope_value not in valid_scopes:
            _record(
                resolution,
                "invalid",
                "scope",
                scope_value,
                reason="Unknown catalog scope.",
                howToFix=f"Use one of: {', '.join(sorted(valid_scopes))}.",
            )
        else:
            _record(resolution, "provided", "scope", scope_value)
    elif inference.get("scope") and inference.get("scope") != "all":
        _record(resolution, "inferred", "scope", inference["scope"], evidence="; ".join(inference.get("evidence", {}).get("scope", [])[:3]))
    else:
        _record(resolution, "defaulted", "scope", "all", reason="No reliable scope signal found; using the full catalog.")
    return inference


def _entry_matches_in_text(text: str) -> list[dict[str, Any]]:
    folded = text.casefold()
    matches: dict[str, dict[str, Any]] = {}
    for entry in all_entries(include_snippets=False):
        if entry.get("kind") != "pattern":
            continue
        slug = str(entry.get("slug", "")).casefold()
        name = str(entry.get("name", "")).casefold()
        slug_hit = bool(slug and re.search(rf"(?<![a-z0-9-]){re.escape(slug)}(?![a-z0-9-])", folded))
        name_hit = bool(name and re.search(rf"(?<![a-z0-9-]){re.escape(name)}(?![a-z0-9-])", folded))
        if slug_hit or name_hit:
            matches[entry["slug"]] = entry
    return list(matches.values())


def _resolve_migration_parts(arguments: dict[str, Any], resolution: dict[str, Any]) -> tuple[str, str, str]:
    query = str(_first_argument(arguments, "query", "context") or "").strip()
    source = str(_first_argument(arguments, "source", "from") or "").strip()
    target = str(_first_argument(arguments, "target", "to") or "").strip()
    if source:
        _record(resolution, "provided", "source", source)
    elif query:
        source = query
        _record(resolution, "inferred", "source", source, evidence="query provided current-shape context")
    else:
        _record(
            resolution,
            "missing",
            "source",
            whyNotInferable="No source/current smell was supplied and no query context was available.",
            howToProvide='/patterns-migrate "hardcoded provider switch" --to strategy',
        )
    if target:
        _record(resolution, "provided", "target", target)
    else:
        text = " ".join(part for part in (source, query) if part)
        matches = _entry_matches_in_text(text)
        if len(matches) == 1:
            target = matches[0]["slug"]
            _record(resolution, "inferred", "target", target, evidence=f"unique catalog pattern named in source/query: {matches[0]['name']}")
        else:
            _record(
                resolution,
                "missing",
                "target",
                whyNotInferable="No target was supplied and the request did not name exactly one catalog pattern to migrate toward.",
                howToProvide='Pass target, for example --to strategy, --to facade, or --to content-based-router.',
            )
    if query:
        _record(resolution, "provided", "query", query)
    else:
        _record(resolution, "defaulted", "query", "", reason="No extra migration context supplied.")
    return source, target, query


def _normalize_pattern_values(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_values = re.split(r"[,\s]+", value)
    elif isinstance(value, (list, tuple, set)):
        raw_values = []
        for item in value:
            raw_values.extend(_normalize_pattern_values(item))
    else:
        raw_values = [str(value)]
    return [item.strip() for item in raw_values if item and item.strip()]


def _resolve_patterns(arguments: dict[str, Any], resolution: dict[str, Any], inference: dict[str, Any]) -> set[str]:
    supplied = _first_argument(arguments, "patterns", "pattern", "slugs", "slug")
    if supplied is not None:
        slugs = set()
        unknown = []
        for value in _normalize_pattern_values(supplied):
            entry = find_entry(value, include_snippets=False)
            if entry and entry.get("kind") == "pattern":
                slugs.add(entry["slug"])
            else:
                unknown.append(value)
        if unknown:
            _record(resolution, "invalid", "patterns", unknown, reason="One or more supplied pattern slugs or names were not found.", howToFix="Use catalog slugs such as strategy or content-based-router.")
        if slugs:
            _record(resolution, "provided", "patterns", sorted(slugs))
        return slugs
    query = str(_first_argument(arguments, "query") or "").strip()
    if query:
        exact_matches = _entry_matches_in_text(query)
        if exact_matches:
            slugs = {entry["slug"] for entry in exact_matches}
            _record(resolution, "inferred", "patterns", sorted(slugs), evidence="query named catalog pattern(s)")
            return slugs
        recommendations = recommend_entries(
            query,
            scope=str(inference.get("scope") or "all"),
            language=inference.get("language") or None,
            limit=4,
            include_snippets=False,
        )
        slugs = {
            slug
            for entry in recommendations[:3]
            for slug in ([entry["slug"]] if entry.get("kind") == "pattern" else entry.get("patterns", []))
        }
        if slugs:
            _record(resolution, "inferred", "patterns", sorted(slugs), evidence="top catalog recommendations for query")
            return slugs
    _record(
        resolution,
        "missing",
        "patterns",
        whyNotInferable="No pattern slugs were supplied and no query was available to infer them.",
        howToProvide="/patterns-snippets strategy,idempotent-receiver or pass query to infer from a problem statement.",
    )
    return set()


def _inference(
    arguments: dict[str, Any],
    *,
    query: str = "",
    paths: list[str] | None = None,
) -> dict[str, Any]:
    language = arguments.get("language")
    scope = arguments.get("scope")
    return infer_request_context(
        query=query,
        paths=paths or [],
        language=str(language).strip() if language else None,
        scope=str(scope).strip() if scope else None,
    )


def _add_inference(payload: Any, inference: dict[str, Any]) -> Any:
    if isinstance(payload, dict):
        enriched = dict(payload)
        enriched["inference"] = inference
        return enriched
    return payload


def _safe_memory(func: Any, *args: Any, **kwargs: Any) -> Any:
    """Run a pattern_memory call without ever letting it break a tool call. The memory
    writers already swallow their own I/O errors; this also guards the import boundary
    and any argument-shaping mistakes."""
    try:
        return func(*args, **kwargs)
    except Exception:
        return None


def _attach_prior_decisions(payload: dict[str, Any], query: str) -> None:
    """Smart loop: surface already-recorded ADR decisions for the same force so the model
    cites an existing decision instead of re-deciding from scratch."""
    prior = _safe_memory(pattern_memory.decisions_for_force, query)
    if not prior:
        return
    payload["priorDecisions"] = prior
    if any(decision.get("status") == "accepted" for decision in prior):
        payload["memoryHint"] = (
            "This project already has an accepted ADR decision for a related force "
            "(see priorDecisions). Lead with the existing decision; only recommend "
            "something new if the user is explicitly reconsidering it."
        )
    else:
        payload["memoryHint"] = (
            "This project has prior ADR decisions for a related force (see priorDecisions) "
            "— reference them rather than starting from zero."
        )


def call_tool(name: str, arguments: dict[str, Any]) -> Any:
    if name == "patterns_help":
        resolution = _new_resolution(name)
        command = _resolve_command(arguments, resolution)
        return _with_resolution(help_payload(command), resolution)
    if name == "patterns_examples":
        resolution = _new_resolution(name)
        topic = _resolve_topic(arguments, resolution)
        return _with_resolution({
            "usage": "When users ask for example MCP requests, lead with these copyable slash commands instead of describing tool schemas.",
            "format": '/patterns-<action> <required-argument> [--optional-flag value]',
            "topic": topic,
            "slashCommands": SLASH_COMMAND_EXAMPLES,
            "help": "Run /<command> help for command-specific help, for example /patterns-recommend help.",
        }, resolution)
    if name == "patterns_recommend":
        resolution = _new_resolution(name)
        query = _resolve_text_argument(
            arguments,
            resolution,
            "query",
            aliases=("problem", "decision", "context"),
            required_reason="A recommendation needs a force, problem, smell, or decision. The tool cannot safely invent that from the codebase alone.",
            how_to_provide='/patterns-recommend "add a new provider without changing execution code"',
        )
        inference = _add_context_inference(arguments, resolution, query=query)
        risk = _resolve_risk(arguments, resolution, query)
        limit = _resolve_limit(arguments, resolution, default=8)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        recommendations = recommend_entries(
            query,
            scope=str(inference.get("scope") or "all"),
            language=inference.get("language") or None,
            risk=risk,
            limit=limit,
            include_snippets=True,
        )
        payload = {
            "query": query,
            "language": inference.get("language"),
            "scope": inference.get("scope") or "all",
            "risk": risk,
            "limit": limit,
            "recommendations": recommendations,
        }
        _attach_prior_decisions(payload, query)
        _safe_memory(pattern_memory.record_recommendation, payload)
        return _with_resolution(payload, resolution)
    if name == "patterns_scan":
        resolution = _new_resolution(name)
        path = _resolve_path(arguments, resolution, purpose="architecture smell scanning")
        inference = _add_context_inference(arguments, resolution, query=path, paths=[path] if path else [])
        pack = _resolve_pack(arguments, resolution, path, path, inference)
        include_docs = _resolve_docs_toggle(arguments, resolution, path)
        include_generated = _resolve_bool(
            arguments,
            resolution,
            "include_generated",
            default=False,
            reason="Generated files are excluded unless explicitly requested.",
        )
        min_confidence = _resolve_float(arguments, resolution, "min_confidence", default=0.0, minimum=0.0, maximum=1.0)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        scan_result = scan_path(
            path,
            pack=pack,
            include_docs=include_docs,
            include_generated=include_generated,
            min_confidence=min_confidence,
        )
        payload = _add_inference(scan_result, inference)
        # Smart loop: diff against the last stored scan of this path *before* recording.
        diff = _safe_memory(pattern_memory.scan_diff, path, scan_result)
        if diff is not None:
            payload["memoryDiff"] = diff
        _safe_memory(
            pattern_memory.record_scan,
            scan_result,
            path=path,
            pack=pack,
            min_confidence=min_confidence,
        )
        return _with_resolution(payload, resolution)
    if name == "patterns_adr":
        resolution = _new_resolution(name)
        query = _resolve_text_argument(
            arguments,
            resolution,
            "query",
            aliases=("decision", "problem", "context"),
            required_reason="An ADR needs the decision or architecture force. The tool cannot safely infer the decision intent from codebase context alone.",
            how_to_provide='/patterns-adr "durable event storage for SSE replay: Redis vs PostgreSQL"',
        )
        inference = _add_context_inference(arguments, resolution, query=query)
        status = _resolve_status(arguments, resolution, query)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        scope = str(inference.get("scope") or "all")
        adr_result = adr_payload(
            query,
            status=status,
            language=inference.get("language") or None,
            scope=scope,
        )
        payload = _add_inference(adr_result, inference)
        recorded = _safe_memory(
            pattern_memory.record_decision,
            adr_result,
            status=status,
            scope=scope,
            language=inference.get("language") or None,
        )
        if isinstance(recorded, dict) and isinstance(recorded.get("adrNumber"), int):
            payload["adrNumber"] = recorded["adrNumber"]
        return _with_resolution(payload, resolution)
    if name == "patterns_context":
        resolution = _new_resolution(name)
        path = _resolve_path(arguments, resolution, purpose="context-pack generation")
        inferred_query = f"architecture guidance for {path}" if path else None
        query = _resolve_text_argument(
            arguments,
            resolution,
            "query",
            aliases=("problem", "decision", "context"),
            required_reason="A context pack needs a design question. It can infer a generic one only after a project path is resolved.",
            how_to_provide='/patterns-context backend/app/providers --query "adding a new provider safely"',
            inferred_value=inferred_query,
            inferred_evidence="resolved path supplies the context-pack subject",
        )
        inference = _add_context_inference(arguments, resolution, query=query, paths=[path] if path else [])
        pack = _resolve_pack(arguments, resolution, query, path, inference)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        return _with_resolution(
            _add_inference(
                context_pack(
                    path,
                    query,
                    language=inference.get("language") or None,
                    scope=str(inference.get("scope") or "all"),
                    pack=pack,
                ),
                inference,
            ),
            resolution,
        )
    if name == "patterns_graph":
        resolution = _new_resolution(name)
        query = str(_first_argument(arguments, "query", "question") or "").strip()
        if query:
            _record(resolution, "provided", "query", query)
        else:
            _record(resolution, "defaulted", "query", "", reason="No relationship question supplied; returning the full catalog graph.")
        _resolve_format(arguments, resolution)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        return _with_resolution(graph_query(query) if query else catalog_graph(), resolution)
    if name == "patterns_simulate":
        resolution = _new_resolution(name)
        query = _resolve_text_argument(
            arguments,
            resolution,
            "query",
            aliases=("decision", "problem", "context"),
            required_reason="A simulation needs the decision, tradeoff, or candidate options. The tool cannot safely infer those from the codebase alone.",
            how_to_provide='/patterns-simulate "Strategy vs Chain of Responsibility for provider failover"',
        )
        inference = _add_context_inference(arguments, resolution, query=query)
        risk = _resolve_risk(arguments, resolution, query)
        limit = _resolve_limit(arguments, resolution, default=5)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        return _with_resolution(
            _add_inference(
                decision_simulation(
                    query,
                    language=inference.get("language") or None,
                    risk=risk,
                    limit=limit,
                ),
                inference,
            ),
            resolution,
        )
    if name == "patterns_migrate":
        resolution = _new_resolution(name)
        source, target, extra_query = _resolve_migration_parts(arguments, resolution)
        inference_query = " ".join(part for part in [source, target, extra_query] if part)
        inference = _add_context_inference(arguments, resolution, query=inference_query)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        return _with_resolution(
            _add_inference(
                migration_plan(
                    source,
                    target,
                    language=inference.get("language") or None,
                    query=extra_query,
                ),
                inference,
            ),
            resolution,
        )
    if name == "patterns_snippets":
        resolution = _new_resolution(name)
        query = str(_first_argument(arguments, "query") or "")
        supplied_patterns = _first_argument(arguments, "patterns", "pattern", "slugs", "slug")
        query_for_inference = " ".join(_normalize_pattern_values(supplied_patterns)) if supplied_patterns is not None else query
        inference = _add_context_inference(arguments, resolution, query=query_for_inference)
        patterns = _resolve_patterns(arguments, resolution, inference)
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        snippets = snippet_matches(patterns, inference.get("language") or None)
        return _with_resolution(
            {
                "patterns": sorted(patterns),
                "language": inference.get("language"),
                "snippets": snippets,
            },
            resolution,
        )
    if name == "patterns_record":
        resolution = _new_resolution(name)
        kind = _resolve_text_argument(
            arguments,
            resolution,
            "kind",
            aliases=("type",),
            required_reason="patterns_record needs a record kind: applied, decision, or note.",
            how_to_provide='patterns_record {"kind": "applied", "pattern": "strategy", "target": "src/providers.py"}',
        )
        kind_value = str(kind or "").strip().lower()
        if kind_value == "applied":
            if _is_blank(arguments.get("pattern")):
                _record(
                    resolution,
                    "missing",
                    "pattern",
                    whyNotInferable="An applied refactor must name the catalog pattern slug that was applied.",
                    howToProvide='Pass pattern, e.g. {"kind":"applied","pattern":"strategy","target":"src/providers.py"}.',
                )
            if _is_blank(arguments.get("target")):
                _record(
                    resolution,
                    "missing",
                    "target",
                    whyNotInferable="An applied refactor must name the file or module it was applied to.",
                    howToProvide='Pass target, e.g. {"kind":"applied","pattern":"strategy","target":"src/providers.py"}.',
                )
        elif kind_value == "decision":
            if arguments.get("adr") is None:
                _record(
                    resolution,
                    "missing",
                    "adr",
                    whyNotInferable="A decision record must reference the ADR number whose status is changing.",
                    howToProvide='Pass adr, e.g. {"kind":"decision","adr":3,"status":"accepted"}.',
                )
        if _has_blockers(resolution):
            return _missing_response(name, resolution)
        result = _safe_memory(pattern_memory.record_from_tool, kind, arguments)
        if result is None:
            result = {"recorded": False, "error": "pattern memory is unavailable"}
        return _with_resolution(result, resolution)
    if name == "patterns_recall":
        resolution = _new_resolution(name)
        query = str(_first_argument(arguments, "query", "topic", "force") or "").strip()
        path = str(_first_argument(arguments, "path", "file", "directory") or "").strip()
        if query:
            _record(resolution, "provided", "query", query)
        if path:
            _record(resolution, "provided", "path", path)
        limit = _resolve_limit(arguments, resolution, default=20)
        summary = _safe_memory(pattern_memory.recall_summary, query or None, path or None, limit)
        if summary is None:
            summary = {"error": "pattern memory is unavailable", "decisions": [], "recentEvents": []}
        return _with_resolution(summary, resolution)
    raise ValueError(f"Unknown tool: {name}")


def handle_request(request: dict[str, Any]) -> dict[str, Any] | None:
    method = request.get("method")
    request_id = request.get("id")
    try:
        if method == "initialize":
            return {
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": SERVER_INFO,
                },
            }
        if method == "notifications/initialized":
            return None
        if method == "tools/list":
            return {"jsonrpc": "2.0", "id": request_id, "result": {"tools": tool_definitions()}}
        if method == "tools/call":
            params = request.get("params", {})
            result = call_tool(str(params.get("name", "")), dict(params.get("arguments", {})))
            return {"jsonrpc": "2.0", "id": request_id, "result": {"content": [_json_text(result)]}}
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32601, "message": f"Method not found: {method}"},
        }
    except Exception as exc:  # noqa: BLE001 - JSON-RPC servers should return protocol errors.
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "error": {"code": -32000, "message": str(exc)},
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

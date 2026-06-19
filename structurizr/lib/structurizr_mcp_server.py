"""Stdio MCP server for Structurizr plugin."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from structurizr_catalog import (  # noqa: E402
    format_keyword,
    list_cookbook,
    list_keywords,
    list_patterns,
    load_cookbook,
    load_expressions,
    load_inspections,
    load_keyword,
    load_pattern,
)
from structurizr_cli_wrapper import run_cli  # noqa: E402
from structurizr_lint import lint_file  # noqa: E402


TOOLS = [
    {
        "name": "structurizr_lookup",
        "description": "Look up a Structurizr DSL keyword, property, or construct.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "DSL keyword or slug (e.g. container, systemContext)"},
            },
            "required": ["keyword"],
        },
    },
    {
        "name": "structurizr_list_keywords",
        "description": "List all indexed DSL keywords.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "structurizr_expressions",
        "description": "List element or relationship view expressions.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["element", "relationship"], "description": "Expression kind"},
            },
            "required": ["kind"],
        },
    },
    {
        "name": "structurizr_pattern",
        "description": "Load a Structurizr pattern catalog entry.",
        "inputSchema": {
            "type": "object",
            "properties": {"slug": {"type": "string", "description": "Pattern slug e.g. kubernetes"}},
            "required": ["slug"],
        },
    },
    {
        "name": "structurizr_cookbook",
        "description": "Load a Structurizr cookbook recipe.",
        "inputSchema": {
            "type": "object",
            "properties": {"slug": {"type": "string", "description": "Cookbook slug"}},
            "required": ["slug"],
        },
    },
    {
        "name": "structurizr_lint",
        "description": "Lint a workspace.dsl file (no Java required).",
        "inputSchema": {
            "type": "object",
            "properties": {"workspace": {"type": "string", "description": "Path to .dsl file"}},
            "required": ["workspace"],
        },
    },
    {
        "name": "structurizr_validate",
        "description": "Validate workspace via official Structurizr CLI when installed.",
        "inputSchema": {
            "type": "object",
            "properties": {"workspace": {"type": "string", "description": "Path to .dsl or .json file"}},
            "required": ["workspace"],
        },
    },
    {
        "name": "structurizr_inspect",
        "description": "Inspect workspace via official Structurizr CLI when installed.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "workspace": {"type": "string"},
                "severity": {"type": "string", "description": "Comma-separated: error,warning,info"},
            },
            "required": ["workspace"],
        },
    },
    {
        "name": "structurizr_inspections",
        "description": "List built-in workspace inspection types.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "structurizr_list_patterns",
        "description": "List available pattern catalog slugs.",
        "inputSchema": {"type": "object", "properties": {}},
    },
]


def send(msg: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle_tool(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    if name == "structurizr_lookup":
        entry = load_keyword(arguments["keyword"])
        if not entry:
            return {"content": [{"type": "text", "text": f"Unknown keyword: {arguments['keyword']}"}], "isError": True}
        return {"content": [{"type": "text", "text": format_keyword(entry)}]}

    if name == "structurizr_list_keywords":
        return {"content": [{"type": "text", "text": "\n".join(list_keywords())}]}

    if name == "structurizr_expressions":
        exprs = load_expressions(arguments.get("kind", "element"))
        text = "\n".join(f"{e['form']}: {e['meaning']}" for e in exprs)
        return {"content": [{"type": "text", "text": text}]}

    if name == "structurizr_pattern":
        p = load_pattern(arguments["slug"])
        if not p:
            return {"content": [{"type": "text", "text": "Pattern not found"}], "isError": True}
        return {"content": [{"type": "text", "text": p["body"]}]}

    if name == "structurizr_cookbook":
        c = load_cookbook(arguments["slug"])
        if not c:
            return {"content": [{"type": "text", "text": "Cookbook entry not found"}], "isError": True}
        return {"content": [{"type": "text", "text": c["body"]}]}

    if name == "structurizr_lint":
        path = Path(arguments["workspace"])
        violations = lint_file(path)
        text = "\n".join(f"{v.severity} L{v.line} [{v.code}] {v.message}" for v in violations) or "No violations"
        return {"content": [{"type": "text", "text": text}]}

    if name == "structurizr_validate":
        code, out, err = run_cli(["validate"], Path(arguments["workspace"]))
        text = (out or err or f"exit {code}").strip()
        return {"content": [{"type": "text", "text": text}], "isError": code not in (0, 127)}

    if name == "structurizr_inspect":
        args = ["inspect"]
        if arguments.get("severity"):
            args.extend(["-severity", arguments["severity"]])
        code, out, err = run_cli(args, Path(arguments["workspace"]))
        text = (out or err or f"exit {code}").strip()
        return {"content": [{"type": "text", "text": text}], "isError": code not in (0, 127)}

    if name == "structurizr_inspections":
        items = load_inspections()
        text = "\n".join(f"{i['type']}: {i['description']}" for i in items)
        return {"content": [{"type": "text", "text": text}]}

    if name == "structurizr_list_patterns":
        return {"content": [{"type": "text", "text": "\n".join(list_patterns())}]}

    return {"content": [{"type": "text", "text": f"Unknown tool: {name}"}], "isError": True}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        rid = req.get("id")
        method = req.get("method", "")

        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": rid,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "structurizr", "version": "0.1.0"},
                },
            })
        elif method == "notifications/initialized":
            pass
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}})
        elif method == "tools/call":
            params = req.get("params", {})
            result = handle_tool(params.get("name", ""), params.get("arguments") or {})
            send({"jsonrpc": "2.0", "id": rid, "result": result})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": rid, "result": {}})
        else:
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": f"Method not found: {method}"}})


if __name__ == "__main__":
    main()
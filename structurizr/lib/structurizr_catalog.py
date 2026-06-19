"""Load Structurizr DSL reference catalog from bundled data/."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def load_index() -> dict[str, Any]:
    return json.loads((DATA / "dsl-index.json").read_text(encoding="utf-8"))


def list_keywords() -> list[str]:
    return sorted(p.stem for p in (DATA / "keywords").glob("*.yaml"))


def load_keyword(slug: str) -> dict[str, Any] | None:
    path = DATA / "keywords" / f"{slug}.yaml"
    if not path.exists():
        # fuzzy: match keyword field
        for candidate in (DATA / "keywords").glob("*.yaml"):
            entry = yaml.safe_load(candidate.read_text(encoding="utf-8"))
            if entry.get("keyword", "").lower() == slug.lower() or entry.get("slug") == slug:
                return entry
        return None
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def load_expressions(kind: str) -> list[dict[str, str]]:
    name = "element-expressions" if kind.startswith("element") else "relationship-expressions"
    payload = yaml.safe_load((DATA / "expressions" / f"{name}.yaml").read_text(encoding="utf-8"))
    return payload.get("expressions", [])


def load_inspections() -> list[dict[str, str]]:
    payload = yaml.safe_load((DATA / "inspections" / "types.yaml").read_text(encoding="utf-8"))
    return payload.get("inspections", [])


def load_relationship_matrix() -> list[dict[str, Any]]:
    payload = yaml.safe_load((DATA / "relationship-matrix.yaml").read_text(encoding="utf-8"))
    return payload.get("matrix", [])


def load_pattern(slug: str) -> dict[str, str] | None:
    path = DATA / "patterns" / f"{slug}.md"
    if not path.exists():
        return None
    text = path.read_text(encoding="utf-8")
    meta: dict[str, str] = {}
    body = text
    if text.startswith("---"):
        _, front, body = text.split("---", 2)
        for line in front.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return {"slug": slug, "meta": meta, "body": body.strip()}


def list_patterns() -> list[str]:
    return sorted(p.stem for p in (DATA / "patterns").glob("*.md"))


def load_cookbook(slug: str) -> dict[str, str] | None:
    path = DATA / "cookbook" / f"{slug}.md"
    if not path.exists():
        return None
    return {"slug": slug, "body": path.read_text(encoding="utf-8").strip()}


def list_cookbook() -> list[str]:
    return sorted(p.stem for p in (DATA / "cookbook").glob("*.md"))


def format_keyword(entry: dict[str, Any]) -> str:
    lines = [
        f"# {entry.get('keyword')} ({entry.get('category', '')})",
        "",
        entry.get("description", ""),
        "",
        f"Grammar: `{entry.get('grammar', '')}`",
        f"Docs: {entry.get('doc_url', '')}",
    ]
    children = entry.get("permitted_children") or []
    if children:
        lines += ["", "Permitted children:", *[f"- {c}" for c in children]]
    tags = entry.get("default_tags") or []
    if tags:
        lines += ["", "Default tags:", ", ".join(tags)]
    mistakes = entry.get("common_mistakes") or []
    if mistakes:
        lines += ["", "Common mistakes:", *[f"- {m}" for m in mistakes]]
    examples = entry.get("examples") or []
    if examples:
        lines += ["", "Example:", "```", examples[0], "```"]
    return "\n".join(lines)
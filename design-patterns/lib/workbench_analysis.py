"""Shared payload builders for the dynamic design-pattern workbench."""

from __future__ import annotations

from collections import Counter
from typing import Any

from pattern_catalog import load_language_profiles, load_patterns, load_smells
from pattern_context import context_pack, decision_simulation, migration_plan, snippet_matches
from pattern_graph import catalog_graph, graph_query, neighborhood
from pattern_intelligence import (
    KIND_ORDER,
    adr_payload as intelligence_adr_payload,
    all_entries,
    decision_paths,
    entry_summary,
    find_entry,
    matrix_payload as intelligence_matrix_payload,
    recommendation_payload as intelligence_recommendation_payload,
    score_entry as intelligence_score_entry,
)
from pattern_scanner import scan_text


CLASSIC_OBJECT_PATTERNS = {
    "abstract-factory",
    "adapter",
    "bridge",
    "builder",
    "chain-of-responsibility",
    "command",
    "composite",
    "decorator",
    "facade",
    "factory-method",
    "flyweight",
    "interpreter",
    "iterator",
    "mediator",
    "memento",
    "observer",
    "prototype",
    "proxy",
    "singleton",
    "state",
    "strategy",
    "template-method",
    "visitor",
}


def json_safe(value: object) -> object:
    if isinstance(value, dict):
        return {str(key): json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe(item) for item in value]
    return value


def facets(entries: list[dict[str, Any]]) -> dict[str, list[str]]:
    def collect(key: str) -> list[str]:
        values = set()
        for entry in entries:
            value = entry.get(key)
            if isinstance(value, list):
                values.update(str(item) for item in value)
            elif value:
                values.add(str(value))
        return sorted(values)

    return {
        "kinds": collect("kind"),
        "domains": collect("domain"),
        "groups": collect("groups"),
        "languages": sorted(load_language_profiles()),
        "qualityAttributes": collect("qualityAttributes"),
        "patterns": sorted({pattern["slug"] for pattern in load_patterns()}),
        "smells": sorted({smell["slug"] for smell in load_smells()}),
    }


def filtered_entries(params: dict[str, list[str]]) -> list[dict[str, Any]]:
    query = params.get("q", [""])[0].strip()
    filters = {
        key: params.get(key, [""])[0]
        for key in ("kind", "domain", "group", "language", "quality", "pattern", "smell")
    }
    matches = []
    for entry in all_entries(include_snippets=True):
        if filters["kind"] and entry.get("kind") != filters["kind"]:
            continue
        if filters["domain"] and entry.get("domain") != filters["domain"]:
            continue
        if filters["group"] and filters["group"] not in entry.get("groups", []):
            continue
        if filters["language"] and filters["language"] not in entry.get("languages", [entry.get("language")]) and entry.get("slug") != filters["language"]:
            continue
        if filters["quality"] and filters["quality"] not in entry.get("qualityAttributes", []):
            continue
        if filters["pattern"] and filters["pattern"] not in entry.get("patterns", []) and entry.get("slug") != filters["pattern"]:
            continue
        if filters["smell"] and filters["smell"] not in entry.get("smells", []) and entry.get("slug") != filters["smell"]:
            continue
        scoring = intelligence_score_entry(entry, query) if query else {"score": 1, "matchedTerms": [], "matchedFields": {}, "matchedForces": []}
        if query and scoring["score"] <= 0:
            continue
        result = dict(entry)
        result.update(scoring)
        result["summary"] = entry_summary(result)
        matches.append(result)
    matches.sort(key=lambda item: (-int(item.get("score", 0)), KIND_ORDER.get(item.get("kind", ""), 99), item.get("slug", "")))
    return matches


def recommendation_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    return intelligence_recommendation_payload(params)


def scan_text_payload(text: str) -> dict[str, Any]:
    return scan_text(text, source="<workbench-text>")


def matrix_payload() -> dict[str, Any]:
    return intelligence_matrix_payload()


def neighborhood_payload(slug: str) -> dict[str, Any]:
    payload = neighborhood(slug)
    if payload.get("entry"):
        payload["paths"] = decision_paths([payload["entry"]])
    return payload


def brief_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    context = params.get("context", [""])[0].strip()
    slugs = [slug.strip() for slug in params.get("slugs", [""])[0].split(",") if slug.strip()]
    entries = [entry for slug in slugs if (entry := find_entry(slug))]
    if not entries and context:
        entries = recommendation_payload({"q": [context]}).get("recommendations", [])[:3]
    title = "Pattern Implementation Brief"
    lines = [
        f"# {title}",
        "",
        "## Context",
        context or "Use the selected catalog entries as the implementation context.",
        "",
        "## Recommended Moves",
    ]
    for entry in entries[:5]:
        lines.append(f"- {entry['name']} (`{entry['slug']}`): {entry_summary(entry)}")
        if entry.get("whyMatched"):
            lines.append(f"  Reason: {'; '.join(entry['whyMatched'][:2])}")
    lines.extend(["", "## Implementation Sequence"])
    steps = []
    for entry in entries[:4]:
        steps.extend(entry.get("implementationSteps", []) or entry.get("steps", []) or entry.get("implementationNotes", []) or entry.get("whenToUse", []))
    for index, step in enumerate(steps[:8], start=1):
        lines.append(f"{index}. {step}")
    lines.extend(["", "## Verification"])
    checks = []
    for entry in entries[:4]:
        checks.extend(entry.get("testing", []) or entry.get("tests", []) or entry.get("verification", []) or entry.get("checks", []))
    for check in checks[:8]:
        lines.append(f"- {check}")
    lines.extend(["", "## Rollback And Guardrails"])
    guardrails = []
    for entry in entries[:4]:
        guardrails.extend(entry.get("avoidWhen", []) or entry.get("rollback", []) or entry.get("failureModeNotes", []))
    for guardrail in guardrails[:8]:
        lines.append(f"- {guardrail}")
    pattern_slugs = {
        slug
        for entry in entries
        for slug in ([entry["slug"]] if entry.get("kind") == "pattern" else entry.get("patterns", []))
    }
    return {"entries": entries, "snippets": snippet_matches(pattern_slugs), "markdown": "\n".join(lines)}


def graph_payload() -> dict[str, Any]:
    return catalog_graph()


def adr_payload(query: str) -> dict[str, Any]:
    return intelligence_adr_payload(query)


def context_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    return context_pack(
        params.get("path", ["."])[0],
        params.get("q", params.get("query", [""]))[0],
        language=params.get("language", [""])[0] or None,
        scope=params.get("scope", ["all"])[0] or "all",
    )


def simulation_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    return decision_simulation(
        params.get("q", params.get("query", [""]))[0],
        language=params.get("language", [""])[0] or None,
        risk=params.get("risk", ["balanced"])[0] or "balanced",
    )


def migration_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    return migration_plan(
        params.get("from", params.get("source", [""]))[0],
        params.get("to", params.get("target", [""]))[0],
        language=params.get("language", [""])[0] or None,
        query=params.get("q", params.get("query", [""]))[0],
    )


def graph_query_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    return graph_query(params.get("q", params.get("query", [""]))[0])


def coverage_payload() -> dict[str, Any]:
    patterns = load_patterns()
    object_slugs = {pattern["slug"] for pattern in patterns if "object-design" in pattern.get("groups", [])}
    missing_classic = sorted(CLASSIC_OBJECT_PATTERNS - object_slugs)
    missing_python = sorted(pattern["slug"] for pattern in patterns if "python" not in pattern.get("languages", []))
    counts = Counter(pattern.get("domain", "unknown") for pattern in patterns)
    return {
        "classicObjectPatternCount": len(CLASSIC_OBJECT_PATTERNS),
        "catalogObjectPatternCount": len(object_slugs),
        "missingClassicObjectPatterns": missing_classic,
        "patternsMissingPython": missing_python,
        "pythonSupported": not missing_python,
        "domainCounts": dict(sorted(counts.items())),
    }

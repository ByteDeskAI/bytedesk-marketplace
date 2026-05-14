"""Relationship graph helpers for design-pattern catalog intelligence."""

from __future__ import annotations

import re
from collections import defaultdict
from typing import Any

from pattern_intelligence import all_entries, entry_summary, find_entry, recommend_entries


EDGE_PRIORITY = {
    "requires": 0,
    "enables": 1,
    "mitigates": 2,
    "conflicts-with": 3,
    "supersedes": 4,
    "implementation-of": 5,
    "uses": 6,
    "companion": 7,
    "alternative": 8,
    "often-confused-with": 9,
    "related": 10,
    "references": 11,
}
PATTERN_RESPONSE_KINDS = {"pattern", "playbook", "recipe", "framework", "snippet"}


def _add_edge(edges: dict[tuple[str, str, str], dict[str, str]], source: str, target: str, edge_type: str) -> None:
    if not source or not target or source == target:
        return
    edges.setdefault((source, target, edge_type), {"source": source, "target": target, "type": edge_type})


def catalog_graph(include_snippets: bool = True) -> dict[str, Any]:
    """Build a typed relationship graph for patterns, smells, recipes, frameworks, and snippets."""

    entries = all_entries(include_snippets=include_snippets)
    known = {entry["slug"] for entry in entries}
    nodes = [
        {
            "id": entry["slug"],
            "label": entry.get("name", entry["slug"]),
            "kind": entry.get("kind", "entry"),
            "domain": entry.get("domain", ""),
            "groups": entry.get("groups", []),
            "summary": entry_summary(entry),
        }
        for entry in entries
    ]
    edges: dict[tuple[str, str, str], dict[str, str]] = {}

    for entry in entries:
        slug = entry["slug"]
        kind = entry.get("kind", "")
        for relationship in entry.get("relationships", []):
            if ":" in relationship:
                edge_type, target = relationship.split(":", 1)
            else:
                edge_type, target = "related", relationship
            if target in known:
                _add_edge(edges, slug, target, edge_type)

        for related in entry.get("related", []):
            if related in known:
                _add_edge(edges, slug, related, "related")

        for target in entry.get("patterns", []):
            if target not in known:
                continue
            if kind in {"framework", "recipe", "snippet"}:
                _add_edge(edges, slug, target, "implementation-of")
            elif kind == "smell":
                _add_edge(edges, target, slug, "mitigates")
            else:
                _add_edge(edges, slug, target, "uses")

        for target in entry.get("smells", []):
            if target not in known:
                continue
            if kind in PATTERN_RESPONSE_KINDS:
                _add_edge(edges, slug, target, "mitigates")
            else:
                _add_edge(edges, slug, target, "references")

    by_pair: dict[tuple[str, str], set[str]] = defaultdict(set)
    for edge in edges.values():
        by_pair[(edge["source"], edge["target"])].add(edge["type"])
    for (source, target), types in by_pair.items():
        if "alternative" in types:
            _add_edge(edges, source, target, "conflicts-with")
        if "companion" in types:
            _add_edge(edges, source, target, "enables")

    typed_edges = sorted(
        edges.values(),
        key=lambda item: (
            EDGE_PRIORITY.get(item["type"], 99),
            item["source"],
            item["target"],
        ),
    )
    return {"nodes": nodes, "edges": typed_edges, "edgeTypes": sorted({edge["type"] for edge in typed_edges})}


def _folded_tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-z0-9][a-z0-9-]*", text.casefold()))


def graph_query(query: str, limit: int = 12) -> dict[str, Any]:
    """Return graph neighborhoods and inferred answers for natural-language graph questions."""

    graph = catalog_graph()
    entries = {entry["slug"]: entry for entry in all_entries()}
    nodes = {node["id"]: node for node in graph["nodes"]}
    query_folded = query.casefold().strip()
    query_terms = _folded_tokens(query)
    edge_type = ""
    for candidate in graph["edgeTypes"]:
        if candidate in query_folded:
            edge_type = candidate
            break
    if not edge_type:
        for alias, canonical in {
            "fix": "mitigates",
            "fixes": "mitigates",
            "mitigate": "mitigates",
            "prevents": "mitigates",
            "implements": "implementation-of",
            "implemented": "implementation-of",
            "requires": "requires",
            "needs": "requires",
            "enables": "enables",
            "conflicts": "conflicts-with",
            "instead": "alternative",
        }.items():
            if alias in query_folded:
                edge_type = canonical
                break

    matches = recommend_entries(query, limit=8, include_snippets=False)
    target_slugs = [match["slug"] for match in matches]
    for slug in entries:
        if slug in query_folded:
            target_slugs.insert(0, slug)
    deduped_targets = []
    for slug in target_slugs:
        if slug not in deduped_targets:
            deduped_targets.append(slug)

    scored_edges = []
    for edge in graph["edges"]:
        if edge_type and edge["type"] != edge_type:
            continue
        source_terms = _folded_tokens(edge["source"] + " " + nodes.get(edge["source"], {}).get("label", ""))
        target_terms = _folded_tokens(edge["target"] + " " + nodes.get(edge["target"], {}).get("label", ""))
        score = len(query_terms & (source_terms | target_terms))
        if edge["source"] in deduped_targets or edge["target"] in deduped_targets:
            score += 8
        if score:
            item = dict(edge)
            item["score"] = score
            item["sourceNode"] = nodes.get(edge["source"])
            item["targetNode"] = nodes.get(edge["target"])
            scored_edges.append(item)
    scored_edges.sort(key=lambda item: (-item["score"], EDGE_PRIORITY.get(item["type"], 99), item["source"], item["target"]))
    selected_edges = scored_edges[:limit]
    selected_node_ids = {edge["source"] for edge in selected_edges} | {edge["target"] for edge in selected_edges}
    selected_nodes = [nodes[slug] for slug in sorted(selected_node_ids) if slug in nodes]

    answers = []
    for edge in selected_edges:
        source = nodes.get(edge["source"], {})
        target = nodes.get(edge["target"], {})
        if edge["type"] == "mitigates":
            answers.append(f"{source.get('label', edge['source'])} mitigates {target.get('label', edge['target'])}.")
        elif edge["type"] == "implementation-of":
            answers.append(f"{source.get('label', edge['source'])} provides implementation guidance for {target.get('label', edge['target'])}.")
        elif edge["type"] == "uses":
            answers.append(f"{source.get('label', edge['source'])} uses {target.get('label', edge['target'])}.")
        else:
            answers.append(f"{source.get('label', edge['source'])} {edge['type']} {target.get('label', edge['target'])}.")

    return {
        "query": query,
        "edgeType": edge_type or None,
        "matches": matches,
        "nodes": selected_nodes,
        "edges": selected_edges,
        "answers": answers[:limit],
    }


def neighborhood(slug_or_name: str, limit: int = 16) -> dict[str, Any]:
    entry = find_entry(slug_or_name)
    if not entry:
        return {"error": "not found"}
    graph = catalog_graph()
    nodes = {node["id"]: node for node in graph["nodes"]}
    outgoing = [edge for edge in graph["edges"] if edge["source"] == entry["slug"]]
    incoming = [edge for edge in graph["edges"] if edge["target"] == entry["slug"]]
    related_ids = {edge["target"] for edge in outgoing} | {edge["source"] for edge in incoming}
    return {
        "entry": entry,
        "outgoing": outgoing[:limit],
        "incoming": incoming[:limit],
        "related": [nodes[slug] for slug in sorted(related_ids) if slug in nodes][:limit],
    }

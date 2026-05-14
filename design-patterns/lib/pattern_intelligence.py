"""Shared recommendation, graph, and decision helpers for the pattern catalog."""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

from pattern_catalog import (
    attach_language,
    entry_search_text,
    load_catalog,
    load_frameworks,
    load_language_profiles,
    load_patterns,
    load_playbooks,
    load_recipes,
    load_scorecards,
    load_smells,
    load_snippets,
    load_taxonomy,
    matches_scope,
)


KIND_ORDER = {
    "pattern": 0,
    "playbook": 1,
    "smell": 2,
    "framework": 3,
    "recipe": 4,
    "scorecard": 5,
    "snippet": 6,
    "language": 7,
}
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "code",
    "for",
    "from",
    "has",
    "have",
    "in",
    "into",
    "is",
    "it",
    "its",
    "of",
    "on",
    "or",
    "our",
    "that",
    "the",
    "this",
    "to",
    "we",
    "with",
}
SUMMARY_FIELDS = ("intent", "symptom", "goal", "outputContract", "whyItMatters")
LIST_SUMMARY_FIELDS = (
    "bestFor",
    "patternMapping",
    "implementationNotes",
    "whenToUse",
    "checks",
    "patternSet",
    "criteriaNotes",
    "antiPatterns",
    "use",
)
FIELD_WEIGHTS = {
    "slug": 16,
    "name": 14,
    "domain": 8,
    "category": 6,
    "groups": 6,
    "intent": 10,
    "symptom": 10,
    "whyItMatters": 9,
    "goal": 9,
    "forces": 8,
    "whenToUse": 7,
    "avoidWhen": 3,
    "patterns": 9,
    "smells": 9,
    "patternSet": 8,
    "patternResponses": 8,
    "checks": 6,
    "implementationSteps": 5,
    "steps": 5,
    "implementationNotes": 4,
    "qualityAttributes": 5,
    "languageNotes": 3,
    "path": 1,
}
FORCE_HINT_TARGETS = {
    "Variation Point": {
        "strategy",
        "bridge",
        "state",
        "provider-abstraction",
        "variation-point-refactor",
        "strategy-refactor",
        "provider-bridge",
    },
    "Boundary Mismatch": {
        "adapter",
        "facade",
        "bridge",
        "legacy-boundary-adapter",
        "adapter-boundary",
        "messaging-gateway",
        "channel-adapter",
    },
    "Duplicate Delivery": {
        "idempotent-receiver",
        "guaranteed-delivery",
        "dead-letter-channel",
        "message-replay-and-recovery",
        "idempotent-receiver-recipe",
        "naive-exactly-once",
    },
    "Fanout And Decoupling": {
        "publish-subscribe-channel",
        "durable-subscriber",
        "event-message",
        "event-fanout",
        "correlation-identifier",
    },
    "Routing Control": {
        "content-based-router",
        "dynamic-router",
        "message-router",
        "routing-slip",
        "routing-pipeline",
        "hidden-router",
    },
    "Stateful Workflow": {
        "state",
        "memento",
        "process-manager",
        "stateful-workflow",
        "stateful-workflow-recipe",
        "lifecycle-state-spread",
    },
    "Operational Recovery": {
        "dead-letter-channel",
        "invalid-message-channel",
        "message-expiration",
        "message-history",
        "wire-tap",
        "unbounded-retry",
    },
}


def tokenize(text: str) -> list[str]:
    return [
        token
        for token in re.findall(r"[a-zA-Z0-9][a-zA-Z0-9-]*", text.casefold())
        if len(token) > 2 and token not in STOPWORDS
    ]


def taxonomy_groups() -> dict[str, list[str]]:
    taxonomy = load_taxonomy().get("architecture-forces", {})
    return taxonomy.get("groups", {})


def synonym_map() -> dict[str, set[str]]:
    taxonomy = load_taxonomy().get("architecture-synonyms", {})
    synonyms: dict[str, set[str]] = {}
    for key, values in taxonomy.get("groups", {}).items():
        folded_key = key.casefold()
        synonyms.setdefault(folded_key, set()).add(folded_key)
        for value in values:
            for token in tokenize(value):
                synonyms.setdefault(folded_key, set()).add(token)
                synonyms.setdefault(token, set()).add(folded_key)
            synonyms.setdefault(value.casefold(), set()).add(folded_key)
    return synonyms


def expanded_terms(query: str) -> list[str]:
    terms = set(tokenize(query))
    synonyms = synonym_map()
    for term in list(terms):
        terms.update(synonyms.get(term, set()))
    return sorted(term for term in terms if term not in STOPWORDS)


def matched_forces(query: str) -> list[dict[str, Any]]:
    folded = query.casefold()
    terms = set(expanded_terms(query))
    matches = []
    for force, phrases in taxonomy_groups().items():
        matched = []
        for phrase in phrases:
            phrase_folded = phrase.casefold()
            phrase_terms = set(tokenize(phrase))
            if phrase_folded in folded or phrase_terms & terms:
                matched.append(phrase)
        if matched:
            matches.append({"force": force, "phrases": matched})
    return matches


def entry_summary(entry: dict[str, Any] | None) -> str:
    if not entry:
        return ""
    for key in SUMMARY_FIELDS:
        value = entry.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    for key in LIST_SUMMARY_FIELDS:
        value = entry.get(key)
        if isinstance(value, list) and value:
            return str(value[0])
    return entry.get("name", entry.get("slug", ""))


def all_entries(include_snippets: bool = True) -> list[dict[str, Any]]:
    entries = [dict(entry) for entry in load_catalog()]
    if include_snippets:
        entries.extend(dict(entry) for entry in load_snippets())
    for slug, language in load_language_profiles().items():
        entries.append(
            {
                "slug": slug,
                "name": language["displayName"],
                "kind": "language",
                "domain": "language",
                "groups": ["language"],
                **language,
            }
        )
    for entry in entries:
        entry["summary"] = entry_summary(entry)
        entry["searchText"] = entry_search_text(entry)
    return entries


def entry_map(include_snippets: bool = True) -> dict[str, dict[str, Any]]:
    return {entry["slug"]: entry for entry in all_entries(include_snippets)}


def find_entry(slug_or_name: str, include_snippets: bool = True) -> dict[str, Any] | None:
    folded = slug_or_name.casefold()
    for entry in all_entries(include_snippets):
        if folded in {entry.get("slug", "").casefold(), entry.get("name", "").casefold()}:
            return entry
    return None


def entry_matches_scope(entry: dict[str, Any], scope: str) -> bool:
    if scope == "all":
        return True
    if entry.get("kind") == "pattern":
        return matches_scope(entry, scope)
    return scope == entry.get("domain") or scope in entry.get("groups", [])


def _collect_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return " ".join(_collect_text(item) for item in value)
    if isinstance(value, dict):
        return " ".join(_collect_text(item) for item in value.values())
    return str(value)


def score_entry(entry: dict[str, Any], query: str) -> dict[str, Any]:
    terms = expanded_terms(query)
    term_counts: Counter[str] = Counter()
    matched_fields: dict[str, list[str]] = {}
    score = 0
    for field, weight in FIELD_WEIGHTS.items():
        text = _collect_text(entry.get(field)).casefold()
        if not text:
            continue
        field_matches = []
        for term in terms:
            count = text.count(term)
            if count:
                score += min(count, 3) * weight
                term_counts[term] += count
                field_matches.append(term)
        if field_matches:
            matched_fields[field] = sorted(set(field_matches))
    name_text = f"{entry.get('slug', '')} {entry.get('name', '')}".casefold()
    for term in terms:
        if term in name_text:
            score += 20
    forces = matched_forces(query)
    force_hits = []
    for force in forces:
        targets = FORCE_HINT_TARGETS.get(force["force"], set())
        linked = {entry.get("slug", ""), *entry.get("patterns", []), *entry.get("smells", [])}
        if linked & targets:
            score += 42
            force_hits.append(force)
    exact = query.casefold().strip()
    if exact and exact in entry.get("searchText", ""):
        score += 25
    return {
        "score": score,
        "matchedTerms": sorted(term_counts, key=lambda item: (-term_counts[item], item)),
        "matchedFields": matched_fields,
        "matchedForces": force_hits,
    }


def why_might_be_wrong(entry: dict[str, Any]) -> list[str]:
    candidates = (
        entry.get("avoidWhen")
        or entry.get("falsePositives")
        or entry.get("failureModeNotes")
        or entry.get("antiPatterns")
        or []
    )
    if isinstance(candidates, str):
        return [candidates]
    return candidates[:3]


def recommend_entries(
    query: str,
    scope: str = "all",
    language: str | None = None,
    limit: int = 5,
    risk: str = "balanced",
    include_snippets: bool = True,
) -> list[dict[str, Any]]:
    language_profiles = load_language_profiles()
    if language and language not in language_profiles:
        raise ValueError(f"Unknown language: {language}")
    results = []
    for entry in all_entries(include_snippets):
        if not entry_matches_scope(entry, scope):
            continue
        if language:
            if entry.get("kind") == "pattern" and language not in entry.get("languages", []):
                continue
            if entry.get("kind") in {"framework", "snippet"} and language not in entry.get("languages", [entry.get("language")]):
                continue
        scoring = score_entry(entry, query)
        score = scoring["score"]
        if risk == "conservative" and entry.get("operationalRisk") == "low":
            score += 8
        if risk == "delivery" and entry.get("implementationComplexity") in {"low", "low-to-medium"}:
            score += 8
        if risk == "operability" and "operability" in entry.get("qualityAttributes", []):
            score += 10
        if score <= 0:
            continue
        enriched = attach_language(entry, language, language_profiles) if entry.get("kind") == "pattern" and language else entry
        item = dict(enriched)
        item.update(scoring)
        item["score"] = score
        item["summary"] = entry_summary(item)
        item["whyMatched"] = explanation_for(item)
        item["whyMightBeWrong"] = why_might_be_wrong(item)
        results.append(item)
    results.sort(key=lambda item: (-item["score"], KIND_ORDER.get(item.get("kind", ""), 99), item.get("slug", "")))
    return results[:limit]


def explanation_for(entry: dict[str, Any]) -> list[str]:
    reasons = []
    if entry.get("matchedForces"):
        reasons.append("matches forces: " + ", ".join(force["force"] for force in entry["matchedForces"]))
    if entry.get("matchedFields"):
        fields = ", ".join(sorted(entry["matchedFields"])[:5])
        reasons.append("matched catalog fields: " + fields)
    if entry.get("patterns"):
        reasons.append("connects to patterns: " + ", ".join(entry["patterns"][:4]))
    if not reasons:
        reasons.append(entry_summary(entry))
    return reasons


def decision_paths(entries: list[dict[str, Any]], language: str = "") -> list[dict[str, Any]]:
    catalog = entry_map()
    playbooks = load_playbooks()
    recipes = load_recipes()
    frameworks = load_frameworks()
    paths = []
    for entry in entries:
        if not entry:
            continue
        pattern_slugs = list(entry.get("patterns", []))
        if entry.get("kind") == "pattern":
            pattern_slugs = [entry["slug"]]
        if entry.get("kind") == "playbook":
            pattern_slugs = list(entry.get("patterns", []))
        related_playbooks = [
            playbook["slug"]
            for playbook in playbooks
            if set(pattern_slugs) & set(playbook.get("patterns", [])) or entry["slug"] in playbook.get("smells", [])
        ][:3]
        related_recipes = [
            recipe["slug"]
            for recipe in recipes
            if set(pattern_slugs) & set(recipe.get("patterns", [])) or entry["slug"] in recipe.get("smells", [])
        ][:3]
        related_frameworks = [
            framework["slug"]
            for framework in frameworks
            if set(pattern_slugs) & set(framework.get("patterns", []))
            and (not language or language in framework.get("languages", []))
        ][:3]
        paths.append(
            {
                "from": entry["slug"],
                "name": entry["name"],
                "summary": entry_summary(entry),
                "patterns": [slug for slug in pattern_slugs if slug in catalog][:5],
                "playbooks": related_playbooks,
                "recipes": related_recipes,
                "frameworks": related_frameworks,
            }
        )
    return paths


def recommendation_payload(params: dict[str, list[str]]) -> dict[str, Any]:
    query = params.get("q", [""])[0].strip()
    language = params.get("language", [""])[0].strip()
    risk = params.get("risk", ["balanced"])[0].strip() or "balanced"
    recommendations = recommend_entries(query, language=language or None, risk=risk, limit=10)
    return {
        "query": query,
        "language": language,
        "risk": risk,
        "forces": matched_forces(query),
        "primary": recommendations[0] if recommendations else None,
        "recommendations": recommendations,
        "paths": decision_paths(recommendations[:5], language),
    }


def adr_payload(query: str, status: str = "Proposed", language: str | None = None, scope: str = "all") -> dict[str, Any]:
    recommendations = recommend_entries(query, scope=scope, language=language, limit=5, include_snippets=False)
    chosen = recommendations[0] if recommendations else None
    alternatives = recommendations[1:4]
    scorecard = load_scorecards()[0] if load_scorecards() else {}
    return {
        "title": f"Use {chosen['name'] if chosen else 'a minimal reversible design'} for {query}",
        "status": status,
        "context": query,
        "decision": entry_summary(chosen) if chosen else "No catalog-backed recommendation matched strongly. Keep the design reversible until the force is clearer.",
        "recommendedEntry": chosen,
        "alternatives": alternatives,
        "consequences": [
            "Adopt the smallest boundary that resolves the force.",
            "Prefer domain names over pattern-role names.",
            "Prove behavior, failure handling, observability, and rollback before broad rollout.",
        ],
        "verification": [
            "Add behavior or contract tests for the affected boundary.",
            "Exercise the primary failure mode that motivated the decision.",
            "Confirm support-visible logs, metrics, traces, or replay workflow.",
        ],
        "scorecard": scorecard.get("slug"),
    }


def matrix_payload() -> dict[str, Any]:
    patterns = load_patterns()
    languages = load_language_profiles()
    qualities = sorted({quality for pattern in patterns for quality in pattern.get("qualityAttributes", [])})
    domains = sorted({pattern.get("domain", "unknown") for pattern in patterns})
    language_rows = []
    for slug, language in languages.items():
        supported = [pattern["slug"] for pattern in patterns if slug in pattern.get("languages", [])]
        language_rows.append(
            {
                "slug": slug,
                "name": language["displayName"],
                "count": len(supported),
                "objectDesign": len([pattern for pattern in patterns if slug in pattern.get("languages", []) and "object-design" in pattern.get("groups", [])]),
                "integrationDesign": len([pattern for pattern in patterns if slug in pattern.get("languages", []) and "integration-design" in pattern.get("groups", [])]),
            }
        )
    return {
        "languages": language_rows,
        "qualities": [
            {
                "slug": quality,
                "count": len([pattern for pattern in patterns if quality in pattern.get("qualityAttributes", [])]),
                "domains": {
                    domain: len(
                        [
                            pattern
                            for pattern in patterns
                            if pattern.get("domain") == domain and quality in pattern.get("qualityAttributes", [])
                        ]
                    )
                    for domain in domains
                },
            }
            for quality in qualities
        ],
        "domains": [{"slug": domain, "count": len([pattern for pattern in patterns if pattern.get("domain") == domain])} for domain in domains],
        "risk": dict(Counter(pattern.get("operationalRisk", "unknown") for pattern in patterns)),
        "complexity": dict(Counter(pattern.get("implementationComplexity", "unknown") for pattern in patterns)),
    }

"""Context-pack, migration, and decision-simulation helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from pattern_catalog import load_recipes, load_scorecards, load_snippets
from pattern_intelligence import adr_payload, entry_summary, find_entry, recommend_entries
from pattern_scanner import scan_path


COMPLEXITY_SCORE = {
    "low": 5,
    "low-to-medium": 4,
    "medium": 3,
    "medium-to-high": 2,
    "high": 1,
}
RISK_SCORE = {
    "low": 5,
    "low-to-medium": 4,
    "medium": 3,
    "medium-to-high": 2,
    "high": 1,
}


def snippet_matches(pattern_slugs: set[str], language: str | None = None) -> list[dict[str, Any]]:
    snippets = []
    for snippet in load_snippets():
        if language and snippet.get("language") != language:
            continue
        if pattern_slugs & set(snippet.get("patterns", [])):
            snippets.append(snippet)
    return snippets


def _markdown_list(values: list[str], empty: str = "None.") -> list[str]:
    if not values:
        return [empty]
    return [f"- {value}" for value in values]


def _context_markdown(payload: dict[str, Any]) -> str:
    lines = [
        "# Pattern Context Pack",
        "",
        "## Request",
        payload["query"] or "No query supplied.",
        "",
        "## Findings",
    ]
    if payload["scan"]["count"]:
        for finding in payload["scan"]["findings"][:12]:
            lines.append(
                f"- {finding['name']} (`{finding['smell']}`) at `{finding['file']}:{finding['line']}`: {finding['evidence']}"
            )
    else:
        lines.append("- No scanner findings for the supplied path.")
    lines.extend(["", "## Recommended Moves"])
    for entry in payload["recommendations"][:8]:
        lines.append(f"- {entry['name']} (`{entry['slug']}`): {entry_summary(entry)}")
        if entry.get("whyMatched"):
            lines.append(f"  Reason: {'; '.join(entry['whyMatched'][:2])}")
    lines.extend(["", "## Implementation Snippets"])
    if payload["snippets"]:
        for snippet in payload["snippets"][:6]:
            lines.append(f"- {snippet['name']} (`{snippet['slug']}`, {snippet.get('language', 'any')})")
    else:
        lines.append("- No language-specific snippets matched the current shortlist.")
    lines.extend(["", "## ADR Seed"])
    lines.append(payload["adr"]["decision"])
    lines.extend(["", "## Verification"])
    checks: list[str] = []
    for entry in payload["recommendations"][:5]:
        checks.extend(entry.get("testing", []) or entry.get("tests", []) or entry.get("verification", []) or entry.get("checks", []))
    lines.extend(_markdown_list(checks[:10], "Add focused behavior and failure-path tests before rollout."))
    return "\n".join(lines)


def context_pack(
    path: str | Path,
    query: str,
    language: str | None = None,
    scope: str = "all",
    pack: str = "all",
) -> dict[str, Any]:
    """Build a model-ready architecture context pack from code/doc evidence and the catalog."""

    scan = {"path": str(path), "findings": [], "count": 0, "patterns": [], "paths": [], "rulePacks": []}
    target = Path(path).expanduser()
    if str(path).strip() and target.exists():
        scan = scan_path(target, pack=pack, include_docs=False, include_generated=False)
    finding_slugs = []
    for finding in scan.get("findings", []):
        if finding["smell"] not in finding_slugs:
            finding_slugs.append(finding["smell"])
    finding_terms = " ".join(finding_slugs[:5])
    combined_query = " ".join(part for part in [query, finding_terms] if part).strip()
    recommendations = recommend_entries(combined_query or query, scope=scope, language=language, limit=10, include_snippets=False)
    pattern_slugs = {
        slug
        for entry in recommendations
        for slug in ([entry["slug"]] if entry.get("kind") == "pattern" else entry.get("patterns", []))
    }
    for finding in scan.get("findings", []):
        pattern_slugs.update(finding.get("patterns", []))
    snippets = snippet_matches(pattern_slugs, language)
    payload = {
        "path": str(target),
        "query": query,
        "language": language,
        "scope": scope,
        "scan": scan,
        "recommendations": recommendations,
        "snippets": snippets,
        "adr": adr_payload(combined_query or query, language=language, scope=scope),
    }
    payload["markdown"] = _context_markdown(payload)
    return payload


def _entry_patterns(entry: dict[str, Any] | None) -> set[str]:
    if not entry:
        return set()
    if entry.get("kind") == "pattern":
        return {entry["slug"]}
    return set(entry.get("patterns", []))


def migration_plan(
    source: str,
    target: str,
    language: str | None = None,
    query: str = "",
) -> dict[str, Any]:
    """Return a recipe-backed migration plan from a smell/current shape to a target pattern."""

    source_entry = find_entry(source, include_snippets=False)
    target_entry = find_entry(target, include_snippets=False)
    source_slug = source_entry["slug"] if source_entry else source
    target_slug = target_entry["slug"] if target_entry else target
    source_patterns = _entry_patterns(source_entry)
    target_patterns = _entry_patterns(target_entry) or {target_slug}
    candidate_recipes = []
    for recipe in load_recipes():
        recipe_patterns = set(recipe.get("patterns", []))
        recipe_smells = set(recipe.get("smells", []))
        score = 0
        if source_slug in recipe_smells or source_patterns & recipe_patterns:
            score += 4
        if target_slug in recipe_patterns or target_patterns & recipe_patterns:
            score += 5
        if query and query.casefold() in " ".join(recipe.get("steps", []) + recipe.get("goal", "").splitlines()).casefold():
            score += 1
        if score:
            item = dict(recipe)
            item["score"] = score
            candidate_recipes.append(item)
    candidate_recipes.sort(key=lambda item: (-item["score"], item["slug"]))
    recipe = candidate_recipes[0] if candidate_recipes else None
    recommendations = recommend_entries(" ".join([source, target, query]).strip(), language=language, limit=6, include_snippets=False)
    steps = (recipe or {}).get("steps", []) or [
        "Characterize the current behavior with parity tests.",
        "Introduce the target boundary behind the existing call path.",
        "Move one variation, provider, or message path at a time.",
        "Observe error handling, latency, replay behavior, and rollback signals.",
    ]
    tests = (recipe or {}).get("tests", []) or [
        "Add behavior tests for the current and target paths.",
        "Exercise the failure mode that motivated the migration.",
    ]
    rollback = (recipe or {}).get("rollback", []) or [
        "Keep the previous path as a feature-gated fallback until parity and operations checks pass.",
    ]
    payload = {
        "source": source_entry or {"slug": source_slug, "name": source},
        "target": target_entry or {"slug": target_slug, "name": target},
        "language": language,
        "recipe": recipe,
        "candidateRecipes": candidate_recipes[:5],
        "recommendations": recommendations,
        "steps": steps,
        "tests": tests,
        "rollback": rollback,
    }
    lines = [
        "# Pattern Migration Plan",
        "",
        "## From / To",
        f"- From: {payload['source'].get('name')} (`{payload['source'].get('slug')}`)",
        f"- To: {payload['target'].get('name')} (`{payload['target'].get('slug')}`)",
        "",
        "## Steps",
        *[f"{index}. {step}" for index, step in enumerate(steps, start=1)],
        "",
        "## Tests",
        *_markdown_list(tests),
        "",
        "## Rollback",
        *_markdown_list(rollback),
    ]
    payload["markdown"] = "\n".join(lines)
    return payload


def _criterion_scores(entry: dict[str, Any], risk: str) -> dict[str, int]:
    complexity = COMPLEXITY_SCORE.get(str(entry.get("implementationComplexity", "medium")), 3)
    operational = RISK_SCORE.get(str(entry.get("operationalRisk", "medium")), 3)
    quality = set(entry.get("qualityAttributes", []))
    scores = {
        "complexity": complexity,
        "coupling": 5 if "decoupling" in quality or "maintainability" in quality else 3,
        "operability": max(operational, 4 if "operability" in quality else operational),
        "testability": 4 if entry.get("testing") or entry.get("tests") or entry.get("verification") else 3,
        "migration-risk": operational,
        "reversibility": 4 if entry.get("implementationComplexity") in {"low", "low-to-medium"} else 3,
    }
    if risk == "delivery":
        scores["complexity"] += 1
        scores["migration-risk"] += 1
    if risk == "operability":
        scores["operability"] += 1
    if risk == "conservative":
        scores["reversibility"] += 1
        scores["migration-risk"] += 1
    return {key: min(value, 5) for key, value in scores.items()}


def decision_simulation(
    query: str,
    language: str | None = None,
    risk: str = "balanced",
    limit: int = 5,
) -> dict[str, Any]:
    """Compare likely pattern options against the standard architecture scorecard."""

    scorecard = load_scorecards()[0] if load_scorecards() else {"criteria": list(COMPLEXITY_SCORE)}
    options = []
    for entry in recommend_entries(query, language=language, risk=risk, limit=limit, include_snippets=False):
        scores = _criterion_scores(entry, risk)
        options.append(
            {
                "slug": entry["slug"],
                "name": entry["name"],
                "kind": entry["kind"],
                "summary": entry_summary(entry),
                "fitScore": entry.get("score", 0),
                "scores": scores,
                "total": sum(scores.values()),
                "whyMatched": entry.get("whyMatched", []),
                "whyMightBeWrong": entry.get("whyMightBeWrong", []),
            }
        )
    options.sort(key=lambda item: (-item["total"], -item["fitScore"], item["slug"]))
    lines = [
        "# Pattern Decision Simulation",
        "",
        "## Context",
        query,
        "",
        "## Scorecard",
        scorecard.get("name", "Architecture scorecard"),
        "",
        "| Option | Total | Complexity | Coupling | Operability | Testability | Migration Risk | Reversibility |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for option in options:
        scores = option["scores"]
        lines.append(
            f"| {option['name']} | {option['total']} | {scores['complexity']} | {scores['coupling']} | {scores['operability']} | {scores['testability']} | {scores['migration-risk']} | {scores['reversibility']} |"
        )
    lines.extend(["", "## Recommendation"])
    if options:
        lines.append(f"Use {options[0]['name']} first, then validate against the listed failure modes before broad rollout.")
    else:
        lines.append("No strong catalog option matched. Keep the design reversible and clarify the force.")
    return {
        "query": query,
        "language": language,
        "risk": risk,
        "scorecard": scorecard,
        "options": options,
        "recommended": options[0] if options else None,
        "markdown": "\n".join(lines),
    }

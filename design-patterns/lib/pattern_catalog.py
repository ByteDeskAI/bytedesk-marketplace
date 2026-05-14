"""Markdown-backed pattern catalog helpers."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
DATA_ROOT = PLUGIN_ROOT / "data"
PATTERN_SECTIONS = {
    "intent": "Intent",
    "whenToUse": "When To Use",
    "avoidWhen": "Avoid When",
    "forces": "Forces",
    "tradeoffNotes": "Tradeoffs",
    "failureModeNotes": "Failure Modes",
    "testing": "Testing",
    "observability": "Observability",
    "implementationNotes": "Implementation Notes",
}
PLAYBOOK_SECTIONS = {
    "intent": "Intent",
    "whenToUse": "When To Use",
    "avoidWhen": "Avoid When",
    "patternSet": "Pattern Set",
    "implementationSteps": "Implementation Steps",
    "verification": "Verification",
}
SMELL_SECTIONS = {
    "symptom": "Symptom",
    "whyItMatters": "Why It Matters",
    "patternResponses": "Pattern Responses",
    "falsePositives": "False Positives",
    "checks": "Checks",
}
LANGUAGE_SECTIONS = {
    "objectDesignIdioms": "Object Design Idioms",
    "integrationStacks": "Integration Stacks",
    "implementationNotes": "Implementation Notes",
    "testingGuidance": "Testing Guidance",
    "operationalGuidance": "Operational Guidance",
}
FRAMEWORK_SECTIONS = {
    "bestFor": "Best For",
    "patternMapping": "Pattern Mapping",
    "implementationNotes": "Implementation Notes",
    "testingGuidance": "Testing Guidance",
    "operationalGuidance": "Operational Guidance",
}
RECIPE_SECTIONS = {
    "goal": "Goal",
    "preconditions": "Preconditions",
    "steps": "Steps",
    "tests": "Tests",
    "rollback": "Rollback",
}
SCORECARD_SECTIONS = {
    "intent": "Intent",
    "scale": "Scale",
    "criteriaNotes": "Criteria",
    "outputContract": "Output Contract",
    "antiPatterns": "Anti-Patterns",
}
SNIPPET_SECTIONS = {
    "use": "Use",
    "tests": "Tests",
}


def _parse_frontmatter(text: str, path: Path) -> tuple[dict[str, Any], str]:
    if not text.startswith("---\n"):
        raise ValueError(f"{path}: missing frontmatter")
    try:
        _, raw_meta, body = text.split("---", 2)
    except ValueError as exc:
        raise ValueError(f"{path}: malformed frontmatter") from exc

    meta: dict[str, Any] = {}
    current_list: str | None = None
    for raw_line in raw_meta.splitlines():
        if not raw_line.strip():
            continue
        if raw_line.startswith("  - "):
            if current_list is None:
                raise ValueError(f"{path}: list item without list key")
            meta[current_list].append(raw_line[4:].strip())
            continue
        if ":" not in raw_line:
            raise ValueError(f"{path}: malformed frontmatter line {raw_line!r}")
        key, value = raw_line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not value:
            meta[key] = []
            current_list = key
        else:
            meta[key] = value
            current_list = None
    return meta, body.strip()


def _section(body: str, heading: str) -> str:
    pattern = re.compile(rf"^## {re.escape(heading)}\s*$", re.MULTILINE)
    match = pattern.search(body)
    if not match:
        return ""
    next_match = re.search(r"^## .+$", body[match.end() :], re.MULTILINE)
    end = match.end() + next_match.start() if next_match else len(body)
    return body[match.end() : end].strip()


def _bullets(section: str) -> list[str]:
    bullets: list[str] = []
    for line in section.splitlines():
        if line.startswith("- "):
            bullets.append(line[2:].strip())
            continue
        numbered = re.match(r"^\d+\.\s+(.*)$", line)
        if numbered:
            bullets.append(numbered.group(1).strip())
    return bullets


def _language_notes(section: str) -> dict[str, str]:
    notes: dict[str, str] = {}
    matches = list(re.finditer(r"^### (.+?)\s*$", section, re.MULTILINE))
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(section)
        notes[match.group(1).strip()] = section[start:end].strip()
    return notes


def _relationship_types(relationships: list[str]) -> dict[str, list[str]]:
    typed: dict[str, list[str]] = {}
    for relationship in relationships:
        if ":" not in relationship:
            typed.setdefault("related", []).append(relationship)
            continue
        kind, slug = relationship.split(":", 1)
        typed.setdefault(kind.strip(), []).append(slug.strip())
    return typed


def _load_markdown(path: Path) -> tuple[dict[str, Any], str]:
    return _parse_frontmatter(path.read_text(encoding="utf-8"), path)


def _apply_sections(entry: dict[str, Any], body: str, sections: dict[str, str]) -> dict[str, Any]:
    for field, heading in sections.items():
        section = _section(body, heading)
        if heading in {"Intent", "Symptom", "Why It Matters", "False Positives", "Goal", "Output Contract"}:
            entry[field] = section
        else:
            entry[field] = _bullets(section)
    return entry


def load_patterns(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    patterns: list[dict[str, Any]] = []
    for path in sorted((data_root / "patterns").glob("*.md")):
        meta, body = _load_markdown(path)
        pattern = dict(meta)
        pattern["kind"] = "pattern"
        _apply_sections(pattern, body, PATTERN_SECTIONS)
        pattern["languageNotes"] = _language_notes(_section(body, "Language Notes"))
        pattern["relationshipTypes"] = _relationship_types(pattern.get("relationships", []))
        pattern["path"] = str(path.relative_to(data_root.parent))
        patterns.append(pattern)
    return patterns


def load_playbooks(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    playbooks: list[dict[str, Any]] = []
    for path in sorted((data_root / "playbooks").glob("*.md")):
        meta, body = _load_markdown(path)
        playbook = dict(meta)
        playbook["kind"] = "playbook"
        _apply_sections(playbook, body, PLAYBOOK_SECTIONS)
        playbook["path"] = str(path.relative_to(data_root.parent))
        playbooks.append(playbook)
    return playbooks


def load_smells(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    smells: list[dict[str, Any]] = []
    for path in sorted((data_root / "smells").glob("*.md")):
        meta, body = _load_markdown(path)
        smell = dict(meta)
        smell["kind"] = "smell"
        _apply_sections(smell, body, SMELL_SECTIONS)
        smell["path"] = str(path.relative_to(data_root.parent))
        smells.append(smell)
    return smells


def load_frameworks(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    frameworks: list[dict[str, Any]] = []
    for path in sorted((data_root / "frameworks").glob("*.md")):
        meta, body = _load_markdown(path)
        framework = dict(meta)
        framework["kind"] = "framework"
        _apply_sections(framework, body, FRAMEWORK_SECTIONS)
        framework["path"] = str(path.relative_to(data_root.parent))
        frameworks.append(framework)
    return frameworks


def load_recipes(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    recipes: list[dict[str, Any]] = []
    for path in sorted((data_root / "recipes").glob("*.md")):
        meta, body = _load_markdown(path)
        recipe = dict(meta)
        recipe["kind"] = "recipe"
        _apply_sections(recipe, body, RECIPE_SECTIONS)
        recipe["path"] = str(path.relative_to(data_root.parent))
        recipes.append(recipe)
    return recipes


def load_scorecards(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    scorecards: list[dict[str, Any]] = []
    for path in sorted((data_root / "scorecards").glob("*.md")):
        meta, body = _load_markdown(path)
        scorecard = dict(meta)
        scorecard["kind"] = "scorecard"
        _apply_sections(scorecard, body, SCORECARD_SECTIONS)
        scorecard["path"] = str(path.relative_to(data_root.parent))
        scorecards.append(scorecard)
    return scorecards


def load_snippets(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    snippets: list[dict[str, Any]] = []
    snippets_root = data_root / "snippets"
    if not snippets_root.exists():
        return snippets
    for path in sorted(snippets_root.rglob("*.md")):
        meta, body = _load_markdown(path)
        snippet = dict(meta)
        snippet["kind"] = "snippet"
        _apply_sections(snippet, body, SNIPPET_SECTIONS)
        snippet["example"] = _section(body, "Example")
        snippet["path"] = str(path.relative_to(data_root.parent))
        snippets.append(snippet)
    return snippets


def load_taxonomy(data_root: Path = DATA_ROOT) -> dict[str, dict[str, Any]]:
    taxonomy_root = data_root / "taxonomy"
    taxonomy: dict[str, dict[str, Any]] = {}
    if not taxonomy_root.exists():
        return taxonomy
    for path in sorted(taxonomy_root.glob("*.md")):
        meta, body = _load_markdown(path)
        groups: dict[str, list[str]] = {}
        headings = list(re.finditer(r"^## (.+?)\s*$", body, re.MULTILINE))
        for index, heading in enumerate(headings):
            start = heading.end()
            end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
            groups[heading.group(1).strip()] = _bullets(body[start:end].strip())
        taxonomy[meta["slug"]] = {**meta, "groups": groups, "path": str(path.relative_to(data_root.parent))}
    return taxonomy


def load_catalog(data_root: Path = DATA_ROOT) -> list[dict[str, Any]]:
    return [
        *load_patterns(data_root),
        *load_playbooks(data_root),
        *load_smells(data_root),
        *load_frameworks(data_root),
        *load_recipes(data_root),
        *load_scorecards(data_root),
    ]


def load_language_profiles(data_root: Path = DATA_ROOT) -> dict[str, dict[str, Any]]:
    languages: dict[str, dict[str, Any]] = {}
    for path in sorted((data_root / "languages").glob("*.md")):
        meta, body = _load_markdown(path)
        slug = meta["slug"]
        language = {**meta}
        _apply_sections(language, body, LANGUAGE_SECTIONS)
        language["path"] = str(path.relative_to(data_root.parent))
        languages[slug] = language
    return languages


def scope_names(patterns: list[dict[str, Any]]) -> set[str]:
    groups = {group for pattern in patterns for group in pattern.get("groups", [])}
    domains = {pattern["domain"] for pattern in patterns}
    return {"all"} | groups | domains


def matches_scope(pattern: dict[str, Any], scope: str) -> bool:
    return scope == "all" or scope == pattern.get("domain") or scope in pattern.get("groups", [])


def entry_search_text(entry: dict[str, Any]) -> str:
    parts: list[str] = []

    def collect(value: Any) -> None:
        if value is None:
            return
        if isinstance(value, str):
            parts.append(value)
            return
        if isinstance(value, list):
            for item in value:
                collect(item)
            return
        if isinstance(value, dict):
            for item in value.values():
                collect(item)

    for key, value in entry.items():
        if key in {"languageProfile"}:
            continue
        collect(value)
    return " ".join(parts).casefold()


def attach_language(
    pattern: dict[str, Any],
    language: str | None,
    language_profiles: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not language:
        return pattern
    if language not in language_profiles:
        raise ValueError(f"Unknown language: {language}")
    if language not in pattern.get("languages", []):
        raise ValueError(f"{pattern['slug']} is not tagged for language: {language}")
    enriched = dict(pattern)
    enriched["selectedLanguage"] = language
    enriched["languageProfile"] = language_profiles[language]
    note = pattern.get("languageNotes", {}).get(language)
    if note:
        enriched["languageNote"] = note
    return enriched

"""Infer request language and catalog scope from codebase and prompt context."""

from __future__ import annotations

import os
import re
from collections import Counter
from pathlib import Path
from typing import Any


LANGUAGE_ALIASES = {
    "csharp": {"csharp", "c#", "dotnet", ".net", "aspnet", "asp.net", "masstransit", "csproj", "sln"},
    "java": {"java", "spring", "springboot", "spring-boot", "maven", "gradle", "jvm", "pom.xml"},
    "typescript": {"typescript", "ts", "tsx", "javascript", "node", "nodejs", "react", "nextjs", "nestjs", "angular", "vue"},
    "python": {"python", "py", "django", "fastapi", "flask", "celery", "faststream", "pytest", "pyproject"},
    "go": {"golang", "go.mod", "go.work", "watermill"},
    "rust": {"rust", "cargo", "tokio", "tower"},
    "cpp": {"cpp", "c++", "cmake", "conan", "vcpkg"},
}
EXTENSION_LANGUAGE = {
    ".cs": "csharp",
    ".csproj": "csharp",
    ".sln": "csharp",
    ".java": "java",
    ".gradle": "java",
    ".kt": "java",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "typescript",
    ".jsx": "typescript",
    ".mjs": "typescript",
    ".cjs": "typescript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".cpp": "cpp",
    ".cc": "cpp",
    ".cxx": "cpp",
    ".hpp": "cpp",
    ".hh": "cpp",
}
CONFIG_LANGUAGE = {
    "pyproject.toml": "python",
    "requirements.txt": "python",
    "setup.py": "python",
    "poetry.lock": "python",
    "pipfile": "python",
    "package.json": "typescript",
    "tsconfig.json": "typescript",
    "vite.config.ts": "typescript",
    "next.config.js": "typescript",
    "go.mod": "go",
    "go.work": "go",
    "cargo.toml": "rust",
    "cargo.lock": "rust",
    "pom.xml": "java",
    "build.gradle": "java",
    "build.gradle.kts": "java",
    "cmakelists.txt": "cpp",
    "conanfile.txt": "cpp",
}
INTEGRATION_TERMS = {
    "broker",
    "bus",
    "celery",
    "channel",
    "consumer",
    "dead-letter",
    "dlq",
    "event",
    "fanout",
    "idempotent",
    "kafka",
    "message",
    "messaging",
    "nats",
    "outbox",
    "producer",
    "queue",
    "rabbitmq",
    "replay",
    "retry",
    "router",
    "saga",
    "service-bus",
    "stream",
    "topic",
}
OBJECT_TERMS = {
    "adapter",
    "branch",
    "builder",
    "class",
    "conditional",
    "constructor",
    "factory",
    "interface",
    "lifecycle",
    "object",
    "polymorphism",
    "provider",
    "repository",
    "service",
    "singleton",
    "state",
    "strategy",
    "switch",
    "workflow",
}
SKIP_DIRS = {
    ".git",
    ".hg",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "bin",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "obj",
    "site",
    "target",
    "venv",
    "__pycache__",
}


def _tokens(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9_.#+-]+", text.casefold()))


def _plugin_root() -> Path:
    env_root = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.environ.get("CODEX_PLUGIN_ROOT") or os.environ.get("PLUGIN_ROOT")
    if env_root:
        return Path(env_root).expanduser().resolve()
    return Path(__file__).resolve().parents[1]


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


def _candidate_paths(paths: list[str]) -> list[Path]:
    candidates: list[Path] = []
    for value in paths:
        if not value:
            continue
        candidate = Path(value).expanduser()
        if not candidate.is_absolute():
            candidate = Path.cwd() / candidate
        if candidate.exists():
            candidates.append(candidate.resolve())
    if candidates:
        return candidates
    cwd = Path.cwd().resolve()
    plugin_root = _plugin_root()
    if not _inside(cwd, plugin_root):
        return [cwd]
    return []


def _score_query_language(text: str) -> tuple[Counter[str], list[str]]:
    scores: Counter[str] = Counter()
    evidence: list[str] = []
    tokens = _tokens(text)
    folded = text.casefold()
    for language, aliases in LANGUAGE_ALIASES.items():
        matched = sorted(alias for alias in aliases if alias in tokens or alias in folded)
        if matched:
            scores[language] += 5 + len(matched)
            evidence.append(f"language {language} from prompt terms: {', '.join(matched[:4])}")
    return scores, evidence


def _iter_files(root: Path, max_files: int = 600) -> list[Path]:
    if root.is_file():
        return [root]
    files: list[Path] = []
    for current_root, dirnames, filenames in os.walk(root):
        dirnames[:] = [dirname for dirname in dirnames if dirname.casefold() not in SKIP_DIRS]
        for filename in filenames:
            files.append(Path(current_root) / filename)
            if len(files) >= max_files:
                return files
    return files


def _score_path_language(paths: list[Path]) -> tuple[Counter[str], list[str]]:
    scores: Counter[str] = Counter()
    evidence: list[str] = []
    for path in paths:
        start = path if path.is_dir() else path.parent
        for parent in [start, *list(start.parents)[:5]]:
            for config_name, language in CONFIG_LANGUAGE.items():
                if (parent / config_name).exists():
                    scores[language] += 8
                    evidence.append(f"language {language} from {config_name}")
                    break
        for file_path in _iter_files(path):
            name = file_path.name.casefold()
            suffix = file_path.suffix.casefold()
            if name in CONFIG_LANGUAGE:
                language = CONFIG_LANGUAGE[name]
                scores[language] += 8
                if len([item for item in evidence if f"language {language}" in item]) < 3:
                    evidence.append(f"language {language} from {file_path.name}")
            if suffix in EXTENSION_LANGUAGE:
                language = EXTENSION_LANGUAGE[suffix]
                scores[language] += 1 if suffix not in {".ts", ".tsx", ".cs", ".java", ".py", ".go", ".rs"} else 2
    for language, score in scores.most_common(3):
        evidence.append(f"language {language} file score {score}")
    return scores, evidence


def _score_scope(text: str, paths: list[Path]) -> tuple[Counter[str], list[str]]:
    scores: Counter[str] = Counter()
    evidence: list[str] = []
    tokens = _tokens(text)
    integration_hits = sorted(tokens & INTEGRATION_TERMS)
    object_hits = sorted(tokens & OBJECT_TERMS)
    if integration_hits:
        scores["integration-design"] += 5 + len(integration_hits)
        evidence.append(f"scope integration-design from terms: {', '.join(integration_hits[:6])}")
    if object_hits:
        scores["object-design"] += 5 + len(object_hits)
        evidence.append(f"scope object-design from terms: {', '.join(object_hits[:6])}")
    path_text = " ".join(str(path).casefold() for path in paths)
    if any(term in path_text for term in ("messaging", "events", "kafka", "queue", "consumer", "producer", "integration")):
        scores["integration-design"] += 4
        evidence.append("scope integration-design from path markers")
    if any(term in path_text for term in ("domain", "provider", "service", "frontend", "state", "workflow", "repository")):
        scores["object-design"] += 3
        evidence.append("scope object-design from path markers")
    return scores, evidence


def _pick(scores: Counter[str], threshold: int = 3) -> tuple[str | None, int]:
    if not scores:
        return None, 0
    value, score = scores.most_common(1)[0]
    return (value, score) if score >= threshold else (None, score)


def infer_request_context(
    *,
    query: str = "",
    paths: list[str] | None = None,
    language: str | None = None,
    scope: str | None = None,
) -> dict[str, Any]:
    """Infer omitted request dimensions from prompt text, paths, and cwd."""

    path_values = paths or []
    candidate_paths = _candidate_paths(path_values)
    path_text = " ".join(path_values + [str(path) for path in candidate_paths])
    combined_text = " ".join(part for part in [query, path_text] if part).strip()

    language_evidence: list[str] = []
    language_scores: Counter[str] = Counter()
    query_language_scores, query_language_evidence = _score_query_language(combined_text)
    path_language_scores, path_language_evidence = _score_path_language(candidate_paths)
    language_scores.update(query_language_scores)
    language_scores.update(path_language_scores)
    language_evidence.extend(query_language_evidence)
    language_evidence.extend(path_language_evidence)
    inferred_language, language_score = _pick(language_scores)

    scope_scores, scope_evidence = _score_scope(combined_text, candidate_paths)
    inferred_scope, scope_score = _pick(scope_scores)
    if not inferred_scope:
        inferred_scope = "all"
        scope_evidence.append("scope all because object-design and integration-design signals were ambiguous")

    explicit_language = (language or "").strip() or None
    explicit_scope = (scope or "").strip() or None
    resolved_language = explicit_language or inferred_language
    resolved_scope = explicit_scope or inferred_scope
    return {
        "language": resolved_language,
        "scope": resolved_scope,
        "languageWasInferred": explicit_language is None,
        "scopeWasInferred": explicit_scope is None,
        "confidence": {"language": language_score, "scope": scope_score},
        "evidence": {
            "language": language_evidence[:8],
            "scope": scope_evidence[:8],
            "paths": [str(path) for path in candidate_paths[:5]],
        },
    }

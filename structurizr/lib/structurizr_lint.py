"""Lightweight Structurizr DSL linter (no Java dependency)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class LintViolation:
    severity: str
    line: int
    code: str
    message: str


WORKSPACE_RE = re.compile(r"^\s*workspace\b", re.I)
MODEL_RE = re.compile(r"^\s*model\s*\{", re.I)
VIEWS_RE = re.compile(r"^\s*views\s*\{", re.I)
VIEW_KEY_RE = re.compile(
    r"^\s*(systemContext|container|component|dynamic|deployment|systemLandscape|filtered)\s+",
    re.I,
)
EXPLICIT_KEY_RE = re.compile(
    r"^\s*(systemContext|container|component|dynamic|deployment|systemLandscape)\s+\S+\s+\"[^\"]+\"",
    re.I,
)
OPEN_BRACE_SAME_LINE = re.compile(r"\{\s*$")


def lint_file(path: Path) -> list[LintViolation]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    violations: list[LintViolation] = []

    has_workspace = any(WORKSPACE_RE.match(line) for line in lines)
    has_model = any(MODEL_RE.match(line) for line in lines)
    has_views = any(VIEWS_RE.match(line) for line in lines)

    if not has_workspace:
        violations.append(LintViolation("error", 1, "missing-workspace", "File must declare a workspace block"))
    if not has_model:
        violations.append(LintViolation("error", 1, "missing-model", "Workspace must contain a model block"))

    for i, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue

        # Opening brace must be on same line as keyword
        for kw in ("workspace", "model", "views", "softwareSystem", "container", "component", "person"):
            if re.match(rf"^\s*{kw}\b", line, re.I) and "{" not in line:
                violations.append(
                    LintViolation(
                        "error",
                        i,
                        "brace-same-line",
                        f"Opening brace must be on same line as `{kw}`",
                    )
                )

        if stripped == "}":
            prev = lines[i - 2].strip() if i > 1 else ""
            if prev and not prev.endswith("{") and "{" in prev and prev.count("{") == prev.count("}"):
                pass  # inline close ok

        if VIEW_KEY_RE.match(line) and not EXPLICIT_KEY_RE.match(line):
            # dynamic/container views without quoted key — warn
            if "filtered" not in line.lower():
                violations.append(
                    LintViolation(
                        "warning",
                        i,
                        "unstable-view-key",
                        "Specify explicit view key to preserve manual layout",
                    )
                )

    if not has_views:
        violations.append(
            LintViolation(
                "info",
                1,
                "default-views",
                "No views block — Structurizr will generate default views",
            )
        )

    return violations
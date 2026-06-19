"""Tests for DSL linter."""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from structurizr_lint import lint_file  # noqa: E402
from structurizr_scaffold import get_scaffold  # noqa: E402


def test_lint_minimal_scaffold_passes() -> None:
    text = get_scaffold("minimal")
    assert text is not None
    with tempfile.NamedTemporaryFile("w", suffix=".dsl", delete=False) as f:
        f.write(text)
        path = Path(f.name)
    violations = lint_file(path)
    errors = [v for v in violations if v.severity == "error"]
    assert errors == []
    path.unlink()
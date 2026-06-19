"""Smoke tests for Structurizr catalog."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from structurizr_catalog import list_keywords, load_index, load_keyword  # noqa: E402
from structurizr_scaffold import get_scaffold  # noqa: E402


def test_index_has_keywords() -> None:
    index = load_index()
    assert len(index["keywords"]) >= 20
    assert "structurizr-orchestrator" in index["skills"]


def test_lookup_container() -> None:
    entry = load_keyword("container")
    assert entry is not None
    assert entry["keyword"] == "container"
    assert "Container" in entry["default_tags"]


def test_keywords_on_disk_match_index() -> None:
    index = load_index()
    assert set(list_keywords()) == set(index["keywords"])


def test_scaffold_minimal() -> None:
    text = get_scaffold("minimal")
    assert text is not None
    assert "workspace" in text
    assert "model" in text
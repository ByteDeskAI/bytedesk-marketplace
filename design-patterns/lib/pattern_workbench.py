#!/usr/bin/env python3
# FINGERPRINT
# Family: Data-Dense Pro
# Display font: Space Mono 700 / Body font: Inter Tight 400/500
# Palette lead: #0D1117 / Accent: #00D9FF
# Signature move: The workbench reads like an enterprise architecture operations console with live catalog telemetry as the hero artifact.
# House rule this session: No rounded corners on any data container; corners are square to imply precision.
"""Compatibility wrapper for the modular design-pattern workbench."""

from __future__ import annotations

from workbench_analysis import (
    adr_payload,
    brief_payload,
    context_payload,
    coverage_payload,
    facets,
    filtered_entries,
    graph_payload,
    graph_query_payload,
    json_safe,
    matrix_payload,
    migration_payload,
    neighborhood_payload,
    recommendation_payload,
    scan_text_payload,
    simulation_payload,
)
from workbench_api import CatalogHandler, main, run_server
from workbench_views import app_html

__all__ = [
    "CatalogHandler",
    "adr_payload",
    "app_html",
    "brief_payload",
    "context_payload",
    "coverage_payload",
    "facets",
    "filtered_entries",
    "graph_payload",
    "graph_query_payload",
    "json_safe",
    "main",
    "matrix_payload",
    "migration_payload",
    "neighborhood_payload",
    "recommendation_payload",
    "run_server",
    "scan_text_payload",
    "simulation_payload",
]


if __name__ == "__main__":
    raise SystemExit(main())

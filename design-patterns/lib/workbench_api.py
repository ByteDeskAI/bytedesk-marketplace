"""HTTP API for the dynamic design-pattern workbench."""

from __future__ import annotations

import argparse
import json
import sys
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

from pattern_catalog import load_language_profiles
from pattern_context import snippet_matches
from pattern_intelligence import find_entry
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
from workbench_assets import CSS, JS
from workbench_views import app_html


class CatalogHandler(BaseHTTPRequestHandler):
    def send_text(self, text: str, content_type: str = "text/plain; charset=utf-8") -> None:
        body = text.encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, value: object) -> None:
        body = json.dumps(json_safe(value), indent=2, sort_keys=True).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def not_found(self) -> None:
        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def no_content(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        if path == "/":
            self.send_text(app_html(), "text/html; charset=utf-8")
            return
        if path == "/app.css":
            self.send_text(CSS, "text/css; charset=utf-8")
            return
        if path == "/app.js":
            self.send_text(JS, "application/javascript; charset=utf-8")
            return
        if path == "/favicon.ico":
            self.no_content()
            return
        if path == "/api/catalog":
            entries = filtered_entries({})
            stats: dict[str, int] = {}
            for entry in entries:
                stats[entry["kind"]] = stats.get(entry["kind"], 0) + 1
            self.send_json({"entries": entries, "facets": facets(entries), "stats": stats})
            return
        if path == "/api/search":
            entries = filtered_entries(params)
            self.send_json({"entries": entries, "count": len(entries)})
            return
        if path == "/api/recommend":
            self.send_json(recommendation_payload(params))
            return
        if path.startswith("/api/entry/"):
            slug = unquote(path.rsplit("/", 1)[-1])
            entry = find_entry(slug)
            self.send_json({"entry": entry} if entry else {"error": "not found"})
            return
        if path.startswith("/api/neighborhood/"):
            slug = unquote(path.rsplit("/", 1)[-1])
            self.send_json(neighborhood_payload(slug))
            return
        if path == "/api/compare":
            slugs = [slug.strip() for slug in params.get("slugs", [""])[0].split(",") if slug.strip()]
            self.send_json({"entries": [entry for slug in slugs if (entry := find_entry(slug))]})
            return
        if path == "/api/brief":
            self.send_json(brief_payload(params))
            return
        if path == "/api/adr":
            self.send_json(adr_payload(params.get("q", [""])[0]))
            return
        if path == "/api/graph":
            self.send_json(graph_payload())
            return
        if path == "/api/graph-query":
            self.send_json(graph_query_payload(params))
            return
        if path == "/api/matrix":
            self.send_json(matrix_payload())
            return
        if path == "/api/coverage":
            self.send_json(coverage_payload())
            return
        if path == "/api/context":
            self.send_json(context_payload(params))
            return
        if path == "/api/simulate":
            self.send_json(simulation_payload(params))
            return
        if path == "/api/migrate":
            self.send_json(migration_payload(params))
            return
        if path == "/api/snippets":
            pattern_slugs = {slug.strip() for slug in params.get("patterns", params.get("slug", [""]))[0].split(",") if slug.strip()}
            language = params.get("language", [""])[0] or None
            self.send_json({"snippets": snippet_matches(pattern_slugs, language), "languages": sorted(load_language_profiles())})
            return
        self.not_found()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/scan-text":
            self.not_found()
            return
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8") if length else "{}"
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {}
        self.send_json(scan_text_payload(str(payload.get("text", ""))))

    def log_message(self, message_format: str, *args: object) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), message_format % args))


def run_server(host: str = "127.0.0.1", port: int = 8766) -> int:
    httpd = ThreadingHTTPServer((host, port), CatalogHandler)
    print(f"Serving dynamic design-pattern workbench at http://{host}:{port}/")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args(argv)
    return run_server(args.host, args.port)

"""Cross-session pattern memory: a persistent project journal the plugin reads and writes.

The catalog itself is static and stateless. This module adds the *memory* layer — an
append-only JSONL journal of what the plugin found (scans), recommended, decided (ADRs),
and what refactors were actually applied — plus the readers that fold that journal back
into a current picture so the other tools can answer "what do we already have / know".

Storage (per the consuming project, not the plugin):

    <project-root>/.claude/plugins/design-patterns/
    ├── journal.jsonl     append-only event stream — the source of truth
    ├── decisions/        rendered ADR markdown (Phase 5 / BDM-58)
    ├── index.md          derived "patterns we have & where" (Phase 5 / BDM-58)
    └── journal.err       swallowed write errors (best-effort)

When the working directory is not inside a project repo, the journal falls back to a
per-user global location keyed by a hash of the cwd.

Design rules (mirroring ``pattern_catalog.py``): module-level constants, pure functions,
plain dicts, no classes, no caching. One extra invariant unique to this module — **writers
never raise**; a memory fault must never break a tool call, so failures are swallowed to
``journal.err`` on a best-effort basis.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


PLUGIN_ROOT = Path(__file__).resolve().parents[1]
SCHEMA_VERSION = 1

JOURNAL_FILE = "journal.jsonl"
DECISIONS_DIRNAME = "decisions"
INDEX_FILE = "index.md"
ERROR_FILE = "journal.err"

# A project root is the nearest ancestor carrying one of these markers.
PROJECT_MARKERS = (
    ".git",
    "pyproject.toml",
    "package.json",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "tsconfig.json",
)

KNOWN_KINDS = {"scan", "recommendation", "decision", "applied", "edit", "note"}
DECISION_STATUSES = {"proposed", "accepted", "superseded", "deprecated"}
_STATUS_ALIASES = {
    "accept": "accepted",
    "supersede": "superseded",
    "superceded": "superseded",
    "deprecate": "deprecated",
}
APPLIED_OUTCOMES = {"done", "partial", "reverted"}
_STATUS_RANK = {"accepted": 0, "proposed": 1, "superseded": 2, "deprecated": 3}


# --------------------------------------------------------------------------- #
# Path resolution
# --------------------------------------------------------------------------- #
def _plugin_root() -> Path:
    env_root = (
        os.environ.get("CLAUDE_PLUGIN_ROOT")
        or os.environ.get("CODEX_PLUGIN_ROOT")
        or os.environ.get("PLUGIN_ROOT")
    )
    if env_root:
        return Path(env_root).expanduser().resolve()
    return PLUGIN_ROOT


def _inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except (ValueError, OSError):
        return False


def _cwd() -> Path:
    return Path(os.environ.get("PWD") or Path.cwd())


def find_project_root(start: Path | None = None) -> Path | None:
    """Nearest ancestor of ``start`` (default: $PWD/cwd) carrying a project marker.

    Returns ``None`` when there is no such ancestor or when ``start`` is inside the
    plugin's own checkout — memory must never be written into the plugin directory.
    """
    base = start or _cwd()
    try:
        base = base.expanduser().resolve()
    except OSError:
        return None
    if not base.exists() or _inside(base, _plugin_root()):
        return None
    current = base if base.is_dir() else base.parent
    for parent in [current, *current.parents]:
        if any((parent / marker).exists() for marker in PROJECT_MARKERS):
            return parent
    return None


def _resolve() -> tuple[Path, str, Path | None]:
    """Return ``(journal_dir, mode, anchor)``.

    ``mode`` is ``"project"`` or ``"global"``. ``anchor`` is the project root in project
    mode (used to relativise stored paths), ``None`` in global mode.
    """
    project = find_project_root()
    if project is not None:
        return project / ".claude" / "plugins" / "design-patterns", "project", project
    base = os.environ.get("CLAUDE_PLUGIN_DATA")
    root = (
        Path(base).expanduser()
        if base
        else Path.home() / ".claude" / "plugins" / "data" / "design-patterns"
    )
    key = hashlib.sha256(str(_cwd()).encode("utf-8")).hexdigest()[:12]
    return root / "projects" / key, "global", None


def journal_root() -> tuple[Path, str]:
    """Public ``(journal_dir, mode)`` — never creates the directory."""
    journal_dir, mode, _ = _resolve()
    return journal_dir, mode


def journal_path() -> Path:
    return journal_root()[0] / JOURNAL_FILE


def journal_location() -> dict[str, Any]:
    """Describe where memory lives — for ``patterns_recall`` and ``bin/patterns memory where``."""
    journal_dir, mode, anchor = _resolve()
    journal = journal_dir / JOURNAL_FILE
    return {
        "mode": mode,
        "root": str(journal_dir),
        "journal": str(journal),
        "exists": journal.exists(),
        "projectRoot": str(anchor) if anchor is not None else None,
    }


# --------------------------------------------------------------------------- #
# Small helpers
# --------------------------------------------------------------------------- #
def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _rel_to(anchor: Path | None) -> str:
    cwd = _cwd()
    if anchor is not None:
        try:
            rel = cwd.resolve().relative_to(anchor.resolve())
            return str(rel) or "."
        except (ValueError, OSError):
            pass
    return str(cwd)


def _normalize_path(value: Any) -> str:
    """Project-relative when possible, else absolute — so the same target is comparable
    across runs regardless of the cwd a tool happened to be invoked from."""
    raw = Path(str(value)).expanduser()
    if not raw.is_absolute():
        raw = _cwd() / raw
    try:
        raw = raw.resolve()
    except OSError:
        return str(value)
    _, _, anchor = _resolve()
    if anchor is not None:
        try:
            return str(raw.relative_to(anchor.resolve()))
        except ValueError:
            pass
    return str(raw)


def _normalize_status(status: Any) -> str:
    value = str(status or "").strip().lower()
    if value in DECISION_STATUSES:
        return value
    return _STATUS_ALIASES.get(value, "proposed")


def _slug_list(value: Any) -> list[str] | None:
    """Best-effort sorted slug list from a scan_path 'patterns' field, whatever its shape —
    a list of slug strings, a list of entry dicts, or a slug->entry mapping."""
    if not value:
        return None
    items = value.values() if isinstance(value, dict) else value
    slugs: set[str] = set()
    for item in items:
        if isinstance(item, str):
            slugs.add(item)
        elif isinstance(item, dict):
            slug = item.get("slug") or item.get("pattern") or item.get("name")
            if slug:
                slugs.add(str(slug))
    return sorted(slugs) or None


def _pattern_known(slug: str) -> bool | None:
    """Best-effort: is ``slug`` a real catalog pattern? ``None`` if the catalog can't load."""
    try:
        from pattern_catalog import load_patterns

        return slug in {pattern.get("slug") for pattern in load_patterns()}
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Writers — these never raise
# --------------------------------------------------------------------------- #
def _record_error(journal_dir: Path, kind: str, exc: Exception) -> None:
    try:
        journal_dir.mkdir(parents=True, exist_ok=True)
        with (journal_dir / ERROR_FILE).open("a", encoding="utf-8") as handle:
            handle.write(f"{_now_iso()}\t{kind}\t{exc!r}\n")
    except Exception:
        pass  # truly best-effort — there is nowhere left to report to


def _append(kind: str, payload: dict[str, Any], *, tool: str | None = None) -> dict[str, Any]:
    """Append one event to the journal. Never raises; returns the written record, or a
    ``{"recorded": False, ...}`` stub if the write failed."""
    journal_dir, _, anchor = _resolve()
    record: dict[str, Any] = {
        "schemaVersion": SCHEMA_VERSION,
        "id": uuid.uuid4().hex,
        "ts": _now_iso(),
        "kind": kind,
        "tool": tool,
        "cwd": _rel_to(anchor),
    }
    for key, value in payload.items():
        if value is not None:
            record[key] = value
    try:
        journal_dir.mkdir(parents=True, exist_ok=True)
        line = json.dumps(record, separators=(",", ":"), sort_keys=True)
        with (journal_dir / JOURNAL_FILE).open("a", encoding="utf-8") as handle:
            handle.write(line + "\n")
            handle.flush()
        return record
    except Exception as exc:  # a memory write must never break a tool call
        _record_error(journal_dir, kind, exc)
        return {"recorded": False, "error": str(exc), **record}


def next_adr_number() -> int:
    numbers = [
        decision.get("adrNumber")
        for decision in current_decisions()
        if isinstance(decision.get("adrNumber"), int)
    ]
    return max(numbers) + 1 if numbers else 1


def record_scan(
    scan_result: dict[str, Any],
    *,
    path: Any,
    pack: Any = None,
    min_confidence: float = 0.0,
) -> dict[str, Any]:
    """Capture a ``patterns_scan`` result as a compact ``scan`` event (evidence snippets
    are dropped — the journal stays small; the smells and their locations are kept)."""
    findings = scan_result.get("findings", []) or []
    compact = [
        {
            "smell": finding.get("smell"),
            "severity": finding.get("severity"),
            "file": finding.get("file"),
            "line": finding.get("line"),
            "confidence": finding.get("confidence"),
        }
        for finding in findings
    ]
    smell_counts: dict[str, int] = {}
    for finding in compact:
        slug = finding.get("smell")
        if slug:
            smell_counts[slug] = smell_counts.get(slug, 0) + 1
    return _append(
        "scan",
        {
            "path": _normalize_path(path),
            "pack": pack,
            "minConfidence": min_confidence,
            "findingCount": len(compact),
            "findings": compact,
            "smellCounts": smell_counts,
            "patternSlugs": _slug_list(scan_result.get("patterns")),
        },
        tool="patterns_scan",
    )


def record_recommendation(payload: dict[str, Any]) -> dict[str, Any]:
    """Capture a ``patterns_recommend`` result as a compact ``recommendation`` event."""
    recommendations = payload.get("recommendations", []) or []
    top = [rec.get("slug") for rec in recommendations if rec.get("slug")][:8]
    return _append(
        "recommendation",
        {
            "query": payload.get("query"),
            "scope": payload.get("scope"),
            "language": payload.get("language"),
            "risk": payload.get("risk"),
            "topSlugs": top or None,
            "primarySlug": top[0] if top else None,
        },
        tool="patterns_recommend",
    )


def record_decision(
    adr_result: dict[str, Any],
    *,
    status: Any = None,
    scope: Any = None,
    language: Any = None,
) -> dict[str, Any]:
    """Capture a freshly generated ADR (from ``patterns_adr``). Allocates a new
    ``adrNumber`` and re-renders the decision files."""
    chosen = adr_result.get("recommendedEntry") or {}
    alternatives = adr_result.get("alternatives", []) or []
    number = next_adr_number()
    record = _append(
        "decision",
        {
            "adrNumber": number,
            "title": adr_result.get("title"),
            "status": _normalize_status(status or adr_result.get("status")),
            "context": adr_result.get("context"),
            "chosenSlug": chosen.get("slug"),
            "alternativeSlugs": [alt.get("slug") for alt in alternatives if alt.get("slug")] or None,
            "scope": scope,
            "language": language,
        },
        tool="patterns_adr",
    )
    render()
    return record


def record_decision_status(
    adr_number: Any,
    status: Any,
    *,
    summary: Any = None,
    supersedes: Any = None,
) -> dict[str, Any]:
    """Record an ADR lifecycle transition (accepted / superseded / deprecated) against an
    existing ``adrNumber``. ``current_decisions()`` field-merges these onto the original."""
    try:
        number = int(adr_number)
    except (TypeError, ValueError):
        return {"recorded": False, "error": f"adr must be an integer, got {adr_number!r}"}
    payload: dict[str, Any] = {"adrNumber": number, "status": _normalize_status(status)}
    if summary:
        payload["summary"] = summary
    if supersedes is not None:
        try:
            payload["supersedes"] = int(supersedes)
        except (TypeError, ValueError):
            pass
    record = _append("decision", payload, tool="patterns_record")
    render()
    return record


def record_applied(
    *,
    pattern: Any,
    target: Any,
    adr: Any = None,
    source_shape: Any = None,
    outcome: Any = "done",
    summary: Any = None,
    verified: Any = False,
    notes: Any = None,
) -> dict[str, Any]:
    """Record a real applied refactor. This is the only honest capture of an *outcome*:
    the MCP server never sees Edit/Write, so a skill calls this after the change lands."""
    slug = str(pattern or "").strip()
    if not slug or not str(target or "").strip():
        return {"recorded": False, "error": "record_applied requires both 'pattern' and 'target'"}
    known = _pattern_known(slug)
    linked_adr: int | None = None
    if adr is not None:
        try:
            linked_adr = int(adr)
        except (TypeError, ValueError):
            linked_adr = None
    record = _append(
        "applied",
        {
            "pattern": slug,
            "patternKnown": known,
            "targetModule": _normalize_path(target),
            "linkedAdr": linked_adr,
            "sourceShape": source_shape,
            "outcome": str(outcome).strip().lower() if str(outcome).strip().lower() in APPLIED_OUTCOMES else "done",
            "summary": summary,
            "verified": bool(verified),
            "notes": notes,
        },
        tool="patterns_record",
    )
    render()
    return record


def record_from_tool(kind: Any, arguments: dict[str, Any]) -> dict[str, Any]:
    """Dispatch for the ``patterns_record`` MCP tool / ``patterns memory record`` CLI."""
    kind = str(kind or "").strip().lower()
    if kind == "applied":
        return record_applied(
            pattern=arguments.get("pattern"),
            target=arguments.get("target") or arguments.get("targetModule"),
            adr=arguments.get("adr"),
            source_shape=arguments.get("sourceShape") or arguments.get("source_shape"),
            outcome=arguments.get("outcome") or "done",
            summary=arguments.get("summary"),
            verified=arguments.get("verified", False),
            notes=arguments.get("notes"),
        )
    if kind == "decision":
        adr = arguments.get("adr")
        if adr is None:
            return {"recorded": False, "error": "decision records require an 'adr' number"}
        return record_decision_status(
            adr,
            arguments.get("status") or "accepted",
            summary=arguments.get("summary"),
            supersedes=arguments.get("supersedes"),
        )
    if kind == "note":
        target = arguments.get("target")
        return _append(
            "note",
            {
                "summary": arguments.get("summary"),
                "target": _normalize_path(target) if target else None,
            },
            tool="patterns_record",
        )
    return {"recorded": False, "error": f"unknown record kind: {kind!r} (expected applied, decision, or note)"}


def record_edit(file_path: Any, tool: str | None = None) -> dict[str, Any]:
    """Coarse breadcrumb from the PostToolUse hook — records THAT a file changed, not
    which pattern or decision (intent lives in the conversation, not the tool input).
    Real applied-refactor outcomes come through record_applied."""
    return _append(
        "edit",
        {"file": _normalize_path(file_path), "editTool": tool},
        tool=tool or "edit-hook",
    )


# --------------------------------------------------------------------------- #
# Readers / folders
# --------------------------------------------------------------------------- #
def iter_events(kinds: Iterable[str] | None = None) -> list[dict[str, Any]]:
    """All journal events in append order. Tolerates malformed/partial lines and a
    missing journal (returns ``[]`` — the read path never creates the directory)."""
    journal = journal_path()
    if not journal.exists():
        return []
    wanted = set(kinds) if kinds is not None else None
    events: list[dict[str, Any]] = []
    try:
        with journal.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except Exception:
                    continue  # tailers see partial writes mid-flush — skip, don't fail
                if not isinstance(event, dict):
                    continue
                if wanted is None or event.get("kind") in wanted:
                    events.append(event)
    except OSError:
        return []
    return events


def current_decisions() -> list[dict[str, Any]]:
    """Fold ``decision`` events by ``adrNumber`` — later events field-merge onto earlier
    ones, so a minimal status-transition keeps the original title/context while the
    latest status wins. Sorted by ``adrNumber``."""
    folded: dict[int, dict[str, Any]] = {}
    for event in iter_events(("decision",)):
        number = event.get("adrNumber")
        if not isinstance(number, int):
            continue
        merged = dict(folded.get(number, {}))
        for key, value in event.items():
            if value is not None:
                merged[key] = value
        merged["adrNumber"] = number
        folded[number] = merged
    return [folded[number] for number in sorted(folded)]


def decisions_for_force(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """Stored decisions whose title/context/chosen pattern overlap ``query`` — accepted
    decisions first. This is what lets ``patterns_recommend`` say "you already decided X"."""
    if not query:
        return []
    try:
        from pattern_intelligence import tokenize

        terms = set(tokenize(query))
    except Exception:
        terms = {token for token in re.findall(r"[a-z0-9-]+", str(query).casefold()) if len(token) > 2}
    if not terms:
        return []
    scored: list[tuple[int, int, dict[str, Any]]] = []
    for decision in current_decisions():
        haystack = " ".join(
            str(decision.get(key) or "") for key in ("title", "context", "chosenSlug")
        ).casefold()
        hay_terms = set(re.findall(r"[a-z0-9-]+", haystack))
        overlap = len(terms & hay_terms)
        if overlap == 0:
            continue
        status_rank = _STATUS_RANK.get(decision.get("status", "proposed"), 4)
        scored.append((status_rank, -overlap, decision))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [decision for _, _, decision in scored[:limit]]


def _finding_keys(findings: Iterable[dict[str, Any]]) -> set[str]:
    """Identity of a finding for diffing — keyed by smell + file (line numbers drift)."""
    keys: set[str] = set()
    for finding in findings or []:
        smell = finding.get("smell")
        if smell:
            keys.add(f"{smell} @ {finding.get('file') or '?'}")
    return keys


def last_scan(path: Any) -> dict[str, Any] | None:
    normalized = _normalize_path(path)
    matches = [event for event in iter_events(("scan",)) if event.get("path") == normalized]
    return matches[-1] if matches else None


def scan_diff(path: Any, current_result: dict[str, Any]) -> dict[str, Any]:
    """Diff a fresh scan against the last stored scan of the same path — the engine
    behind ``patterns_scan``'s "3 new smells, 2 resolved since <date>"."""
    current = _finding_keys(current_result.get("findings", []) or [])
    previous_event = last_scan(path)
    if previous_event is None:
        return {
            "comparedToPrevious": False,
            "newSmells": sorted(current),
            "resolvedSmells": [],
            "unchanged": 0,
        }
    previous = _finding_keys(previous_event.get("findings", []) or [])
    return {
        "comparedToPrevious": True,
        "since": previous_event.get("ts"),
        "newSmells": sorted(current - previous),
        "resolvedSmells": sorted(previous - current),
        "unchanged": len(current & previous),
    }


def applied_for_module(module: Any) -> list[dict[str, Any]]:
    """Applied-refactor events touching ``module`` (exact, or a parent/child directory)."""
    normalized = _normalize_path(module)
    results: list[dict[str, Any]] = []
    for event in iter_events(("applied",)):
        target = event.get("targetModule") or ""
        if (
            target == normalized
            or target.startswith(normalized.rstrip("/") + "/")
            or normalized.startswith(target.rstrip("/") + "/")
        ):
            results.append(event)
    return results


def pattern_index() -> dict[str, dict[str, Any]]:
    """Derived "what patterns we have and where" — folds ``applied`` events into
    ``{slug: {modules, decisions, lastTouched, count}}``."""
    index: dict[str, dict[str, Any]] = {}
    for event in iter_events(("applied",)):
        slug = event.get("pattern")
        if not slug:
            continue
        entry = index.setdefault(
            slug, {"modules": [], "decisions": [], "lastTouched": None, "count": 0}
        )
        entry["count"] += 1
        target = event.get("targetModule")
        if target and target not in entry["modules"]:
            entry["modules"].append(target)
        adr = event.get("linkedAdr")
        if isinstance(adr, int) and adr not in entry["decisions"]:
            entry["decisions"].append(adr)
        ts = event.get("ts")
        if ts and (entry["lastTouched"] is None or ts > entry["lastTouched"]):
            entry["lastTouched"] = ts
    for entry in index.values():
        entry["modules"].sort()
        entry["decisions"].sort()
    return index


def _recent(events: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Most-recent-first event list for recall, with bulky scan ``findings`` trimmed
    (the full findings stay in the journal and are reachable via ``last_scan``)."""
    window = events[-limit:] if limit and limit > 0 else events
    trimmed: list[dict[str, Any]] = []
    for event in reversed(window):
        if event.get("kind") == "scan" and "findings" in event:
            trimmed.append({key: value for key, value in event.items() if key != "findings"})
        else:
            trimmed.append(dict(event))
    return trimmed


def recall_summary(
    query: str | None = None,
    path: Any = None,
    limit: int = 20,
) -> dict[str, Any]:
    """One-stop memory payload for ``patterns_recall`` / ``/patterns-history`` /
    ``bin/patterns memory recall``."""
    journal_dir, mode, anchor = _resolve()
    events = iter_events()
    decisions = current_decisions()
    applied = [event for event in events if event.get("kind") == "applied"]
    summary: dict[str, Any] = {
        "mode": mode,
        "root": str(journal_dir),
        "projectRoot": str(anchor) if anchor is not None else None,
        "journalExists": (journal_dir / JOURNAL_FILE).exists(),
        "eventCount": len(events),
        "decisionCount": len(decisions),
        "appliedCount": len(applied),
        "decisions": decisions,
        "patternIndex": pattern_index(),
        "recentEvents": _recent(events, limit),
    }
    if query:
        summary["query"] = query
        summary["matchedDecisions"] = decisions_for_force(query)
    if path:
        summary["path"] = _normalize_path(path)
        summary["lastScan"] = last_scan(path)
    return summary


# --------------------------------------------------------------------------- #
# Renderers
# --------------------------------------------------------------------------- #
def render() -> None:
    """Regenerate ``decisions/NNNN-*.md`` and ``index.md`` from the journal.

    Stub for now — implemented in Phase 5 (BDM-58). ``record_decision`` /
    ``record_applied`` already call it so the seam is in place; until then the JSONL
    journal is the only materialised form, which the readers above already cover.
    """
    return None

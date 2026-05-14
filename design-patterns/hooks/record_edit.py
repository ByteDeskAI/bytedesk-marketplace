#!/usr/bin/env python3
"""PostToolUse recorder for the design-patterns pattern-memory hook.

Reads a PostToolUse event from stdin; for an Edit/Write/MultiEdit tool call it
appends one coarse "edit" breadcrumb to the project's pattern-memory journal via
``pattern_memory.record_edit``. Invoked by ``hooks/event-emitter.sh``.

Never raises, always exits 0 — an observability hook must not block a tool call.
See design-patterns/docs/adr/0001-pattern-memory.md (BDM-56).
"""

from __future__ import annotations

import json
import os
import sys


_ROOT = os.environ.get("DP_ROOT") or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(_ROOT, "lib"))


def main() -> int:
    try:
        raw = sys.stdin.read()
        event = json.loads(raw) if raw.strip() else {}
        tool = event.get("tool_name") or ""
        if tool in ("Edit", "Write", "MultiEdit"):
            file_path = (event.get("tool_input") or {}).get("file_path")
            if file_path:
                import pattern_memory

                pattern_memory.record_edit(file_path, tool)
    except Exception:
        pass  # observability hook — never block a tool call
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""Unit tests for lib/pattern_memory.py — the cross-session pattern-memory layer.

Each test runs against a fresh throwaway project (and a throwaway global data
root), so nothing here ever touches a real journal.
"""

from __future__ import annotations

import json
import os
import shutil
import stat
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "lib"))

import pattern_memory as M  # noqa: E402


class _MemoryTest(unittest.TestCase):
    """Base: a fresh temp project (with a `.git` marker) per test, env restored after."""

    def setUp(self) -> None:
        self._env = {key: os.environ.get(key) for key in ("PWD", "CLAUDE_PLUGIN_DATA")}
        self.tmp = tempfile.mkdtemp(prefix="dp-mem-test-")
        self.project = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.project, ".git"))
        os.environ["PWD"] = self.project
        os.environ["CLAUDE_PLUGIN_DATA"] = os.path.join(self.tmp, "_global")
        self.journal_dir = Path(self.project) / ".claude" / "plugins" / "design-patterns"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _journal_lines(self) -> list[dict]:
        path = self.journal_dir / M.JOURNAL_FILE
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


class ResolutionTests(_MemoryTest):
    def test_project_mode_when_inside_a_repo(self) -> None:
        root, mode = M.journal_root()
        self.assertEqual(mode, "project")
        self.assertEqual(Path(root).resolve(), self.journal_dir.resolve())
        self.assertFalse((self.journal_dir / M.JOURNAL_FILE).exists(), "read path must not create the journal")

    def test_global_mode_when_not_in_a_project(self) -> None:
        bare = os.path.join(self.tmp, "bare")
        os.makedirs(bare)
        os.environ["PWD"] = bare
        root, mode = M.journal_root()
        self.assertEqual(mode, "global")
        self.assertIn("_global", str(root))

    def test_refuses_to_resolve_inside_the_plugin(self) -> None:
        os.environ["PWD"] = str(PLUGIN / "lib")
        self.assertIsNone(M.find_project_root())


class WriterTests(_MemoryTest):
    def test_each_record_appends_one_wellformed_line(self) -> None:
        M.record_scan({"findings": [{"smell": "god-service", "file": "a.py"}], "patterns": []}, path="a.py")
        M.record_recommendation({"query": "x", "recommendations": [{"slug": "strategy"}]})
        M.record_applied(pattern="strategy", target="a.py")
        lines = self._journal_lines()
        self.assertEqual([event["kind"] for event in lines], ["scan", "recommendation", "applied"])
        for event in lines:
            for field in ("schemaVersion", "id", "ts", "kind", "cwd"):
                self.assertIn(field, event)
            self.assertEqual(event["schemaVersion"], M.SCHEMA_VERSION)

    def test_writer_failure_does_not_raise(self) -> None:
        self.journal_dir.mkdir(parents=True)
        os.chmod(self.journal_dir, stat.S_IREAD | stat.S_IEXEC)
        try:
            result = M.record_applied(pattern="adapter", target="a.py")
            self.assertIs(result.get("recorded"), False)  # surfaced as a value, never raised
        finally:
            os.chmod(self.journal_dir, stat.S_IRWXU)

    def test_record_applied_requires_pattern_and_target(self) -> None:
        self.assertIs(M.record_applied(pattern="strategy", target="").get("recorded"), False)
        self.assertIs(M.record_applied(pattern="", target="a.py").get("recorded"), False)

    def test_next_adr_number_increments(self) -> None:
        self.assertEqual(M.next_adr_number(), 1)
        M.record_decision({"title": "t", "recommendedEntry": {"slug": "strategy"}, "alternatives": []})
        self.assertEqual(M.next_adr_number(), 2)


class FoldTests(_MemoryTest):
    def test_current_decisions_folds_latest_status_wins(self) -> None:
        M.record_decision({
            "title": "Use Strategy", "context": "ctx", "status": "Proposed",
            "recommendedEntry": {"slug": "strategy"}, "alternatives": [{"slug": "state"}],
        })
        M.record_decision_status(1, "accepted", summary="shipped")
        decisions = M.current_decisions()
        self.assertEqual(len(decisions), 1)
        decision = decisions[0]
        self.assertEqual(decision["adrNumber"], 1)
        self.assertEqual(decision["status"], "accepted")     # latest event wins
        self.assertEqual(decision["title"], "Use Strategy")  # original field preserved
        self.assertEqual(decision["summary"], "shipped")
        self.assertTrue(decision.get("createdTs"))

    def test_decisions_for_force_ranks_accepted_first(self) -> None:
        M.record_decision({
            "title": "Strategy for provider dispatch", "context": "provider selection leaks",
            "recommendedEntry": {"slug": "strategy"}, "alternatives": [],
        })
        M.record_decision({
            "title": "Provider dispatch via Bridge", "context": "provider abstraction",
            "recommendedEntry": {"slug": "bridge"}, "alternatives": [],
        })
        M.record_decision_status(2, "accepted")
        matched = M.decisions_for_force("provider dispatch")
        self.assertGreaterEqual(len(matched), 2)
        self.assertEqual(matched[0]["status"], "accepted")

    def test_pattern_index_shape(self) -> None:
        M.record_applied(pattern="strategy", target="src/a.py", adr=1)
        M.record_applied(pattern="strategy", target="src/b.py")
        index = M.pattern_index()
        self.assertIn("strategy", index)
        self.assertEqual(sorted(index["strategy"]["modules"]), ["src/a.py", "src/b.py"])
        self.assertEqual(index["strategy"]["decisions"], [1])
        self.assertEqual(index["strategy"]["count"], 2)


class ScanDiffTests(_MemoryTest):
    def test_scan_diff_reports_new_and_resolved(self) -> None:
        first = {"findings": [
            {"smell": "god-service", "file": "a.py"},
            {"smell": "unbounded-retry", "file": "b.py"},
        ], "patterns": []}
        M.record_scan(first, path="src")
        second = {"findings": [
            {"smell": "god-service", "file": "a.py"},
            {"smell": "naive-exactly-once", "file": "c.py"},
        ], "patterns": []}
        diff = M.scan_diff("src", second)
        self.assertTrue(diff["comparedToPrevious"])
        self.assertEqual(diff["newSmells"], ["naive-exactly-once @ c.py"])
        self.assertEqual(diff["resolvedSmells"], ["unbounded-retry @ b.py"])
        self.assertEqual(diff["unchanged"], 1)

    def test_scan_diff_with_no_prior_scan(self) -> None:
        diff = M.scan_diff("src", {"findings": [{"smell": "god-service", "file": "a.py"}], "patterns": []})
        self.assertFalse(diff["comparedToPrevious"])
        self.assertEqual(diff["newSmells"], ["god-service @ a.py"])


class RenderTests(_MemoryTest):
    def test_render_is_deterministic(self) -> None:
        M.record_decision({
            "title": "Use Strategy", "context": "ctx",
            "recommendedEntry": {"slug": "strategy"}, "alternatives": [{"slug": "state"}],
        })
        M.record_applied(pattern="strategy", target="src/a.py", adr=1)
        decisions_dir = self.journal_dir / M.DECISIONS_DIRNAME
        index = self.journal_dir / M.INDEX_FILE
        self.assertTrue((decisions_dir / "0001-strategy.md").exists())
        self.assertTrue(index.exists())
        snapshot = {path.name: path.read_bytes() for path in decisions_dir.glob("*.md")}
        snapshot_index = index.read_bytes()
        M.render()
        M.render()
        self.assertEqual({path.name: path.read_bytes() for path in decisions_dir.glob("*.md")}, snapshot)
        self.assertEqual(index.read_bytes(), snapshot_index)

    def test_render_reflects_status_transition(self) -> None:
        M.record_decision({
            "title": "Use Strategy", "context": "ctx",
            "recommendedEntry": {"slug": "strategy"}, "alternatives": [],
        })
        M.record_decision_status(1, "accepted")
        text = (self.journal_dir / M.DECISIONS_DIRNAME / "0001-strategy.md").read_text()
        self.assertIn("status: accepted", text)
        self.assertIn("**Status:** accepted", text)


class RecallTests(_MemoryTest):
    def test_recall_summary_reports_mode_and_counts(self) -> None:
        M.record_decision({
            "title": "Use Strategy", "context": "provider dispatch",
            "recommendedEntry": {"slug": "strategy"}, "alternatives": [],
        })
        M.record_applied(pattern="strategy", target="src/a.py", adr=1)
        summary = M.recall_summary(query="provider dispatch", path="src")
        self.assertEqual(summary["mode"], "project")
        self.assertEqual(summary["decisionCount"], 1)
        self.assertEqual(summary["appliedCount"], 1)
        self.assertIn("matchedDecisions", summary)
        self.assertIn("patternIndex", summary)


if __name__ == "__main__":
    unittest.main()

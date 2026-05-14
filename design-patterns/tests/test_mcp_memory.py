"""Tests for the pattern-memory wiring in the MCP server — drives `call_tool`
directly (no stdio needed). Each test runs against a fresh throwaway project.
"""

from __future__ import annotations

import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PLUGIN = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN / "lib"))

import pattern_mcp_server as S  # noqa: E402


class _McpMemoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._env = {key: os.environ.get(key) for key in ("PWD", "CLAUDE_PLUGIN_DATA")}
        self.tmp = tempfile.mkdtemp(prefix="dp-mcp-mem-test-")
        self.project = os.path.join(self.tmp, "proj")
        os.makedirs(os.path.join(self.project, ".git"))
        os.environ["PWD"] = self.project
        os.environ["CLAUDE_PLUGIN_DATA"] = os.path.join(self.tmp, "_global")

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)
        for key, value in self._env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _source_file(self, name: str = "app.py") -> str:
        path = os.path.join(self.project, name)
        with open(path, "w", encoding="utf-8") as handle:
            handle.write("while True:\n    retry()\n    consume(message)\n    publish(message)\n")
        return path


class ToolRegistrationTests(_McpMemoryTest):
    def test_record_and_recall_tools_are_registered(self) -> None:
        names = {tool["name"] for tool in S.tool_definitions()}
        self.assertIn("patterns_record", names)
        self.assertIn("patterns_recall", names)


class AutoCaptureTests(_McpMemoryTest):
    def test_patterns_scan_attaches_memory_diff_and_records(self) -> None:
        path = self._source_file()
        first = S.call_tool("patterns_scan", {"path": path})
        self.assertIn("memoryDiff", first)
        again = S.call_tool("patterns_scan", {"path": path})
        self.assertTrue(again["memoryDiff"]["comparedToPrevious"])

    def test_patterns_adr_records_and_returns_adr_number(self) -> None:
        result = S.call_tool("patterns_adr", {"query": "durable SSE event storage: Redis vs PostgreSQL"})
        self.assertIsInstance(result.get("adrNumber"), int)

    def test_patterns_recommend_surfaces_prior_decisions(self) -> None:
        force = "provider selection leaks into domain code"
        S.call_tool("patterns_adr", {"query": force})
        result = S.call_tool("patterns_recommend", {"query": force})
        self.assertTrue(result.get("priorDecisions"))
        self.assertIn("memoryHint", result)


class RecordRecallTests(_McpMemoryTest):
    def test_record_applied_round_trips_through_recall(self) -> None:
        recorded = S.call_tool("patterns_record", {
            "kind": "applied", "pattern": "strategy", "target": "src/providers.py",
            "summary": "extracted ProviderStrategy",
        })
        self.assertEqual(recorded.get("kind"), "applied")
        recall = S.call_tool("patterns_recall", {})
        self.assertEqual(recall["appliedCount"], 1)
        self.assertIn("strategy", recall["patternIndex"])

    def test_patterns_record_missing_required_args_returns_missing_response(self) -> None:
        result = S.call_tool("patterns_record", {"kind": "applied", "pattern": "strategy"})
        self.assertIs(result.get("ok"), False)
        missing = {item["name"] for item in result.get("missingArguments", [])}
        self.assertIn("target", missing)

    def test_patterns_recall_query_surfaces_matched_decisions(self) -> None:
        S.call_tool("patterns_adr", {"query": "event fanout duplicate delivery"})
        recall = S.call_tool("patterns_recall", {"query": "duplicate delivery"})
        self.assertIn("matchedDecisions", recall)


if __name__ == "__main__":
    unittest.main()

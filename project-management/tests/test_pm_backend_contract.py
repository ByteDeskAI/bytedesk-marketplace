"""Backend contract tests — prove SQLiteBackend satisfies PMBackend behavior.

These tests run the same behavioral matrix against SQLiteBackend directly.
If a PostgresBackend is configured (TEST_POSTGRES_URL env var), those tests
run too — otherwise they are skipped.

This ensures both Bridge ConcreteImplementors remain interchangeable.
"""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from pm_backend_sqlite import SQLiteBackend


def make_sqlite_backend(tmp: str) -> SQLiteBackend:
    root = Path(tmp) / ".pm"
    return SQLiteBackend(root)


class BackendContractMixin:
    """Shared behavioral contract. Subclass and provide self.backend."""

    backend: object  # SQLiteBackend | PostgresBackend

    def setUp_backend(self, tmp: str) -> None:
        raise NotImplementedError

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.setUp_backend(self.tmp)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    # --- init ---

    def test_init_workspace(self):
        self.assertFalse(self.backend.is_initialized())
        path = self.backend.init_workspace("MyProject", "MP")
        self.assertTrue(self.backend.is_initialized())
        self.assertIn("MP", str(path) + self.backend.get_project_config()["key_prefix"])

    # --- issues ---

    def test_create_get_issue(self):
        self.backend.init_workspace("P", "P")
        issue = self.backend.create_issue(
            title="Do X", description="desc", issue_type="task",
            priority="medium", assignee=None, epic_id=None, sprint_id=None, story_points=3,
        )
        self.assertEqual(issue["id"], "P-1")
        self.assertEqual(issue["status"], "TODO")
        self.assertEqual(issue["story_points"], 3)

        retrieved = self.backend.get_issue("P-1")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["title"], "Do X")
        self.assertIsNone(self.backend.get_issue("P-999"))

    def test_update_issue(self):
        self.backend.init_workspace("P", "P")
        self.backend.create_issue(
            title="T", description="", issue_type="task",
            priority="low", assignee=None, epic_id=None, sprint_id=None, story_points=None,
        )
        updated = self.backend.update_issue(
            "P-1", {"status": "IN_PROGRESS", "assignee": "Alice"},
            comment="picked up", comment_author="Alice"
        )
        self.assertEqual(updated["status"], "IN_PROGRESS")
        self.assertEqual(updated["assignee"], "Alice")
        self.assertEqual(len(updated["comments"]), 1)
        self.assertEqual(updated["comments"][0]["body"], "picked up")

    def test_list_issues_filter(self):
        self.backend.init_workspace("P", "P")
        self.backend.create_issue("A", "", "bug", "high", None, None, None, None)
        self.backend.create_issue("B", "", "task", "low", None, None, None, None)
        self.backend.create_issue("C", "", "bug", "low", None, None, None, None)

        bugs = self.backend.list_issues(issue_type="bug")
        self.assertEqual(len(bugs), 2)
        tasks = self.backend.list_issues(issue_type="task")
        self.assertEqual(len(tasks), 1)
        high = self.backend.list_issues(priority="high")
        self.assertEqual(len(high), 1)

    # --- sprints ---

    def test_sprint_lifecycle(self):
        self.backend.init_workspace("P", "P")
        sprint = self.backend.create_sprint("Sprint 1", "ship v1")
        self.assertEqual(sprint["status"], "PLANNING")

        active = self.backend.start_sprint("sprint-1")
        self.assertEqual(active["status"], "ACTIVE")
        self.assertEqual(self.backend.get_active_sprint_id(), "sprint-1")

        # Double activation guard
        self.backend.create_sprint("Sprint 2", "")
        with self.assertRaises(ValueError):
            self.backend.start_sprint("sprint-2")

        closed = self.backend.complete_sprint("sprint-1")
        self.assertEqual(closed["status"], "CLOSED")
        self.assertIsNone(self.backend.get_active_sprint_id())

    # --- docs ---

    def test_doc_crud(self):
        self.backend.init_workspace("P", "P")
        d = self.backend.create_doc("Arch", "# Architecture", None)
        self.assertEqual(d["id"], "DOC-1")

        d2 = self.backend.create_doc("DB", "## Schema", "DOC-1")
        self.assertEqual(d2["parent_id"], "DOC-1")

        updated = self.backend.update_doc("DOC-1", {"title": "Architecture Overview"})
        self.assertEqual(updated["title"], "Architecture Overview")

        docs = self.backend.list_docs()
        self.assertEqual(len(docs), 2)

        found = self.backend.list_docs(query="db")
        self.assertEqual(len(found), 1)

    # --- events ---

    def test_emit_event_writes_jsonl(self):
        self.backend.init_workspace("P", "P")
        self.backend.create_issue("Emit test", "", "task", "low", None, None, None, None)
        events_path = self.backend.events_path
        self.assertTrue(events_path.exists())
        import json
        lines = [json.loads(l) for l in events_path.read_text().strip().splitlines() if l.strip()]
        types = [l["type"] for l in lines]
        self.assertIn("issue_created", types)


class TestSQLiteBackendContract(BackendContractMixin, unittest.TestCase):
    def setUp_backend(self, tmp: str) -> None:
        self.backend = make_sqlite_backend(tmp)


@unittest.skipUnless(
    os.environ.get("TEST_POSTGRES_URL", "").startswith("postgres"),
    "Set TEST_POSTGRES_URL=postgres://... to run Postgres contract tests"
)
class TestPostgresBackendContract(BackendContractMixin, unittest.TestCase):
    def setUp_backend(self, tmp: str) -> None:
        from pm_backend_postgres import PostgresBackend
        self.backend = PostgresBackend(os.environ["TEST_POSTGRES_URL"], Path(tmp) / ".pm")


if __name__ == "__main__":
    unittest.main()

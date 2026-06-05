"""Tests for PMStore (Bridge Abstraction) backed by the default SQLiteBackend.

All tests use tempdir isolation so they never touch real project data.
"""
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

# Make lib/ importable from tests/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from pm_store import PMStore


class TestPMStore(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.store = PMStore(workspace_path=self.test_dir)

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    # --- Lifecycle ---

    def test_initialization(self):
        self.assertFalse(self.store.is_initialized())

        path = self.store.init_workspace(project_name="Test Project", key_prefix="TEST")
        self.assertTrue(self.store.is_initialized())

        pm_dir = Path(path)
        self.assertTrue(pm_dir.is_dir())
        self.assertTrue((pm_dir / "pm.db").is_file(), "SQLite DB must exist after init")

    def test_sqlite_db_created(self):
        self.store.init_workspace(project_name="Test", key_prefix="T")
        pm_root = Path(self.test_dir) / ".pm"
        self.assertTrue((pm_root / "pm.db").is_file())

    def test_events_jsonl_created_on_mutation(self):
        self.store.init_workspace(project_name="Test", key_prefix="T")
        self.store.create_issue(title="First issue")
        pm_root = Path(self.test_dir) / ".pm"
        events_path = pm_root / "events.jsonl"
        self.assertTrue(events_path.exists(), "events.jsonl must be created after a mutation")
        lines = events_path.read_text().strip().splitlines()
        self.assertGreater(len(lines), 0)

    # --- Issues ---

    def test_create_and_get_issue(self):
        self.store.init_workspace(project_name="Test Project", key_prefix="TEST")

        issue = self.store.create_issue(
            title="Implement login screen",
            description="Use OAuth2 with Google.",
            issue_type="story",
            priority="high",
        )

        self.assertEqual(issue["id"], "TEST-1")
        self.assertEqual(issue["title"], "Implement login screen")
        self.assertEqual(issue["description"], "Use OAuth2 with Google.")
        self.assertEqual(issue["type"], "story")
        self.assertEqual(issue["status"], "TODO")
        self.assertEqual(issue["priority"], "high")

        retrieved = self.store.get_issue("TEST-1")
        self.assertIsNotNone(retrieved)
        self.assertEqual(retrieved["title"], "Implement login screen")

        self.assertIsNone(self.store.get_issue("TEST-99"))

    def test_update_issue_and_comments(self):
        self.store.init_workspace(project_name="Test Project", key_prefix="TEST")
        issue = self.store.create_issue(title="Write tests", description="Coverage > 80%")
        self.assertEqual(issue["status"], "TODO")

        updated = self.store.update_issue(
            issue_id="TEST-1",
            updates={"status": "IN_PROGRESS"},
            comment="Starting on this now.",
        )

        self.assertIsNotNone(updated)
        self.assertEqual(updated["status"], "IN_PROGRESS")
        self.assertEqual(len(updated["comments"]), 1)
        self.assertEqual(updated["comments"][0]["body"], "Starting on this now.")

        # Verify persistence
        retrieved = self.store.get_issue("TEST-1")
        self.assertEqual(retrieved["status"], "IN_PROGRESS")

    def test_list_issues_and_filtering(self):
        self.store.init_workspace(project_name="Test Project", key_prefix="TEST")

        self.store.create_issue(title="Task A", issue_type="task", priority="low")
        self.store.create_issue(title="Bug B", issue_type="bug", priority="high")
        self.store.create_issue(title="Task C", issue_type="task", priority="high")

        all_issues = self.store.list_issues()
        self.assertEqual(len(all_issues), 3)

        bugs = self.store.list_issues(issue_type="bug")
        self.assertEqual(len(bugs), 1)
        self.assertEqual(bugs[0]["title"], "Bug B")

        high_priority = self.store.list_issues(priority="high")
        self.assertEqual(len(high_priority), 2)

        query_match = self.store.list_issues(query="bug")
        self.assertEqual(len(query_match), 1)
        self.assertEqual(query_match[0]["title"], "Bug B")

    # --- Sprints ---

    def test_sprint_lifecycle(self):
        self.store.init_workspace(project_name="Test Project", key_prefix="TEST")

        t1 = self.store.create_issue(title="Ticket 1")
        t2 = self.store.create_issue(title="Ticket 2")

        sprint = self.store.create_sprint(name="Sprint 1", goal="Deliver core MVP")
        self.assertEqual(sprint["id"], "sprint-1")
        self.assertEqual(sprint["status"], "PLANNING")

        active = self.store.start_sprint("sprint-1")
        self.assertEqual(active["status"], "ACTIVE")
        self.assertEqual(self.store.get_active_sprint_id(), "sprint-1")

        self.store.update_issue(t1["id"], {"sprint_id": "sprint-1"})
        self.store.update_issue(t2["id"], {"sprint_id": "sprint-1", "status": "DONE"})

        # Double activation guard
        self.store.create_sprint(name="Sprint 2")
        with self.assertRaises(ValueError):
            self.store.start_sprint("sprint-2")

        closed = self.store.complete_sprint("sprint-1")
        self.assertEqual(closed["status"], "CLOSED")
        self.assertIsNone(self.store.get_active_sprint_id())

        # Unfinished ticket rolled to backlog; DONE ticket stays in sprint
        t1_retrieved = self.store.get_issue(t1["id"])
        t2_retrieved = self.store.get_issue(t2["id"])
        self.assertIsNone(t1_retrieved["sprint_id"])
        self.assertEqual(t2_retrieved["sprint_id"], "sprint-1")

    # --- Documentation ---

    def test_wiki_documentation(self):
        self.store.init_workspace(project_name="Test Project", key_prefix="TEST")

        d1 = self.store.create_doc(title="Architecture overview", content="# Core architecture")
        d2 = self.store.create_doc(title="Database schema", content="## Tables", parent_id="DOC-1")

        self.assertEqual(d1["id"], "DOC-1")
        self.assertEqual(d2["id"], "DOC-2")
        self.assertEqual(d2["parent_id"], "DOC-1")

        doc = self.store.get_doc("DOC-1")
        self.assertEqual(doc["title"], "Architecture overview")

        all_docs = self.store.list_docs()
        self.assertEqual(len(all_docs), 2)

        search_results = self.store.list_docs(query="database")
        self.assertEqual(len(search_results), 1)
        self.assertEqual(search_results[0]["id"], "DOC-2")

    # --- Observability ---

    def test_project_config_returns_sprints_and_activity(self):
        self.store.init_workspace(project_name="Obs Test", key_prefix="OBS")
        self.store.create_sprint(name="Sprint X")
        config = self.store.get_project_config()
        self.assertEqual(config["project_name"], "Obs Test")
        self.assertIn("sprints", config)
        self.assertIn("activity_log", config)


if __name__ == "__main__":
    unittest.main()

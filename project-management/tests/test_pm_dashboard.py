"""Dashboard server smoke tests — stdlib only, no external HTTP client needed."""
import json
import os
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))

from pm_backend_sqlite import SQLiteBackend
from pm_dashboard_server import (
    DashboardHandler,
    _pid_alive,
    _read_pid,
    _try_acquire_pid_lock,
    run,
)


def _free_port() -> int:
    import socket
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class TestPIDLock(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_acquire_when_no_file(self):
        pid_path = self.tmp / "dashboard.pid"
        acquired = _try_acquire_pid_lock(pid_path)
        self.assertTrue(acquired)
        self.assertEqual(_read_pid(pid_path), os.getpid())

    def test_blocks_when_live_pid_held(self):
        pid_path = self.tmp / "dashboard.pid"
        # Write our own PID as if we already hold the lock
        pid_path.write_text(str(os.getpid()) + "\n")
        acquired = _try_acquire_pid_lock(pid_path)
        self.assertFalse(acquired)

    def test_reclaims_stale_pid(self):
        pid_path = self.tmp / "dashboard.pid"
        # PID 1 is init/launchd — sending signal 0 will succeed on Unix but
        # we can use a clearly dead PID instead
        pid_path.write_text("99999999\n")  # extremely unlikely to exist
        acquired = _try_acquire_pid_lock(pid_path)
        self.assertTrue(acquired)


class TestDashboardHealth(unittest.TestCase):
    """Start the dashboard server in a background thread and probe /health."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        # Initialize a workspace so /api/status works
        backend = SQLiteBackend(self.tmp / ".pm")
        backend.init_workspace("Test Project", "TP")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _start_server(self) -> tuple:
        """Start dashboard server in a thread; return (thread, port, stop_event)."""
        import http.server

        port = _free_port()
        pm_root = self.tmp / ".pm"
        pm_root.mkdir(parents=True, exist_ok=True)
        (pm_root / "dashboard.port").write_text(str(port) + "\n")

        DashboardHandler._pm_root = pm_root
        server = http.server.ThreadingHTTPServer(("127.0.0.1", port), DashboardHandler)

        t = threading.Thread(target=server.serve_forever, daemon=True)
        t.start()
        # Give the server a moment to bind
        time.sleep(0.2)
        return t, port, server

    def test_health_endpoint(self):
        _t, port, server = self._start_server()
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/health", timeout=3)
            self.assertEqual(resp.status, 200)
            self.assertEqual(resp.read(), b"ok")
        finally:
            server.shutdown()

    def test_root_returns_html(self):
        _t, port, server = self._start_server()
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/", timeout=3)
            self.assertEqual(resp.status, 200)
            body = resp.read().decode()
            self.assertIn("PM Dashboard", body)
            self.assertIn("EventSource", body)
        finally:
            server.shutdown()

    def test_api_status_returns_json(self):
        _t, port, server = self._start_server()
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/api/status", timeout=3)
            self.assertEqual(resp.status, 200)
            data = json.loads(resp.read())
            self.assertTrue(data.get("ok"))
            self.assertIn("dashboard", data)
        finally:
            server.shutdown()

    def test_sse_endpoint_streams(self):
        _t, port, server = self._start_server()
        try:
            import socket
            s = socket.create_connection(("127.0.0.1", port), timeout=3)
            s.sendall(b"GET /events HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n")
            # Read the response header
            buf = b""
            deadline = time.time() + 3
            while time.time() < deadline and b"\r\n\r\n" not in buf:
                buf += s.recv(1024)
            s.close()
            self.assertIn(b"text/event-stream", buf)
        finally:
            server.shutdown()


if __name__ == "__main__":
    unittest.main()

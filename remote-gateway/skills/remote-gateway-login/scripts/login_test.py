#!/usr/bin/env python3
"""Contract tests for remote-gateway login. Uses a local mock, never a live gateway."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs

SCRIPT = Path(__file__).with_name("login.py")
sys.path.insert(0, str(SCRIPT.parent))
import login  # noqa: E402


class GatewayState:
    def __init__(self, user: str, password: str, mode: str) -> None:
        self.user = user
        self.password = password
        self.mode = mode
        self.posts = 0
        self.last_mode = ""
        self.sessions: set[str] = set()
        self.next_status = 302
        self.location = "/"
        self.lock = threading.Lock()


STATE: GatewayState | None = None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _send(self, status: int, body: bytes, extra: list[tuple[str, str]] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Content-Type", "application/json" if body.startswith(b"{") else "text/html")
        for key, value in extra or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:  # noqa: N802
        assert STATE is not None
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length).decode("utf-8")
        form = {key: values[-1] for key, values in parse_qs(raw).items()}
        with STATE.lock:
            STATE.posts += 1
            STATE.last_mode = form.get("login_mode", "")
            ok = (
                form.get("username") == STATE.user
                and form.get("password") == STATE.password
                and form.get("login_mode") == STATE.mode
            )
            status = STATE.next_status
            location = STATE.location
        if not ok:
            self._send(401, b"<p class=\"error\">Invalid credentials.</p>")
            return
        if status in (301, 302, 303, 307, 308) and "/approval" in location:
            self._send(status, b"", [("Location", location), ("Set-Cookie", "bytedesk_emote_gateway_session=pending; Path=/; HttpOnly")])
            return
        token = "sess-ok"
        with STATE.lock:
            STATE.sessions.add(token)
        self._send(
            302,
            b"",
            [
                ("Location", "/"),
                ("Set-Cookie", f"bytedesk_emote_gateway_session={token}; Path=/; HttpOnly"),
            ],
        )

    def do_GET(self) -> None:  # noqa: N802
        assert STATE is not None
        cookie = self.headers.get("Cookie", "")
        token = ""
        for part in cookie.split(";"):
            name, _, value = part.strip().partition("=")
            if name == "bytedesk_emote_gateway_session":
                token = value
        with STATE.lock:
            known = token in STATE.sessions
        if self.path != "/api/session" or not known:
            self._send(401, b"unauthorized")
            return
        body = json.dumps({"username": STATE.user, "remainingSec": 3600, "expiresAt": "2099-01-01T00:00:00Z", "level": "ok"}).encode()
        self._send(200, body)


def start_server(state: GatewayState) -> tuple[ThreadingHTTPServer, str]:
    global STATE
    STATE = state
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    return server, f"http://{host}:{port}"


def run_login(home: Path, args: list[str], env_extra: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["HOME"] = str(home)
    env.pop("BYTEDESK_AGENT_LOGIN", None)
    env.pop("BYTEDESK_GATEWAY_COOKIE_DIR", None)
    if env_extra:
        env.update(env_extra)
    return subprocess.run(
        [sys.executable, str(SCRIPT), *args],
        capture_output=True,
        text=True,
        env=env,
        check=False,
    )


class LoginTests(unittest.TestCase):
    def test_parse_quoted_password(self) -> None:
        data = login.parse_flat_yaml('url: http://localhost:8443\nmethod: local\nuser: ryan\npass: "quoted!pass"\n')
        self.assertEqual(data["pass"], "quoted!pass")
        self.assertEqual(data["method"], "local")

    def test_flag_login_round_trip(self) -> None:
        password = "p&ass=w!ord"
        state = GatewayState("ada", password, "local")
        server, base = start_server(state)
        home = Path(tempfile.mkdtemp(prefix="rg-login-flag-"))
        try:
            completed = run_login(
                home,
                ["--url", base, "--method", "local", "--username", "ada", "--password", password],
                {"BYTEDESK_GATEWAY_COOKIE_DIR": str(home / "cookies")},
            )
            self.assertEqual(completed.returncode, 0, completed.stderr + completed.stdout)
            self.assertNotIn(password, completed.stdout)
            self.assertNotIn(password, completed.stderr)
            self.assertNotIn("sess-ok", completed.stdout)
            body = json.loads(completed.stdout)
            self.assertTrue(body["ok"])
            self.assertFalse(body["reused"])
            self.assertEqual(body["session"]["username"], "ada")
            jar = Path(body["cookieJar"])
            self.assertEqual(jar.stat().st_mode & 0o777, 0o600)
            self.assertIn("sess-ok", jar.read_text())
            self.assertEqual(state.posts, 1)
            again = run_login(
                home,
                ["--url", base, "--method", "local", "--username", "ada", "--password", password],
                {"BYTEDESK_GATEWAY_COOKIE_DIR": str(home / "cookies")},
            )
            self.assertEqual(again.returncode, 0, again.stdout)
            self.assertTrue(json.loads(again.stdout)["reused"])
            self.assertEqual(state.posts, 1)
        finally:
            server.shutdown()
            server.server_close()

    def test_bare_yaml_and_vault_mode(self) -> None:
        password = "vault-secret"
        state = GatewayState("ada", password, "vault")
        server, base = start_server(state)
        home = Path("/tmp") / "rg-login-bare"
        home.mkdir(parents=True, exist_ok=True)
        config = home / "agent-login.yaml"
        config.write_text(f'url: {base}\nmethod: vault\nuser: ada\npass: "{password}"\n', encoding="utf-8")
        try:
            completed = run_login(
                home,
                [],
                {
                    "BYTEDESK_AGENT_LOGIN": str(config),
                    "BYTEDESK_GATEWAY_COOKIE_DIR": str(home / "cookies"),
                },
            )
            self.assertEqual(completed.returncode, 0, completed.stdout)
            self.assertNotIn(password, completed.stdout)
            self.assertEqual(state.last_mode, "vault")
            self.assertEqual(json.loads(completed.stdout)["method"], "vault")
        finally:
            server.shutdown()
            server.server_close()

    def test_rejected_password_does_not_leak(self) -> None:
        password = "not-the-password"
        state = GatewayState("ada", "correct", "local")
        server, base = start_server(state)
        home = Path("/tmp") / "rg-login-reject"
        try:
            completed = run_login(
                home,
                ["--url", base, "--method", "local", "--username", "ada", "--password", password],
                {"BYTEDESK_GATEWAY_COOKIE_DIR": str(home / "cookies")},
            )
            self.assertEqual(completed.returncode, 3)
            self.assertNotIn(password, completed.stdout)
            body = json.loads(completed.stdout)
            self.assertFalse(body["ok"])
            self.assertEqual(body["error"], "login rejected")
        finally:
            server.shutdown()
            server.server_close()

    def test_partial_flags_and_bad_method(self) -> None:
        home = Path("/tmp") / "rg-login-usage"
        partial = run_login(home, ["--url", "http://127.0.0.1:9"])
        self.assertEqual(partial.returncode, 2)
        bad = run_login(
            home,
            ["--url", "http://127.0.0.1:9", "--method", "saml", "--username", "a", "--password", "b"],
        )
        self.assertEqual(bad.returncode, 2)
        self.assertIn("vault or local", json.loads(bad.stdout)["error"])

    def test_approval_is_not_success(self) -> None:
        state = GatewayState("ada", "pw", "local")
        state.location = "/approval?id=abc"
        server, base = start_server(state)
        home = Path("/tmp") / "rg-login-approval"
        try:
            completed = run_login(
                home,
                ["--url", base, "--method", "local", "--username", "ada", "--password", "pw"],
                {"BYTEDESK_GATEWAY_COOKIE_DIR": str(home / "cookies")},
            )
            self.assertEqual(completed.returncode, 4, completed.stdout)
            self.assertIn("approval", json.loads(completed.stdout)["error"])
        finally:
            server.shutdown()
            server.server_close()

    def test_missing_file(self) -> None:
        home = Path("/tmp") / "rg-login-missing"
        completed = run_login(home, [], {"BYTEDESK_AGENT_LOGIN": str(home / "nope.yaml")})
        self.assertEqual(completed.returncode, 2)
        self.assertIn("not found", json.loads(completed.stdout)["error"])


if __name__ == "__main__":
    unittest.main()

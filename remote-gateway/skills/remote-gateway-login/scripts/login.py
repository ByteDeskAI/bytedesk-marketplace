#!/usr/bin/env python3
"""Authenticate to a ByteDesk remote gateway and store the session cookie.

Bare mode reads ~/.bytedesk/remote-gateway/agent-login.yaml.
Flag mode requires --url, --method, --username, and --password together.

Stdout is one JSON object. The password and cookie value are never printed.
"""

from __future__ import annotations

import argparse
import http.client
import json
import os
import re
import sys
import time
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode, urlparse

COOKIE_NAME = "bytedesk_emote_gateway_session"
EXIT_OK = 0
EXIT_USAGE = 2
EXIT_REJECTED = 3
EXIT_APPROVAL = 4
EXIT_TRANSPORT = 5


class LoginError(Exception):
    def __init__(self, code: int, error: str, **extra: object) -> None:
        super().__init__(error)
        self.code = code
        self.error = error
        self.extra = extra


def default_config_path() -> str:
    override = os.environ.get("BYTEDESK_AGENT_LOGIN", "").strip()
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".bytedesk", "remote-gateway", "agent-login.yaml")


def default_cookie_dir() -> str:
    override = os.environ.get("BYTEDESK_GATEWAY_COOKIE_DIR", "").strip()
    if override:
        return override
    return os.path.join(os.path.expanduser("~"), ".bytedesk", "remote-gateway", "cookies")


def parse_flat_yaml(text: str) -> dict[str, str]:
    """Read a flat key: value file. Quoted values may contain ':' and '#'."""
    data: dict[str, str] = {}
    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if raw[:1] in (" ", "\t") or line.startswith("-"):
            raise LoginError(EXIT_USAGE, f"agent-login.yaml line {lineno} must be a flat key: value")
        if ":" not in line:
            raise LoginError(EXIT_USAGE, f"agent-login.yaml line {lineno} is missing ':'")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        else:
            # Unquoted YAML comments start at whitespace + '#'.
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        if not key:
            raise LoginError(EXIT_USAGE, f"agent-login.yaml line {lineno} has an empty key")
        data[key] = value
    return data


def load_config(path: str) -> dict[str, str]:
    try:
        with open(path, encoding="utf-8") as handle:
            return parse_flat_yaml(handle.read())
    except FileNotFoundError as exc:
        raise LoginError(
            EXIT_USAGE,
            f"login file not found: {path}",
            hint="Create it with url, method (vault|local), user, and pass, or pass all four flags.",
        ) from exc
    except OSError as exc:
        raise LoginError(EXIT_USAGE, f"cannot read login file: {path}") from exc


def first(data: dict[str, str], *keys: str) -> str:
    for key in keys:
        value = data.get(key, "").strip()
        if value:
            return value
    return ""


def normalize_base(url: str) -> str:
    raw = url.strip()
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise LoginError(EXIT_USAGE, "url must be an http or https URL with a host")
    if parsed.username or parsed.password:
        raise LoginError(EXIT_USAGE, "put the username and password in fields, not in the URL")
    if parsed.query or parsed.fragment:
        raise LoginError(EXIT_USAGE, "url must be the gateway origin, without a query or fragment")
    port = parsed.port
    host = parsed.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    origin = f"{parsed.scheme}://{host}"
    if port:
        origin += f":{port}"
    return origin


def normalize_method(method: str) -> str:
    value = method.strip().lower()
    if value not in ("vault", "local"):
        raise LoginError(EXIT_USAGE, "method must be vault or local")
    return value


def resolve(args: argparse.Namespace) -> dict[str, str]:
    flagged = [args.url, args.method, args.username, args.password]
    used = [value is not None for value in flagged]
    if any(used) and not all(used):
        raise LoginError(
            EXIT_USAGE,
            "pass --url, --method, --username, and --password together, or pass none of them",
        )
    if all(used):
        creds = {
            "url": args.url or "",
            "method": args.method or "",
            "user": args.username or "",
            "password": args.password or "",
            "code": args.code or "",
            "source": "flags",
        }
    else:
        path = default_config_path()
        data = load_config(path)
        creds = {
            "url": first(data, "url"),
            "method": first(data, "method", "login_mode"),
            "user": first(data, "user", "username"),
            "password": first(data, "pass", "password"),
            "code": args.code if args.code is not None else first(data, "code"),
            "source": path,
        }
    if not creds["url"] or not creds["method"] or not creds["user"] or not creds["password"]:
        raise LoginError(EXIT_USAGE, "url, method, user, and password are all required")
    creds["url"] = normalize_base(creds["url"])
    creds["method"] = normalize_method(creds["method"])
    return creds


def redact(text: str, secret: str) -> str:
    if secret and secret in text:
        return text.replace(secret, "***")
    return text


def header_map(headers: list[tuple[str, str]]) -> dict[str, list[str]]:
    found: dict[str, list[str]] = {}
    for key, value in headers:
        found.setdefault(key.lower(), []).append(value)
    return found


def exchange(url: str, method: str, path: str, body: bytes | None, headers: dict[str, str], timeout: float):
    parsed = urlparse(url)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parsed.hostname, port, timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers)
        response = conn.getresponse()
        payload = response.read(1_000_000)
        return response.status, response.getheaders(), payload
    finally:
        conn.close()


def session_cookie(headers: list[tuple[str, str]]) -> str:
    for key, value in headers:
        if key.lower() != "set-cookie":
            continue
        pair = value.split(";", 1)[0].strip()
        name, _, cookie = pair.partition("=")
        if name.strip() == COOKIE_NAME and cookie:
            return cookie.strip()
    return ""


def cookie_expiry(headers: list[tuple[str, str]]) -> int:
    for key, value in headers:
        if key.lower() != "set-cookie" or COOKIE_NAME not in value.split(";", 1)[0]:
            continue
        for part in value.split(";")[1:]:
            attr, _, raw = part.strip().partition("=")
            if attr.lower() == "expires" and raw:
                try:
                    return int(parsedate_to_datetime(raw).timestamp())
                except (TypeError, ValueError, OverflowError, OSError):
                    break
    return int(time.time()) + 12 * 60 * 60


def jar_path(cookie_dir: str, url: str) -> str:
    parsed = urlparse(url)
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", f"{parsed.hostname}_{port}")
    return os.path.join(cookie_dir, f"{safe}.txt")


def write_jar(path: str, url: str, value: str, expires: int) -> None:
    parsed = urlparse(url)
    directory = os.path.dirname(path)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    secure = "TRUE" if parsed.scheme == "https" else "FALSE"
    host = parsed.hostname or ""
    line = f"{host}\tFALSE\t/\t{secure}\t{expires}\t{COOKIE_NAME}\t{value}\n"
    blob = "# Netscape HTTP Cookie File\n# https://curl.se/docs/http-cookies.html\n" + line
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, blob.encode("utf-8"))
    finally:
        os.close(fd)
    os.chmod(path, 0o600)


def read_jar_value(path: str, url: str) -> str:
    if not os.path.isfile(path):
        return ""
    host = urlparse(url).hostname
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return ""
    for line in lines:
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 7 and parts[0] == host and parts[5] == COOKIE_NAME and parts[6]:
            return parts[6]
    return ""


def probe(url: str, cookie: str, timeout: float) -> tuple[int, dict]:
    status, _, payload = exchange(
        url,
        "GET",
        "/api/session",
        None,
        {"Cookie": f"{COOKIE_NAME}={cookie}", "Accept": "application/json"},
        timeout,
    )
    if status != 200:
        return status, {}
    try:
        body = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return status, {}
    if not isinstance(body, dict):
        return status, {}
    keep = {}
    for key in ("username", "expiresAt", "remainingSec", "level"):
        if key in body:
            keep[key] = body[key]
    return status, keep


def same_user(session_user: object, requested: str) -> bool:
    if not isinstance(session_user, str) or not session_user.strip():
        return True
    return session_user.casefold() == requested.casefold()


def failure_reason(status: int, payload: bytes) -> tuple[int, str]:
    text = payload.decode("utf-8", "replace").lower()
    if status == 429 or "rate limited" in text or "too many failed" in text or "account locked" in text:
        return EXIT_REJECTED, "rate limited or account locked; do not retry"
    if status in (401, 403) or "invalid credentials" in text:
        return EXIT_REJECTED, "login rejected"
    return EXIT_TRANSPORT, f"unexpected login response HTTP {status}"


def public_result(ok: bool, creds: dict[str, str], jar: str, **extra: object) -> dict[str, object]:
    result: dict[str, object] = {
        "ok": ok,
        "url": creds["url"],
        "method": creds["method"],
        "user": creds["user"],
        "cookieJar": jar,
        "curl": f"curl -sS -b {json.dumps(jar)} {creds['url']}/api/session",
    }
    result.update(extra)
    return result


def login(creds: dict[str, str], cookie_dir: str, timeout: float) -> dict[str, object]:
    jar = jar_path(cookie_dir, creds["url"])
    existing = read_jar_value(jar, creds["url"])
    if existing:
        status, session = probe(creds["url"], existing, timeout)
        if status == 200 and same_user(session.get("username"), creds["user"]):
            return public_result(True, creds, jar, reused=True, session=session)

    form = urlencode(
        {
            "username": creds["user"],
            "password": creds["password"],
            "login_mode": creds["method"],
            "code": creds["code"],
        }
    ).encode("utf-8")
    try:
        status, headers, payload = exchange(
            creds["url"],
            "POST",
            "/login",
            form,
            {
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "text/html,application/json",
                "Content-Length": str(len(form)),
            },
            timeout,
        )
    except OSError as exc:
        raise LoginError(EXIT_TRANSPORT, f"cannot reach {creds['url']}: {exc.__class__.__name__}") from exc

    location = ""
    for key, value in headers:
        if key.lower() == "location":
            location = value
            break
    if status in (301, 302, 303, 307, 308) and "/approval" in urlparse(location).path:
        cookie = session_cookie(headers)
        if cookie:
            write_jar(jar, creds["url"], cookie, cookie_expiry(headers))
        raise LoginError(
            EXIT_APPROVAL,
            "login is waiting for human approval",
            location=location,
            cookieJar=jar,
        )

    cookie = session_cookie(headers)
    if status not in (301, 302, 303, 307, 308) or not cookie:
        code, reason = failure_reason(status, payload)
        raise LoginError(code, reason, status=status)

    write_jar(jar, creds["url"], cookie, cookie_expiry(headers))
    probe_status, session = probe(creds["url"], cookie, timeout)
    if probe_status != 200:
        raise LoginError(
            EXIT_TRANSPORT,
            "login set a cookie but /api/session did not accept it",
            status=probe_status,
        )
    if not same_user(session.get("username"), creds["user"]):
        raise LoginError(EXIT_TRANSPORT, "session user does not match the requested user")
    return public_result(True, creds, jar, reused=False, session=session)


def scrub(value: object, secret: str, keep: bool = False) -> object:
    """Drop the password from strings. Structural fields like url stay intact."""
    if keep or not secret:
        return value
    if isinstance(value, str):
        return value.replace(secret, "***")
    if isinstance(value, dict):
        kept = {"url", "method", "cookieJar", "curl"}
        return {key: scrub(item, secret, keep=key in kept) for key, item in value.items()}
    if isinstance(value, list):
        return [scrub(item, secret) for item in value]
    return value


def emit(payload: dict[str, object], code: int, secret: str) -> int:
    sys.stdout.write(json.dumps(scrub(payload, secret), sort_keys=True) + "\n")
    return code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Log in to a ByteDesk remote gateway")
    parser.add_argument("--url", default=None)
    parser.add_argument("--method", default=None)
    parser.add_argument("--username", default=None)
    parser.add_argument("--password", default=None)
    parser.add_argument("--code", default=None, help="Optional TOTP code")
    args = parser.parse_args(argv)
    secret = args.password or ""
    try:
        creds = resolve(args)
        secret = creds["password"]
        result = login(creds, default_cookie_dir(), timeout=20)
        return emit(result, EXIT_OK, secret)
    except LoginError as exc:
        secret = secret or str(exc.extra.get("password", ""))
        payload: dict[str, object] = {"ok": False, "error": redact(exc.error, secret)}
        for key, value in exc.extra.items():
            if key == "password":
                continue
            payload[key] = value
        return emit(payload, exc.code, secret)
    except Exception as exc:  # noqa: BLE001 — last-resort redaction so a crash cannot echo the secret
        return emit({"ok": False, "error": redact(f"login failed: {exc.__class__.__name__}", secret)}, EXIT_TRANSPORT, secret)


if __name__ == "__main__":
    sys.exit(main())

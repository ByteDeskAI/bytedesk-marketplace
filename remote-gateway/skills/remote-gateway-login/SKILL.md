---
name: remote-gateway-login
description: >
  Log an agent into a ByteDesk remote gateway and reuse the session cookie so
  later gateway calls are not blocked by the login page. Use this whenever the
  user runs /remote-gateway-login or /remote-gateway:login, asks to log in,
  sign in, or authenticate to the gateway, or any gateway request returns 401,
  403, or a redirect to /login. Bare invocation reads
  ~/.bytedesk/remote-gateway/agent-login.yaml (url, method vault|local, user,
  pass). The other way is --url --method --username --password together.
  Make sure to use this skill before calling gateway APIs, opening gateway
  projects, or continuing work that a missing session would block, even when
  the user does not say "login".
user-invokable: true
argument-hint: "[--url URL --method vault|local --username USER --password PASS] [--code TOTP]"
allowed-tools:
  - Bash
  - Read
---

# Remote gateway login

A gateway call without a session comes back as 401 or a redirect to `/login`, and the rest of the task stops. This skill gets a real session cookie first. The password stays in the login file or in the script's own request. It does not belong in chat, in a repo, or in a hand-built `curl` command line (those land in shell history and process lists).

The gateway checks `POST /login` as a form: `username`, `password`, `login_mode` (`vault` or `local`), and optional `code` for TOTP. Success is a redirect plus `Set-Cookie: bytedesk_emote_gateway_session`. `GET /api/session` returning 200 is the proof the cookie works. A redirect to `/approval` means a person still has to approve; the cookie is not usable yet.

## Which mode

Use exactly one.

**Bare.** The user passed no `--url`, `--method`, `--username`, or `--password`. Run the script with no credential flags. It reads `~/.bytedesk/remote-gateway/agent-login.yaml`, or the file in `BYTEDESK_AGENT_LOGIN` when that is set (tests and a second gateway file). Flat keys:

```yaml
url: http://localhost:8443
method: local
user: ryan
pass: "secret"
```

`method` is `vault` or `local`. `username` and `password` are accepted as aliases of `user` and `pass`. An optional `code` is the TOTP code.

**Flags.** The user supplied connection details. Pass all four together. Leaving one out is an error, not a prompt to fill it from the yaml.

```bash
bash "$SCRIPT" --url "$URL" --method vault --username "$USER" --password "$PASS"
```

`--code` is optional on either mode. Local login from a non-local network needs it unless that gateway has `SKIP_TOTP_FOR_LOCAL`. Vault password login usually does not. Do not invent a code.

## Run the script

The script next to this file is the login. Do not reimplement the POST.

```bash
SCRIPT="<directory containing this SKILL.md>/scripts/login.sh"
bash "$SCRIPT"
```

When `CLAUDE_PLUGIN_ROOT` is set, the script is `$CLAUDE_PLUGIN_ROOT/skills/remote-gateway-login/scripts/login.sh`.

Stdout is one JSON object. Trust the exit code.

| Exit | Meaning |
|---|---|
| 0 | `ok` is true. `cookieJar` is a Netscape cookie file, mode 600. `reused` true means `/api/session` was already valid, so no password was sent. |
| 2 | Missing file, mixed flags, or `method` other than `vault` or `local`. |
| 3 | Rejected, rate limited, or account locked. Stop. Another try can lock the account. |
| 4 | Waiting for human approval. Tell the user. Do not poll. |
| 5 | Gateway unreachable, or the cookie did not survive `GET /api/session`. |

Cookie files go in `~/.bytedesk/remote-gateway/cookies/` unless `BYTEDESK_GATEWAY_COOKIE_DIR` is set. One file per host and port.

## After a successful login

Use the jar for every later request to that origin. Replace the path and URL from the JSON:

```bash
curl -sS -b "$cookieJar" "$url/api/..."
```

Report `url`, `method`, `user`, `reused`, `cookieJar`, and the session `username` / `remainingSec`. Do not report the password, the yaml `pass` line, or the cookie value.

If the login file is missing and the user did not pass flags, stop and ask for the four values. If you write them, write only `~/.bytedesk/remote-gateway/agent-login.yaml`, then `chmod 600` that file. Never copy that file into a repository.

A template with placeholders is `references/agent-login.example.yaml`.

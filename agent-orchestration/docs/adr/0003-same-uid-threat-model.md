# ADR-0003: Per-agent NATS credentials and the same-uid threat model

## Status

Accepted, 2026-10-03. Settles the documentation half of TM-316 (EP-026). Written from what was built and
tested on branch `nats/ws-h`; statements marked *read* were not run.

## Decision

Per-agent credentials (TM-310) protect against **mistakes, cross-agent misuse and accidental disclosure**.
They do **not** protect against a determined process that runs as the same OS user as the operator.
For that process ao **detects and undoes** tampering with the local NATS server and says so in
`ao-topology doctor`. Real isolation needs a separate uid or the provider sandbox (TM-282).

## What the credentials stop (verified by tests in `tests/unit/agent-creds*.test.mjs`)

- One agent reading or writing another agent's mail, reply subject or handoff records: the server refuses the publish or subscribe.
- An agent creating, deleting or purging streams, reaching `$SYS`, or using the host (admin) identity: refused by the server or by the admin holder's descendant check.
- A secret in a file, environment variable or command line that a sibling agent can read by accident: the seed lives in a holder process's memory; pane env carries only that agent's own holder socket path (`tests/unit/agent-pane-hardening.test.mjs` scans the pane tree).
- A leaked or rotated key: `rotate` and `revoke` drop the live connection on reload; keys expire (24 h default).

## What TM-316 adds (verified, `tests/unit/nats-tamper.test.mjs`)

| Attack by a same-uid process | Response | Window |
|---|---|---|
| Edit `nats-server.conf` (for example add a user with `>` permissions) and `SIGHUP` the server | The admin holder compares the file with its in-memory copy every `AO_TAMPER_INTERVAL_MS` (default 5000 ms), rewrites it atomically (0600), reloads the server and appends a `nats.tamper` event (digests before and after, public keys added or removed, changed lines with secrets redacted) to `<nats home>/tamper.jsonl`. | At most one interval plus the reload. The broad user was usable before the repair and refused (`Authorization Violation`) after it. |
| The same edit, then ao issues or revokes a credential | The write path first tells the holder what the file should say; the holder compares what it finds and journals `conf-changed-before-update`. | Immediate |
| Replace the server process or its executable | The watcher records `server-pid-changed` (notice: a service-manager restart looks the same) or `server-exe-changed` (tamper). | One interval |
| Loosen file modes | Config mode is restored and the NATS home is `chmod 0700` on every config write (read; the test checks the resulting modes, not the restore). | One interval |

`ao-topology doctor` lists `NATS_CONFIG_TAMPERED` for tamper events in the last 24 h (`AO_TAMPER_REPORT_MS`) and shows whether the watcher is armed.
The mutation run (watcher interval set to one hour) shows the same attack stays in force, so the repair is the watcher's doing.

## What remains unprotected

A process with the operator's uid can still:

1. **Kill the admin holder** (it is a same-uid process). Detection stops until the next `ensureLocalNats`, which spawns a new holder and re-announces the config. While it is down a config edit is not undone.
2. **Kill the server** or fill its disk. The service manager restarts it; availability is not protected.
3. **Be inside the repair window.** An edited config is live for up to one interval.
4. **Read the operator's other files and `/proc/<pid>/mem`** of sibling processes if `ptrace_scope` allows it, and so read an agent seed from its holder. Modes of 0700/0600 keep other users out and do nothing against the same uid.
5. **Edit `tamper.jsonl` or `agent-users.json`.** The journal is not tamper-proof (an edit hides the record). A registry edit that adds a public key is *not* detected by the config watcher, because the next legitimate config write re-reads the registry file and would adopt it (read, not run). Follow-up 6.
6. **Escape the process-tree check** by daemonizing (narrowed by TM-332, see the section below; the fully scrubbed case remains): the holder's descendant test judges the kernel's parent chain, and a reparented process is no longer a descendant, so it is treated as outside every agent tree (the "operator" side). This is the largest gap. By reading `serve` in `holderMain` (not run), it lets a reparented process ask the admin holder for the host seed. Not fixed here.
7. **Publish to ORCH_EVENTS about itself.** The tamper journal is a local file, not an event on the bus.

## Running agent panes under the provider sandbox (TM-282): what is feasible

`src/provider-sandbox.mjs` already builds a `bwrap` command (`/usr/bin/bwrap`, *read*): `--unshare-all --die-with-parent --new-session`, a tmpfs root, `--proc /proc` (a **new pid namespace**, so siblings and the holder are invisible), `--tmpfs /tmp /run`, read-only system mounts, the workspace bind-mounted, `--clearenv`, and slirp4netns for networking. Applied to a pane:

- **NATS home unmounted.** Nothing under `~/.bytedesk/agent-orchestration/nats` is mounted, so `nats-server.conf`, `agent-users.json`, `state.json`, `roots.json` and `admin.sock` do not exist for the agent. The agent holder socket would be bind-mounted in (one file) so the pane can still fetch its own seed.
- **Pid namespace** removes `/proc` reads of sibling holders, the server, and the daemonizing escape (6): a reparented process stays inside the namespace and cannot signal the server.
- **Feasible now (read, not run):** the sandbox builder, the mounts and the env scrub exist and are used for ACP providers.
- **Not feasible now:** (a) panes are tmux-hosted `claude`, `codex` and similar CLIs, launched by `launch.mjs`, not by the broker; no code runs them under `bwrap`. (b) `--unshare-all` includes the network namespace: the NATS server listens on `127.0.0.1`, which the sandbox does not reach; it needs the slirp4netns host-loopback route (or `pasta`) enabled and the server bound so the sandbox can reach it. NATS has no unix-socket listener. (c) Providers keep state in `$HOME` that the sandbox replaces with a broker-owned home, which changes login and plugin behaviour. (d) The holder's peer check uses `ss` and `/proc` fd tables; a pane in another pid namespace is not a descendant by pid, so the peer check must compare the namespace or move to a per-pane socket path. (e) macOS has no bwrap (TM-282 is the Seatbelt work).
- **A separate uid** (a dedicated `ao-agents` user running panes, NATS home owned by the operator at 0700) is the other complete fix and is simpler for the filesystem and signals, but needs root to set up and a launcher that can `su` into it.

## Follow-ups to file

1. Close the daemonize gap (6): bind each holder to the pane's session id and process-group, or to a pid namespace, and refuse a peer that is not in the pane's cgroup/session. Until then, treat that gap as open.
2. Run panes under `bwrap` with the NATS home unmounted and a pid namespace (needs the loopback route in (b) and the peer-check change in (d)); prove with a test that `ls <nats home>` fails inside.
3. Keep the admin holder alive: let the service manager supervise it, and have the repository supervisor `check` it each tick, so killing it is a detected event instead of a silent one.
4. Publish `nats.tamper` to `ORCH_EVENTS` (admin identity) so the lead and other machines see it, not only the local doctor.
5. Optional `ptrace_scope`/`PR_SET_DUMPABLE` hardening: node cannot call `prctl`; a small native launcher (or `systemd-run -p ...`) would. Requires a native helper, which this plugin does not ship.
6. Keep the registry's expected content in the admin holder too (announce it with the config) so a registry edit is detected the same way.

## TM-332 mitigation (daemonizing out of a pane)

Status: gap 6 above is **narrowed, not closed**. Verified by `tests/unit/agent-creds-escape.test.mjs` (real processes, real admin holder).

The holder used to call a peer "operator" when it was not a descendant of any registered pane root. Now a peer is the operator only if **no lineage marker** catches it and a **positive proof** holds (`topology/lib/peer-process.mjs`, `lineageReason`, `operatorProof`):

| Marker or proof | Catches | Avoids false positives by |
|---|---|---|
| descendant | child tree of a pane root (the original check) | n/a |
| environment | `AO_AGENT_ID` or `AO_CREDS_SOCK` in `/proc/<pid>/environ`; a daemonized child keeps it unless it scrubs it | operators do not carry them |
| session | same Linux session as a root that is its own session leader (a tmux pane process is) | a root that merely sits in a human's session is ignored, or the operator would be flagged |
| process group | same process group as a root that leads its group | same guard |
| exe (positive) | peer executable is not the node binary (`/proc/<pid>/exe`, not forgeable argv) | the operator CLI, MCP server and supervisor all run under node |

Evaluated and rejected: tty (equal `tty_nr` implies the same session, so it adds nothing), cwd under the agent directory (the operator legitimately works there), start time after the root (every later process qualifies). Unreadable `environ` or `stat` fails closed.

**Stopped (tests):** a naive double fork keeping its environment; scrubbed environment in the same session or process group; `setsid` with the environment kept; a non-node executable (python3) after scrubbing and `setsid`. Before the change all five received the admin seed (printed in the test). The operator CLI still works from a separate shell and from a human tmux pane that is not an agent's. Each marker has a mutation in which its escape succeeds.

**NOT stopped (asserted in a test so a change shows up):** a process that scrubs its environment, starts a new session (`setsid`), and runs the node binary. Nothing in the kernel ties it to the pane any more, and a hostile same-uid process can also read `/proc/<pid>/mem`, kill holders, or edit `roots.json`. `/proc/<pid>/environ` shows the initial environment only. macOS has descendant-only (no `/proc`).

Real isolation still needs a separate uid or the provider sandbox with a pid namespace (TM-333). This mitigation makes the lazy and naive escapes fail and the deliberate one cost more; it does not make same-uid agents trustworthy.

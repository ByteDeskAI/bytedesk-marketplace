// Suite-level tmux guard (TM-281), loaded with `node --import` before any test. Library code that
// is not handed a server or an env — hasSession, ControlClient, waitForChannel — resolves tmux from
// process.env, so a suite started inside the operator's tmux, or with TMUX_TMPDIR unset, would talk
// to the operator's server. This makes the process unable to do that:
//   - remember the operator's socket (from $TMUX) so the helper can refuse it in every child;
//   - blank TMUX;
//   - give the run a private TMUX_TMPDIR unless one that is not /tmp was already chosen;
//   - fail loudly if a bare `tmux` would still resolve to an operator socket.
// node --test passes --import to every test-file process, and children inherit the env set here.
import { mkdtempSync, realpathSync, rmSync } from "node:fs";

import { implicitSocket, refuseOperatorSocket } from "./isolated-tmux.mjs";
import "./provider-guard.mjs"; // TM-290: no test may start a real provider CLI
import "./suite-leaks.mjs"; // TM-298: no test may leave a tmux server or process running

// TM-272/TM-298: the managed services are the product default, and a `launch` that reaches them
// registers the test repository with process-compose, which re-runs `supervise` with a scrubbed
// environment: no TMUX_TMPDIR (so the operator's default server) and no shim PATH (so a real
// provider lead). Forced, not defaulted: an operator shell exporting it must not re-open that path.
// A test that drives the services passes its own value in its child's env.
process.env.AGENT_ORCHESTRATION_SERVICES = "0";
// TM-310: a credential holder outlives its pane by this long so a respawn can re-attach; a test run must not wait 20s for the suite-end leak check.
process.env.AO_CREDS_GRACE_MS = process.env.AO_CREDS_GRACE_MS || "500";

const live = /^(.*),[0-9]+,[^,]*$/.exec(process.env.TMUX ?? "")?.[1];
if (live && !process.env.AO_TEST_OPERATOR_TMUX_SOCKET) process.env.AO_TEST_OPERATOR_TMUX_SOCKET = live;
process.env.TMUX = "";
process.env.TMUX_PANE = "";

const real = (path) => { try { return realpathSync(path); } catch { return path; } };
if (!process.env.TMUX_TMPDIR || real(process.env.TMUX_TMPDIR) === real("/tmp")) {
  const dir = mkdtempSync("/tmp/aot-run-");
  process.env.TMUX_TMPDIR = dir;
  // ponytail: the process that made it removes it; a SIGKILLed run leaves one empty dir in /tmp.
  process.on("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });
}

refuseOperatorSocket(implicitSocket(process.env));

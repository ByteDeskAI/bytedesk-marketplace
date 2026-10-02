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

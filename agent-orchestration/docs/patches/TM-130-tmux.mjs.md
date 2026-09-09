# TM-130 — patch for `topology/lib/tmux.mjs` (fix in passing, optional)

Integrator-owned, and **not required by TM-130's acceptance criteria** — I found both while reading
the file to build `delivery.mjs` on top of it. Take them or leave them; they are unrelated to each
other only in that they are the same one-line omission twice.

Every other call in this file routes through `tmux()`, which prepends `-L <name>` or `-S <path>`
from `options.tmuxServer`. These two `spawn()` calls bypass it.

## 1. `ControlClient.start` attaches to the wrong tmux server on a non-default socket

**Context — `topology/lib/tmux.mjs:~330`:**

```js
        this.child = spawn(TMUX, ["-C", "attach", "-t", `=${this.session}`, "-f", "read-only,ignore-size"], {
          stdio: ["pipe", "pipe", "pipe"],
        });
```

On a run started with `--server <socket>` the session lives on that server, this attaches to the
default one, finds no such session, and `start()` resolves **false**. Everything then falls back to
polling — correctly, quietly, and for the wrong reason. Nothing says the subscription path was
silently disabled for the whole run.

**Change:** give the class the server the run is on and prefix the argv the same way `tmux()` does:

```js
  constructor(session, { tmuxServer = null } = {}) {
    super();
    this.session = session;
    this.tmuxServer = tmuxServer;
    ...
  }
  ...
      const prefix = this.tmuxServer ? [isAbsolute(this.tmuxServer) ? "-S" : "-L", this.tmuxServer] : [];
      this.child = spawn(TMUX, [...prefix, "-C", "attach", "-t", `=${this.session}`, "-f", "read-only,ignore-size"], {
        stdio: ["pipe", "pipe", "pipe"],
      });
```

`delivery.mjs`'s `acquireClient(session, { ControlClientClass })` takes the class as a parameter, so
threading a server through is one extra option there and no change to the state machine.

## 2. `waitForChannel` waits on the default server

**Context — `topology/lib/tmux.mjs:~205`:**

```js
    const child = spawn(TMUX, ["wait-for", channel], { stdio: "ignore", shell: false });
```

Same omission. It currently agrees with `clearAndWaitForShell`, which signals with a bare
`shellQuote(TMUX) wait-for -S <channel>` typed into the pane — so both use the default server and
they do match each other. The cost is that a run on a private socket makes an unrelated default
tmux server (starting one if none exists) just to pass a barrier, and any future caller that
signals through `signalChannel()` with a `tmuxServer` will deadlock against it.

**Change:** accept and apply the same prefix, and pass it from `clearAndWaitForShell` into both the
waiter and the shell command it types.

**I have not tested either of these.** Both are read from the source; a fix should come with a run
on `-L` proving it, which is out of TM-130's scope.

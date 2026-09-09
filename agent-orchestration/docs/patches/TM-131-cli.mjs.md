# TM-131 — patch for `topology/cli.mjs` (integrator-owned)

Add `census` as a **new repo-scoped noun**.

Rejected alternatives, so nobody re-opens them: `agents --live` collides with the existing
`agent list`; `session list` already means role-sessions; a `--live` flag on `status` is run-scoped
while the census is repo-scoped.

## 1. USAGE — under "Standing repository services", directly after `supervise`

```diff
 Standing repository services
   supervise [--once --server <socket>]          reconcile presence, prompts and held mail
+  census [--json] [--watch]                     what every agent in this repo is doing right now:
+                                                working / needs-input / idle / attention /
+                                                quota-blocked / dead / unknown
   lead status|ensure|assign <agent>|detach|probes|ack <nonce>
```

## 2. The command

Goes in the `commands` object beside `supervise` and `presence`. Two consumers, one document: a
person gets a line per agent, a scheduler gets `--json` and reads `binding` plus the derived
`dispatchable`.

```js
  async census({ flags }) {
    const ctx = context(flags);
    const { readCensus, takeCensus, formatCensus } = await import('./lib/census.mjs');
    // The ladder belongs to the loop owner, so --watch borrows the SUPERVISOR's, rather than
    // census.mjs keeping a second copy of the same three numbers.
    const { nextRung, SLEEP_LADDER_MS } = await import('./lib/supervision.mjs');
    const { canonicalRepoId } = await import('./lib/repoid.mjs');
    const { collectPresenceAgents } = await import('./lib/presence.mjs');
    const { loadAdapters } = await import('./lib/providers.mjs');
    const identity = await canonicalRepoId(ctx.consumer);
    // `census` is a repo-scoped verb, so it self-starts the supervisor like every other one:
    // asking what the agents are doing is exactly the moment you want the tick back after a
    // reboot. `ensureSupervision` (already in this file as of 89b5531) is idempotent — a live pid
    // short-circuits in microseconds — and never fatal, which is the right trade here: a census
    // with no supervisor is a one-shot answer, not a failed command.
    const supervision = await ensureSupervision(ctx);
    const memo = new Map();
    const observe = async (previous) => {
      // Prefer the supervisor's document: ONE answer to "is this agent alive" per repo. Only when
      // it is missing or stale does the CLI take its own — a stale document is not a cheap read,
      // it is a wrong one.
      const published = await readCensus({ ...ctx, identity });
      if (published && !published.stale) return published;
      let panes = [];
      const listPanesFn = async (args) => { const rows = await (await import('./lib/tmux.mjs')).listServerPanes(args); panes.push(...rows); return rows; };
      let agents = [];
      try { agents = await collectPresenceAgents({ ...ctx, identity, tmuxServer: flags.server, listPanesFn }); }
      catch (error) { if (error?.code !== 'TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error; panes = null; }
      const adapters = await loadAdapters(ctx.providerDirs).catch(() => null);
      // A one-shot has no loop behind it, so it takes census.mjs's own conservative fallbacks
      // (15 s / 45 s) rather than inventing a cadence it is not running at.
      return takeCensus({ ...ctx, identity }, { agents, panes, adapters, memo, previous });
    };
    if (!flags.watch) {
      const document = await observe(null);
      return out(flags.json ? { ...document, supervision } : formatCensus(document));
    }
    // --watch rides the supervisor's own 2/5/15 ladder: 2 s while anything is moving, 15 s while
    // nothing is. A watcher that polls at a fixed 1 s is the busy loop this phase removed.
    let previous = null, rung = -1;
    for (;;) {
      previous = await observe(previous);
      out(flags.json ? previous : formatCensus(previous));
      rung = nextRung(rung, previous.activity);
      await new Promise((resolve) => setTimeout(resolve, SLEEP_LADDER_MS[rung]));
    }
  },
```

## Notes for the integrator

- `--json` prints the census document verbatim. The scheduler contract is exactly two fields per
  agent: `binding`, and the derived `dispatchable` (`idle` **and** not stale **and** no undelivered
  messages **and** the binding matches the live incarnation). Do not let a caller re-derive dispatch
  from `state`, or scheduler and supervisor drift on what "idle" means.
- `readCensus` applies staleness on read and rewrites every stale row to `unknown` with
  `dispatchable: false`, so a stale document cannot be acted on even by a caller that forgets to
  check `stale`.
- The non-watch path takes at most one `list-panes -a` and at most `AO_CENSUS_CAPTURE_BUDGET`
  (default 8) `capture-pane -S -20` calls, and only when the supervisor has published nothing fresh.

## Rebase note — checked against `main` at `89b5531`

Nothing in this patch assumed the pre-TM-134 CLI.

- **The `role` verb (`7191cc4`) does not collide.** `census` is a new key in the `commands` object
  and a new USAGE line; it shares no flag, no positional and no state with `role`.
- **The USAGE anchor still exists verbatim.** I insert directly after
  `supervise [--once --server <socket>]`, which is still the first line of the "Standing repository
  services" block; `role` was added lower, after `reviewer`.
- **`ensureSupervision` (`89b5531`) is now used rather than reinvented.** The earlier revision of
  this patch carried a commented-out `startRepositorySupervision` call with a note to wire it up.
  That is exactly what `ensureSupervision(ctx)` already does — try, return `{started:false,error}`
  on failure, never throw — so `census` calls it like `role assign`, `launch` and `send` do. No new
  helper.

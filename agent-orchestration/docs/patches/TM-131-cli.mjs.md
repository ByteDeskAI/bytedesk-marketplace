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
    const { readCensus, takeCensus, formatCensus, nextIntervalMs, CENSUS_INTERVALS } = await import('./lib/census.mjs');
    const { canonicalRepoId } = await import('./lib/repoid.mjs');
    const { collectPresenceAgents } = await import('./lib/presence.mjs');
    const { loadAdapters } = await import('./lib/providers.mjs');
    const identity = await canonicalRepoId(ctx.consumer);
    // Phase 0.5: every repo-scoped verb self-starts the supervisor, so asking for a census is one
    // of the things that brings the tick back after a reboot. Idempotent — a kill(pid,0) and a
    // spawn only when dead. Uncomment once startRepositorySupervision is wired for `census`.
    // await startRepositorySupervision({ ...ctx, tmuxServer: flags.server });
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
      return takeCensus({ ...ctx, identity }, { agents, panes, adapters, memo, previous });
    };
    if (!flags.watch) {
      const document = await observe(null);
      return out(flags.json ? document : formatCensus(document));
    }
    // --watch rides the same 2/5/15 ladder as the supervisor: 2 s while anything is moving, 15 s
    // while nothing is. A watcher that polls at a fixed 1 s is the busy loop this phase removed.
    let previous = null, interval = CENSUS_INTERVALS[0];
    for (;;) {
      previous = await observe(previous);
      out(flags.json ? previous : formatCensus(previous));
      interval = nextIntervalMs(interval, previous.activity);
      await new Promise((resolve) => setTimeout(resolve, interval));
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

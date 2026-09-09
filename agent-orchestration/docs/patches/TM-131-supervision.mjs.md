# TM-131 — patch for `topology/lib/supervision.mjs` (integrator-owned)

Fold the liveness census into the existing `superviseRepository` tick. **Written against
`tm127-lander`'s Phase 0.5 shape**, not against the file as it stands at `f3f21e7`: that worker is
concurrently making the sleep adaptive (2 s / 5 s / 15 s driven by an `activity` boolean the tick
returns) and rate-limiting the expensive reconcile body behind `AO_RECONCILE_MIN_MS`. The two
compose — the census *is* the cheap work that runs every tick, and it is what produces `activity`.
Where the two disagree, the lander's shape wins and only the marked lines below move.

Why here and not in a second daemon: this loop already holds the per-repo
`supervision/<repoKey>.lock`, already takes exactly one `list-panes -a` per server through
`collectPresenceAgents`, and already writes a durable report. A second daemon means a second lock, a
second listing, and two answers to "is this agent alive" — which is how a scheduler ends up
dispatching into a busy pane.

## 1. Imports

```diff
 import { createPresenceProducer, collectPresenceAgents } from './presence.mjs';
+import { takeCensus, nextIntervalMs, CENSUS_INTERVALS } from './census.mjs';
+import { loadAdapters, providerDirs } from './providers.mjs';
 import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
+import { listServerPanes } from './tmux.mjs';
```

## 2. Before the loop — load adapters once, and keep the census's memory

Adapters are read from disk; loading them per tick would put a `readdir` back into the hot path that
this phase is removing. The memo is the capture cache, keyed by `(paneId, panePid)`.

```diff
   const producer=await createPresenceProducer(options);
   const controller = new AbortController();
   signal?.addEventListener('abort', () => controller.abort(), {once:true});
+  // Loaded once: adapters are files, and the census only needs them for their attention patterns.
+  const adapters=await loadAdapters(options.providerDirs ?? providerDirs(options)).catch(()=>null);
+  const censusMemo=new Map();
+  let censusInterval=CENSUS_INTERVALS[0], census=null;
   let latest, heartbeatError;
```

## 3. Inside the tick — reuse the one listing instead of taking a second

`collectPresenceAgents` accepts an injectable `listPanesFn`, so wrapping it captures the rows it
already fetched. **No extra tmux call.** The rows carry `title` once the `tmux.mjs` patch lands
(`docs/patches/TM-131-tmux.mjs.md`); without it every pane is simply title-inconclusive and the
census falls back to capture, so the two patches are independent and land in either order.

`panes` is `null` — not `[]` — when the listing threw. That distinction is the whole contract: a
failed listing makes every agent `unknown`, an empty one makes them all `dead`.

```diff
    try { do {
-     const observed=await collectPresenceAgents(options);
+     let panes=[];
+     const listPanesFn=async args=>{const rows=await listServerPanes(args);panes.push(...rows);return rows;};
+     let observed;
+     try { observed=await collectPresenceAgents({...options,listPanesFn}); }
+     catch(error){ if(error?.code!=='TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error; observed=[]; panes=null; }
      const panesAlive=observed.filter(p=>p.lifecycle!=="dead").map(p=>({...p.session,alive:true}));
```

(the existing local named `panes` is renamed `panesAlive` at its three use sites in the run-agent
binding check — it is a different thing from the raw listing and the collision would be silent.)

## 4. Inside the worktree walk — collect the run dirs the census needs for `deaths.tsv`

One line, in the loop that already computes `runDir`:

```diff
         const runDir=join(runsRoot,name), runRecord=await readJson(join(runDir,'run.json')).catch(()=>null);
+        censusRunDirs.push(runDir);
         if(!runRecord || (await canonicalRepoId(runRecord.consumer || checkout)).id!==identity.id) continue;
```

with `const censusRunDirs=[];` declared beside `const prompts=[];` at the top of the tick.

## 5. After the report is assembled — take the census, publish it, drive the cadence

```diff
     const report={pid:process.pid,at:new Date().toISOString(),repo_id:identity.id,generation:snapshot.generation,revision:snapshot.revision,
       prompts:prompts.map(p=>({agent:p.agent,status:p.state.status,errors:p.state.errors})),
       mail:resumed.map(m=>({id:m.envelope.id,status:m.status,reason:m.reason}))};
+    // The census is the CHEAP work: one already-taken listing, a title check per pane, and at most
+    // AO_CENSUS_CAPTURE_BUDGET captures. It runs every tick, ahead of and independent of the
+    // AO_RECONCILE_MIN_MS gate on the expensive body above, because it is what decides how long to
+    // sleep. A quiet repo therefore publishes PRESENCE more often (10 s, the frozen contract) than
+    // it takes a CENSUS (up to 15 s) — that is correct, not a bug: presence staleness is a
+    // contract with the gateway, census staleness is a hint to a scheduler.
+    census=await takeCensus({...options,identity},{agents:observed,panes,adapters,memo:censusMemo,previous:census,runDirs:censusRunDirs});
+    report.census={at:census.at,tick_ms:census.tickMs,captures:census.captures,
+      states:census.agents.reduce((totals,a)=>({...totals,[a.state]:(totals[a.state]??0)+1}),{}),
+      dispatchable:census.agents.filter(a=>a.dispatchable).length};
     await writeJson(join(root,`${key}.json`),report); await onTick(report);
     if(once || signal?.aborted) return report;
-    await sleep(intervalMs);
+    censusInterval=nextIntervalMs(censusInterval,census.activity||<lander's own activity signal>);
+    await sleep(intervalMs ?? censusInterval);
   }while(!signal?.aborted && !controller.signal.aborted);
```

The last two lines are the only real collision point with `tm127-lander`. Its adaptive sleep already
computes an interval from an `activity` boolean; **OR the census's `activity` into that boolean and
delete my `censusInterval` entirely** rather than running two backoffs. `nextIntervalMs` is exported
from `census.mjs` for whichever of the two ends up owning the walk, and its ladder is the same
2000 → 5000 → 15000 with a snap-back on activity that the lander's brief specifies. An explicit
`intervalMs` passed by a caller (the tests do this) must keep winning over the adaptive value.

`census.activity` is true when any agent changed state this tick or a `needs-input` edge fired — so
the loop tightens to 2 s the moment anything moves and relaxes to 15 s while a repo sits quiet.

## 6. `doctor`

The plan's Phase 0.5 already adds "is a supervisor alive, and how old is its last tick". The census
gets that for free through `report.census.at`; nothing extra is needed here.

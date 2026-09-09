# TM-131 — patch for `topology/lib/supervision.mjs` (integrator-owned)

**Rewritten against the merged file at `main` (`d79db04` / `ebc92e3`), not against `f3f21e7`.**
The version in my worktree is stale; every hunk below quotes the merged shape — `reconcile()` as a
named closure, `nextRung`, `reconcileFloor`, the cheap-tick branch, `sleepFn`.

## Where the census belongs: L3, every tick — including the cheap ones

The merged header already names the slot, and the cheap branch already says so out loud:

> *"A cheap tick costs a timestamp. It exists so the observation work that belongs at this cadence
> has somewhere to live without dragging L2's git-and-filesystem body with it."*

That is this. Putting the census inside `reconcile()` would peg it to `AO_RECONCILE_MIN_MS`
(10 s floor) and throw away the whole 2 s rung, so **the census runs on every tick** and is what
makes the fast rung mean something.

It needs two different things at two different cadences, which is why this is not one call:

| Needs | Cadence | Where it comes from |
|---|---|---|
| The **roster** — which agents exist and their six-tuple bindings | L2 | cached from the last `reconcile()`; bindings do not change without a launch, and one that has gone stale surfaces as `dead` (its pane row is absent), which is the correct answer |
| The **panes** — one `list-panes -a` | L3 | reused from `reconcile()` on a reconciling tick, taken directly on a cheap tick |

A cheap tick therefore costs **one tmux call plus at most `AO_CENSUS_CAPTURE_BUDGET` (8)
`capture-pane -S -20` calls** — no git, no `readdir`, no `refreshPrompt`. Most panes cost zero
captures, because the pane title decides them (see `docs/patches/TM-131-tmux.mjs.md`).

## 1. Imports

```diff
 import { createPresenceProducer, collectPresenceAgents } from './presence.mjs';
+import { takeCensus } from './census.mjs';
+import { loadAdapters, providerDirs } from './providers.mjs';
 import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
+import { listServerPanes } from './tmux.mjs';
```

## 2. Before the loop — load adapters once, and hold the census's memory

```diff
   const producer=await createPresenceProducer(options);
   const controller = new AbortController();
   signal?.addEventListener('abort', () => controller.abort(), {once:true});
+  // Adapters are files on disk; loading them per tick would put a readdir straight back into the
+  // hot path this phase just took out. The census wants them only for their attention patterns.
+  const adapters=await loadAdapters(options.providerDirs ?? providerDirs(options)).catch(()=>null);
+  // Census memory across ticks: the capture cache, keyed by (paneId, panePid) so a respawn
+  // invalidates; the roster and run dirs from the last reconcile; the last document, which is what
+  // carries the needs-input edge state and lets a vanished agent be reported dead instead of
+  // silently disappearing.
+  const censusMemo=new Map();
+  // censusPanes is THREE-VALUED — see the note at the end of §4. `let censusPanes;` on purpose.
+  let censusRoster=[], censusRunDirs=[], censusPanes, census=null;
   let latest, heartbeatError;
```

## 3. Inside `reconcile()` — reuse the one listing, and remember the roster

`collectPresenceAgents` takes an injectable `listPanesFn`, so wrapping it hands us the rows it
already fetched. **No extra tmux call on a reconciling tick.**

`censusPanes` is `null` — not `[]` — when there is no usable listing. That distinction is the whole
contract: no listing makes every agent `unknown`, an empty listing makes them all `dead`.

```diff
   const reconcile=async()=>{
-    const observed=await collectPresenceAgents(options);
+    // The census reuses the listing this call already takes; wrapping listPanesFn is what makes
+    // that free. A throw from here is deliberately NOT caught — see the comment below.
+    const seen=[];
+    const listPanesFn=async args=>{const rows=await listServerPanes(args);seen.push(...rows);return rows;};
+    const observed=await collectPresenceAgents({...options,listPanesFn});
+    censusRoster=observed; censusPanes=seen;
     const panes=observed.filter(p=>p.lifecycle!=="dead").map(p=>({...p.session,alive:true}));
```

**Careful:** the merged body already has a local called `panes` (the alive-only projection used by
the run-agent binding check). It is a different thing from the raw listing — do not merge the two.
Mine are deliberately named `seen` / `censusPanes` so nothing collides.

**No `catch` here, on purpose — and the comment says so, so nobody adds one back thinking it was an
oversight.** An earlier revision of this patch wrapped `collectPresenceAgents` in a catch for
`TOPOLOGY_TMUX_OBSERVATION_FAILED` so the census could still report `unknown` on a tmux hiccup.
That was rejected: it changes `reconcile()`'s failure semantics — TM-127's, and a different task's
lane — as a side effect of adding an observer. Letting the throw stand is the smaller and more
honest failure. The census simply does not run that tick, the document ages out, and `stale: true`
already rewrites every row to `unknown` and makes nothing dispatchable. A tmux hiccup degrades into
"we do not know", which is precisely what it should mean.

Put this line above the call so the decision survives:

```js
// Deliberately no catch: a failed listing is TM-127's failure to define, and a stale census
// already degrades to `unknown` + nothing dispatchable, which is the honest answer anyway.
```

Then, in the loop that already computes `runDir`, one line — the run dirs are where `deaths.tsv`
lives, and they change at L2's cadence, not L3's:

```diff
+      const runDirs=[];
       for(const checkout of roots) {
         const runsRoot=join(checkout,'.bytedesk/agent-orchestration/runs');
         for(const name of await readdir(runsRoot).catch(()=>[])) {
           const runDir=join(runsRoot,name), runRecord=await readJson(join(runDir,'run.json')).catch(()=>null);
+          runDirs.push(runDir);
           if(!runRecord || (await canonicalRepoId(runRecord.consumer || checkout)).id!==identity.id) continue;
```

…and `censusRunDirs=runDirs;` beside `censusRoster=observed;`, or at the end of `reconcile()`.

## 4. In the tick — run the census on BOTH branches, then let it drive the rung

This is the only structural hunk. It sits between the reconcile-or-not branch and `nextRung`.

```diff
       let activity=false;
       if(once || Date.now()-lastReconcileAt>=floorMs) {
         lastReconcileAt=Date.now();
         ({report,activity}=await reconcile());
       } else {
         report={...report,at:new Date().toISOString(),reconciled:false,activity:false};
       }
+      // L3. Every tick, cheap or not. On a reconciling tick `censusPanes` is the listing that just
+      // happened; on a cheap tick we take our own — one tmux call, against exactly the servers the
+      // roster's own bindings name, which is the same set presence queried.
+      //
+      // This one IS caught, unlike the one in reconcile(): that listing belongs to presence and its
+      // failure is TM-127's to define, while this listing exists only for the census, so the census
+      // may absorb its own failure and report `unknown` rather than take the loop down with it.
+      if(censusPanes===undefined) {
+        const servers=[...new Set(censusRoster.map(a=>a.session?.serverKey).filter(Boolean))];
+        try { censusPanes=(await Promise.all((servers.length?servers:[options.tmuxServer]).map(s=>listServerPanes({tmuxServer:s,env})))).flat(); }
+        catch(error){ if(error?.code!=='TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error; censusPanes=null; }
+      }
+      // The loop owns the cadence and TELLS the census: how often it is being called, and how long
+      // its answer should be believed. Staleness comes off the SLOWEST rung, not the current one —
+      // a document must not read stale merely because the loop backed off.
+      census=await takeCensus({...options,identity},{agents:censusRoster,panes:censusPanes,adapters,
+        memo:censusMemo,previous:census,runDirs:censusRunDirs,
+        intervalMs:intervalMs ?? SLEEP_LADDER_MS[Math.max(rung,0)],
+        staleAfterMs:3*SLEEP_LADDER_MS[SLEEP_LADDER_MS.length-1]});
+      censusPanes=undefined;   // consumed; the next tick takes or reuses its own
+      report={...report,census:{at:census.at,tick_ms:census.tickMs,captures:census.captures,
+        states:census.agents.reduce((totals,a)=>({...totals,[a.state]:(totals[a.state]??0)+1}),{}),
+        dispatchable:census.agents.filter(a=>a.dispatchable).length}};
-      rung=nextRung(rung,activity);
+      rung=nextRung(rung,activity||census.activity);
```

**The one thing to get right when applying this by hand:** `censusPanes` is a **three-valued**
variable and each value means something different — `undefined` = not taken yet this tick,
`null` = the listing was attempted and failed, an array = the listing succeeded (an empty array is
a real answer: every agent is dead). Declare it as `let censusPanes;` in §2, not `= null`, and
reset it to `undefined` after each census. Collapsing `undefined` and `null` here makes a failed
listing look like "we have not looked yet", and the tick then reports `dead` for every agent on a
tmux hiccup.

## 5. `census.activity` — how it ORs in without defeating the backoff

You were right to flag this, and it is already handled inside `census.mjs` rather than left to the
call site. `activity` there means the **world moved**, never that we looked:

- a pane that is still `working` is the **steady state** and contributes nothing — the same reason
  a prompt already at `current` does not count in your expression. One busy agent must not hold the
  ladder at 2 s for an hour;
- a transition **into or out of `unknown`** contributes nothing either, because that is almost
  always our own capture budget rationing (`idle → unknown → idle` as the budget rotates across
  more than eight agents), which would pin the ladder just as hard while telling nobody anything;
- what does count: a real transition between two observed states (`working → idle`,
  `idle → attention`, anything `→ dead`), a first sighting of a new agent, and a `needs-input`
  **edge** — the one transition a scheduler is actually waiting for.

So `activity || census.activity` is safe, and it is the shape I intend. Test:
`tests/unit/topology-census.test.mjs` → *"activity means the world moved, so it cannot pin the
supervisor's sleep ladder"*, which asserts `activity === false` across a steady `working` tick and
across the full `idle → unknown → idle` rationing sequence on a never-busy pane.

Net effect on the cadence: a quiet repository still walks 2 → 5 → 15 and stays at 15. A repository
where an agent hands work back snaps to 2 s within one tick, which is the point.

## 6. Presence numbers are read, not re-derived

The merged `createPresenceProducer` returns `publishIntervalMs` and `staleAfterMs`; nothing in this
patch re-derives `staleAfterMs/3`. **The census deliberately does not borrow either number either.**
Its bound is `3 × SLEEP_LADDER_MS[last]` = 45 s, passed in from §4 — the same 3× relationship the
frozen contract §2.2 uses, applied to the cadence the census actually runs at. Presence's 30 s is a
wire promise about a heartbeat this loop does not drive; coupling a hint to a contract would mean a
change to one silently moves the other.

## 7. `supervisionStatus` / `doctor`

Nothing to add: the census rides `report.census` into `supervision/<key>.json`, so
`supervisionStatus`'s existing `last_tick_at` / `tick_age_ms` already cover "is anyone observing",
and `doctor`'s `SUPERVISOR_STALLED` already fires on the same record.

## 8. One ladder, and this file owns it

`census.mjs` no longer exports `CENSUS_INTERVALS` or `nextIntervalMs`. You were right that I had
the constraint backwards: the cycle only forbids `census.mjs` importing `supervision.mjs`, and the
honest shape is that **the loop owner owns the cadence and tells the observer**. So there is no
shared-constants module and no third home for three numbers — `SLEEP_LADDER_MS` and `nextRung` stay
exactly as TM-127 landed them, and the census is passed `intervalMs` and `staleAfterMs` per call
(see §4).

What the census does with them: records `intervalMs` in the document as a hint for whoever reads it,
and uses `staleAfterMs` as the bound `withStaleness` enforces on read. Its own fallbacks — 15 s and
45 s — apply only to a one-shot with no loop behind it, i.e. the CLI's single `census` invocation.
The fallback interval is deliberately the SLOWEST rung rather than the fastest: a caller who says
nothing must not get a document that reads stale six seconds later.

The census does not reason about the ladder anywhere else, so nothing else needs sharing. The AC
"the interval walks 2000 → 5000 → 15000 and snaps back on activity" is now covered where it belongs,
by `nextRung`'s own test in `tests/unit/topology-supervision.test.mjs`; my replacement test asserts
only that the census records what it was told and owns no cadence of its own.

## 9. One thing I am not fixing, but you should know

A throw out of `reconcile()` propagates through the `do…while`, out of `withLock`, and ends
`superviseRepository` — so a tmux enumeration failure does not merely skip a tick, it takes the
supervisor down and leaves the monitor to restart it. That is pre-existing TM-127 behaviour, not
something this patch introduces, and §3 deliberately does not change it. Flagging it because my
"the census just goes stale for a tick" phrasing is optimistic: what actually happens is a restart,
after which the census document ages out and reads `unknown` — the same end state, by a louder
route. If you want that softened, it is a TM-127 follow-up with its own test, not a line in this
patch.

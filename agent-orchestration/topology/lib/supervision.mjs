// One repository service reconciles derived state. It launches exactly one kind of agent — this
// repository's own lead — and only for an ENROLLED repository: it ensures a missing lead and
// restarts a confirmed-dead managed one (lead-recovery.mjs, TM-167). It never kills an agent, never
// restarts or duplicates a live unresponsive lead, and never replaces an externally owned lead.
//
// THREE CADENCES LIVE HERE AND THEY ARE NOT THE SAME NUMBER.
//
//   L1 presence heartbeat — owned by presence.mjs, fixed at staleAfterMs/3 (~10s). The FROZEN
//      Presence v1 contract §2.2 owns it: a consumer reads the absence of a rewrite as staleness,
//      so the rewrite cadence is a wire promise, not a tuning knob. Nothing in this file may
//      throttle it.
//   L2 reconcile — the expensive body below: collectPresenceAgents, `git worktree list`, a readdir
//      of every run dir in every linked worktree, refreshPrompt per enrolled agent, and
//      resumeStandingMessages. Rate-limited to at most once per AO_RECONCILE_MIN_MS (default 10s).
//   L3 the tick — an adaptive 2s/5s/15s sleep, and the two observers that ride it: the liveness
//      census (TM-131) and the quota watch (TM-135). A tick that finds no activity backs off; the
//      next tick that does snaps straight back to 2s.
//      The census is the observation work this cadence exists for: tmux only, reusing L2's listing
//      when one was just taken and taking its own single `list-panes -a` otherwise, plus at most
//      AO_CENSUS_CAPTURE_BUDGET captures. It runs on EVERY tick, including cheap ones — putting it
//      inside L2 would peg it to the 10s reconcile floor and the 2s rung would buy nothing.
//      The quota watch rides the same rung and costs LESS than the census on a quiet repository:
//      it holds one tmux control-mode client per agent session and captures only when the server
//      pushes a failure-trigger hit, so a pane nobody is failing on costs zero tmux calls.
//
// THE QUOTA WATCH DOES NOT BREAK THE "RECONCILES DERIVED STATE ONLY" RULE ABOVE, and it is worth
// saying why, because it is the one observer here that could. (Lead recovery is not an observer: it
// is the deliberate, enrolled-only exception named at the top, and it never touches a live pane.) It writes an incident and announces
// it. It restarts nothing, kills nothing and sends no keys: applying a failover is a separate,
// deliberate `ao-topology failover` invocation that spends `failover.consent`. Detection asks;
// taking a pane over is somebody's decision, never a tick's.
//
// A QUIET REPOSITORY THEREFORE PUBLISHES PRESENCE MORE OFTEN THAN IT RECONCILES. That looks like
// a bug and is not one: presence staleness is a contract a consumer enforces, reconcile staleness
// is a hint nobody is owed. Do not "fix" it by driving L1 off this loop's sleep.
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { createPresenceProducer, collectPresenceAgents } from './presence.mjs';
import { takeCensus } from './census.mjs';
import { loadAdapters, providerDirs } from './providers.mjs';
import { canonicalRepoId, repositoryConsumer, repoKey, stateRoot } from './repoid.mjs';
import { listServerPanes } from './tmux.mjs';
import { lockOwner, processIdentity, withLock } from './lockfile.mjs';
import { listAgents, agentDirs } from './agents.mjs';
import { refreshPrompt } from './prompt-lifecycle.mjs';
import { resumeStandingMessages } from './standing-mailbox.mjs';
import { recoverLead } from './lead-recovery.mjs';
import { notifyGrants, reconcileSlots } from './slots.mjs';
import { createQuotaWatch, quotaTick } from './quota.mjs';
import { exists, sleep, writeJson, readJson, run } from './util.mjs';

/** Adaptive tick sleep. Index 0 is the busy rung; a quiet tick walks one rung down the list. */
export const SLEEP_LADDER_MS = [2000, 5000, 15000];
/** Floor between two runs of the expensive reconcile body. AO_RECONCILE_MIN_MS overrides. */
export const DEFAULT_RECONCILE_MIN_MS = 10_000;
export const DEFAULT_START_TIMEOUT_MS = 10_000;

async function sourceIdentity() {
  const implementation=fileURLToPath(import.meta.url);
  const source_entrypoint=fileURLToPath(new URL('../cli.mjs',import.meta.url));
  const [entrypointBytes,implementationBytes]=await Promise.all([readFile(source_entrypoint),readFile(implementation)]);
  return {source_entrypoint,source_fingerprint:createHash('sha256').update(entrypointBytes).update(implementationBytes).digest('hex')};
}

/**
 * Quiet ticks walk one rung down the ladder; ANY activity snaps straight back to the busy rung.
 * `rung` is the previous rung, or -1 before the first tick.
 *
 * Not to be confused with `delivery.mjs`'s `nextDeliveryRung`, which is a different ladder entirely
 * — the retry rungs for one message's doorbell (`resubmit` / `retype` / `wait-safe` / `escalate`).
 * That one was renamed away from this name for exactly this reason; nothing imports both, so the
 * hazard was always to the reader rather than to the code.
 */
export function nextRung(rung, activity) {
  return activity ? 0 : Math.min(rung + 1, SLEEP_LADDER_MS.length - 1);
}

function reconcileFloor(env, override) {
  const raw = override ?? env.AO_RECONCILE_MIN_MS;
  const value = raw === undefined || raw === null || raw === '' ? DEFAULT_RECONCILE_MIN_MS : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RECONCILE_MIN_MS;
}

export async function superviseRepository(options, { signal, once = false, intervalMs, reconcileMinMs, onTick = () => {}, sleepFn = sleep } = {}) {
 const { env=process.env, home=homedir() }=options;
 const consumer=await repositoryConsumer(options.consumer);
 options={...options,consumer};
 const identity=await canonicalRepoId(consumer), root=join(stateRoot(env,home),'supervision');
 const key=repoKey(identity.id);
 const floorMs=reconcileFloor(env,reconcileMinMs);
 // A losing supervisor should give the lock back to the winner immediately rather than idling in
 // the poll loop: on a machine with eight linked worktrees open, seven lose this race every time a
 // session starts, and their only correct move is to exit.
 return withLock(join(root,`${key}.lock`),async ownership=>{
   const recordPath=join(root,`${key}.process.json`);
   if(!once) {
     const prior=await readJson(recordPath).catch(()=>null);
     const restarts=prior ? (prior.restarts ?? 0)+1 : 0;
     await writeJson(recordPath,{pid:process.pid,process_identity:ownership.process_identity,lock_token:ownership.token,
       repo_id:identity.id,consumer,started_at:new Date().toISOString(),restarts,
       log:prior?.log ?? join(root,`${key}.log`),state:'starting',...await sourceIdentity()});
   }
   const producer=await createPresenceProducer(options);
   const controller = new AbortController();
   signal?.addEventListener('abort', () => controller.abort(), {once:true});
   let latest, heartbeatError, degradedBeats=0;
   // TM-141. L1 publishes by ENUMERATING TMUX, so a failed listing rejects `watch` and ends the
   // heartbeat; that rejection used to end the supervisor with it, and the monitor's restart is
   // what made a flaky tmux read as a crash loop in `doctor`. Not publishing is still the right
   // answer to a failed listing — presence must not state liveness it could not observe, and the
   // document ageing out IS the contract's staleness signal — but it is a ONE-BEAT answer, so the
   // beat resumes on the next interval instead of taking the process down. Every other rejection
   // is a real failure and still fatal.
   const heartbeat = once ? null : (async () => {
     while (!controller.signal.aborted) {
       try { return await producer.watch({signal:controller.signal,onPublish:snapshot=>{latest=snapshot;}}); }
       catch (error) {
         if (error?.code !== 'TOPOLOGY_TMUX_OBSERVATION_FAILED') { heartbeatError=error; controller.abort(); return; }
         degradedBeats++;
         await delay(producer.publishIntervalMs,undefined,{signal:controller.signal}).catch(()=>{});
       }
     }
   })();
   // Adapters are files on disk; loading them per tick would put a readdir straight back into the
   // hot path L2's rate limit just took out. The census wants them only for attention patterns.
   const adapters=await loadAdapters(options.providerDirs ?? providerDirs(options)).catch(()=>null);
   // Census memory across ticks: the capture cache keyed by (paneId, panePid) so a respawn
   // invalidates; the roster and run dirs from the last reconcile; and the last document, which is
   // what carries the needs-input edge state and lets an agent that has left the listing be
   // reported dead for one tick instead of silently vanishing.
   //
   // censusPanes is THREE-VALUED and each value means something different:
   //   undefined -> not taken yet this tick
   //   null      -> a listing was attempted and failed; every agent is `unknown`
   //   array     -> the listing succeeded; an EMPTY array is a real answer, every agent is dead
   // Collapsing the first two would make a tmux hiccup report every agent dead. `let`, not `=null`.
   const censusMemo=new Map();
   let censusRoster=[], censusRunDirs=[], censusPanes, census=null;
   // Which run dir each run agent belongs to. The quota watch needs it for exactly one reason: a
   // failover is a RUN concept — `failoverAgent` restarts an agent from the next candidate in the
   // chain its run record declares — so an incident that cannot name a run dir cannot offer an
   // approval command, and says so instead of printing one that would refuse.
   let censusRunDirByAgent=new Map();
   // The quota watch's cross-tick memory: attached control clients, armed subscriptions, and
   // suspicions waiting for their second look. Closed in the same `finally` as the heartbeat, so a
   // supervisor that exits never leaves tmux clients attached.
   const quotaWatch=createQuotaWatch();
   // The expensive body. Returns the report it wrote plus whether anything actually moved.
   const reconcile=async()=>{
     // The census reuses the listing this call already takes; wrapping listPanesFn is what makes
     // that free. Deliberately NO catch here, and TM-141 did not add one: swallowing
     // TOPOLOGY_TMUX_OBSERVATION_FAILED so the census could still report was considered and
     // rejected, because it would change reconcile()'s failure semantics as a side effect of
     // adding an observer. A stale census already degrades to `unknown` with nothing dispatchable,
     // which is the honest answer to "tmux did not respond". This listing belongs to PRESENCE:
     // its failure abandons the whole reconcile — no prompt refreshed, no mail resumed, no tick
     // record written — where the census's own listing below is absorbed and still yields a
     // document. What TM-141 changed is only how far the abandonment travels: the caller skips
     // the tick rather than ending the supervisor.
     const seen=[];
     const listPanesFn=async args=>{const rows=await listServerPanes(args);seen.push(...rows);return rows;};
     const observed=await collectPresenceAgents({...options,listPanesFn});
     censusRoster=observed; censusPanes=seen;
     const panes=observed.filter(p=>p.lifecycle!=="dead").map(p=>({...p.session,alive:true}));
     const agents=await listAgents(agentDirs(options));
     const prompts=[];
     for(const agent of agents){
       const standing=observed.find(p=>p.agentId===agent.id && p.lifecycle!=="dead" && p.enrollment==="enrolled" && p.primaryRunId===null);
       if(!standing) continue;
       // Prompt currency is proof about one exact process, not merely an agent id. Passing no
       // binding here would conservatively invalidate every applied prompt on every reconcile.
       prompts.push({agent:agent.id,state:await refreshPrompt({...options,agent,live:true,
         session:standing.session?.sessionName??null,binding:standing.session??null})});
     }
     const listing=await run('git',['-C',consumer,'worktree','list','--porcelain'],{allowFailure:true});
     const roots=new Set([consumer,...listing.stdout.split('\n').filter(line=>line.startsWith('worktree ')).map(line=>line.slice(9))]);
     // Where deaths.tsv lives. Collected at L2's cadence because that is how often it can change.
     const runDirs=[], runDirByAgent=new Map();
     for(const checkout of roots) {
       const runsRoot=join(checkout,'.bytedesk/agent-orchestration/runs');
       for(const name of await readdir(runsRoot).catch(()=>[])) {
         const runDir=join(runsRoot,name), runRecord=await readJson(join(runDir,'run.json')).catch(()=>null);
         runDirs.push(runDir);
         if(!runRecord || (await canonicalRepoId(runRecord.consumer || checkout)).id!==identity.id) continue;
         for(const entry of runRecord.agents || []) {
           runDirByAgent.set(entry.id,runDir);
           if(!entry.binding || !panes.some(p=>p.alive && ['serverKey','serverPid','sessionId','sessionCreated','paneId','panePid'].every(k=>p[k]===entry.binding[k]))) continue;
           const dir=join(runDir,'agents',entry.id), definition=await readJson(join(dir,'prompt-agent.json')).catch(()=>null);
           if(!definition) continue;
           prompts.push({agent:entry.id,run:runRecord.run_id,state:await refreshPrompt({...options,
             consumer:runRecord.consumer || checkout,agent:{...definition,_dir:dir},live:true,
             session:runRecord.session??null,binding:entry.binding??null})});
         }
       }
     }
     censusRunDirs=runDirs; censusRunDirByAgent=runDirByAgent;
     if(heartbeatError) throw heartbeatError;
     const snapshot=latest || await producer.publish();
     // TM-167: the receiver-owned lead. Before held mail is resumed, this repository's own supervisor
     // ensures a missing lead or restarts a confirmed-dead managed one, so the mail it was holding can
     // land in this same reconcile. Absorbed the way slots and quota absorb theirs: a lead that cannot
     // be recovered is reported with its backoff, never a reason to stop supervising.
     const recovery=await recoverLead(options).catch(error=>({action:'failed',attempts:null,last_error:error?.code ?? String(error),next_retry_at:null}));
     const resumed=await resumeStandingMessages(options);
     const launched=['created','restarted'].includes(recovery.action);
     // Activity means something MOVED, not merely that agents exist: a prompt that is already
     // `current` is a steady state and must not pin the ladder to its busy rung forever.
     const activity=prompts.some(p=>p.state?.status && p.state.status!=='current') || resumed.length>0 || launched;
     const report={pid:process.pid,at:new Date().toISOString(),repo_id:identity.id,generation:snapshot.generation,revision:snapshot.revision,
       reconciled:true,reconcile_min_ms:floorMs,activity,
       prompts:prompts.map(p=>({agent:p.agent,status:p.state.status,errors:p.state.errors})),
       mail:resumed.map(m=>({id:m.envelope.id,status:m.status,reason:m.reason})),
       // Only when there is something to say, like slots and quota: a healthy lead adds no key.
       ...(launched || recovery.alert || recovery.woken || recovery.attempts!==0 ? {lead_recovery:recovery} : {})};
     await writeJson(join(root,`${key}.json`),report);
     if(!once) await promoteRecord(join(root,`${key}.process.json`));
     return {report,activity};
   };
   try {
     // rung -1 is "no quiet tick yet", so the first sleep is the busy rung and the ladder is walked
     // only by ticks that actually found nothing to do.
     let lastReconcileAt=-Infinity, rung=-1, report=null;
     do {
       if(heartbeatError) throw heartbeatError;
       // A consumer can be removed out from under a live daemon — `tm` removes a task-owned
       // worktree after a verified merge. There is then nothing left to supervise, and a supervisor
       // that keeps ticking against a deleted directory is an immortal process nobody will ever
       // think to look for. Before TM-139 this case "solved itself" by crashing on uv_cwd; now that
       // it no longer crashes, it has to retire deliberately, and say so in its record.
       if(!(await exists(consumer))) {
         if(!once) await retireRecord(join(root,`${key}.process.json`));
         report={...report,at:new Date().toISOString(),reconciled:false,stopped:'consumer-gone'};
         await onTick(report);
         return report;
       }
       let activity=false;
       // `once` always reconciles: a single-shot supervise is asking for the expensive answer.
       //
       // TM-141: exactly ONE failure is transient — tmux could not be enumerated — and it skips
       // this tick instead of ending superviseRepository. `restarts` is what `doctor` reads to
       // identify a crash loop, so a tmux hiccup must never increment it; a supervisor that is up
       // and not reconciling shows as SUPERVISOR_STALLED (the tick record is deliberately NOT
       // rewritten on a degraded tick, so `tick_age_ms` keeps growing) which is the honest answer.
       // Every other throw is still fatal. `once` still throws: a one-shot has no next tick to
       // degrade into, so the failure is its answer.
       if(once || Date.now()-lastReconcileAt>=floorMs) {
         lastReconcileAt=Date.now();
         try { ({report,activity}=await reconcile()); }
         catch(error) {
           if(once || error?.code!=='TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error;
           report={...report,at:new Date().toISOString(),reconciled:false,degraded:'tmux-observation-failed'};
         }
       } else {
         // A cheap tick costs a timestamp. It exists so the observation work that belongs at this
         // cadence has somewhere to live without dragging L2's git-and-filesystem body with it.
         report={...report,at:new Date().toISOString(),reconciled:false,activity:false};
       }
       // L3, every tick. On a reconciling tick censusPanes is the listing that just happened; on a
       // cheap tick we take our own — one tmux call, against exactly the servers the roster's own
       // bindings name, which is the same set presence queried.
       //
       // THIS listing is caught where reconcile()'s is not, and the asymmetry is deliberate and
       // survives TM-141: that one belongs to presence and its failure is presence's to define, so
       // it abandons the reconcile whole, while this one exists only for the census, so the census
       // absorbs its own failure and still reports — every agent `unknown`, nothing dispatchable.
       if(censusPanes===undefined) {
         const servers=[...new Set(censusRoster.map(a=>a.session?.serverKey).filter(Boolean))];
         try { censusPanes=(await Promise.all((servers.length?servers:[options.tmuxServer].filter(Boolean)).map(server=>listServerPanes({tmuxServer:server,env})))).flat(); }
         catch(error){ if(error?.code!=='TOPOLOGY_TMUX_OBSERVATION_FAILED') throw error; censusPanes=null; }
       }
       // The loop owns the cadence, so the loop TELLS the census: how often it is being called, and
       // how long its answer should be believed. Staleness comes off the SLOWEST rung rather than
       // the current one — a document must not read stale merely because the loop backed off, and
       // the bound has to cover the widest gap the ladder can produce, not the gap we happen to be
       // at. Deliberately not presence's staleAfterMs: that is a wire promise about a heartbeat
       // this loop does not drive, and coupling a hint to a contract makes one silently move the
       // other.
       census=await takeCensus({...options,identity},{agents:censusRoster,panes:censusPanes,adapters,
         memo:censusMemo,previous:census,runDirs:censusRunDirs,
         intervalMs:intervalMs ?? SLEEP_LADDER_MS[Math.max(rung,0)],
         staleAfterMs:3*SLEEP_LADDER_MS[SLEEP_LADDER_MS.length-1]});
       // TM-132: the mechanical slot grant rides the SAME listing the census just used, so a
       // handover costs zero extra tmux calls and zero model turns. Its failure is absorbed the
       // way the census absorbs its own — a slot record is not presence, and must not take the
       // supervisor down. An unreadable listing (null) reconciles nothing: reclamation needs proof
       // of absence, never merely the absence of proof.
       if(Array.isArray(censusPanes)) {
         const slots=await reconcileSlots({...options,identity,panes:censusPanes})
           .catch(error=>({error:error?.code ?? String(error)}));
         const granted=Array.isArray(slots)?slots.flatMap(view=>view.events):[];
         if(granted.length) await notifyGrants(granted,options).catch(()=>{});
         if(Array.isArray(slots)?slots.length:slots) report={...report,slots:Array.isArray(slots)
           ?slots.map(view=>({name:view.name,holder:view.holder?.agent_id??null,queue:view.queue.length,events:view.events.map(e=>e.type)}))
           :slots};
       }
       // TM-135: the quota watch rides the same listing again. Its failure is absorbed exactly as
       // the census and the slot reconcile absorb theirs — an observer may not take the supervisor
       // down — and it is reported only when it has something to say, so a quiet repository does
       // not grow a `quota` key on every tick.
       if(Array.isArray(censusPanes)) {
         const quota=await quotaTick({...options,env,home},{identity,panes:censusPanes,agents:censusRoster,adapters,
           watch:quotaWatch,runDirOf:agentId=>censusRunDirByAgent.get(agentId)??null})
           .catch(error=>({error:error?.code ?? String(error)}));
         if(quota?.error || quota?.incidents?.length || quota?.dismissed?.length || quota?.unwatched?.length || quota?.consentError) {
           report={...report,quota:{watching:quota.watching,consent:quota.consent,error:quota.error ?? quota.consentError ?? null,
             incidents:(quota.incidents??[]).map(i=>({agent:i.agent_id,provider:i.provider,id:i.incident_id,announced:i.announced?.status??null})),
             dismissed:quota.dismissed??[],unwatched:quota.unwatched??[]}};
         }
       }
       censusPanes=undefined;   // consumed; the next tick reuses L2's or takes its own
       report={...report,census:{at:census.at,tick_ms:census.tickMs,captures:census.captures,
         states:census.agents.reduce((totals,agent)=>({...totals,[agent.state]:(totals[agent.state]??0)+1}),{}),
         dispatchable:census.agents.filter(agent=>agent.dispatchable).length}};
       // The census contributes to the ladder, and it CANNOT pin it: `census.activity` means the
       // world moved, never that we looked. A pane that is still `working` is the steady state and
       // contributes nothing — the same reason a prompt already at `current` does not — and neither
       // does a transition into or out of `unknown`, which past the capture budget is our own
       // rationing rotating rather than news.
       rung=nextRung(rung,activity||census.activity);
       const sleepMs=intervalMs ?? SLEEP_LADDER_MS[rung];
       report={...report,sleep_ms:sleepMs};
       // Cumulative, and only when it has happened: a heartbeat that could not observe tmux is
       // invisible otherwise — the supervisor stays up and the presence document simply ages out.
       if(degradedBeats) report={...report,presence_beats_degraded:degradedBeats};
       await onTick(report);
       if(once || signal?.aborted) return report;
       await sleepFn(sleepMs);
     } while(!signal?.aborted && !controller.signal.aborted);
     if(heartbeatError) throw heartbeatError;
     return report;
   } finally { controller.abort(); quotaWatch.close(); await heartbeat; }
 },{timeoutMs:100});
}

/**
 * A process record written by startRepositorySupervision says `state: "starting"` and nothing ever
 * moved it, so a supervisor that died during startup was indistinguishable from one that had just
 * been spawned — which is how five records sat at `starting` with dead pids and a stack trace in
 * their logs that nobody was looking for. The first completed tick is the proof that startup
 * finished, so that is where the record advances. Only OUR pid's record is touched, and a missing
 * record is fine: a hand-run `ao-topology supervise` has none and must not invent one.
 */
async function promoteRecord(recordPath) {
  try {
    const record = await readJson(recordPath);
    if (record?.pid !== process.pid || record.state === 'running') return;
    await writeJson(recordPath, { ...record, state: 'running', first_tick_at: new Date().toISOString() });
  } catch { /* observability only: never fail a tick because bookkeeping could not be written */ }
}

/** Retire our own record when the repository we supervise is gone. Same ownership rule as promote. */
async function retireRecord(recordPath) {
  try {
    const record = await readJson(recordPath);
    if (record?.pid !== process.pid) return;
    await writeJson(recordPath, { ...record, state: 'consumer-gone', stopped_at: new Date().toISOString() });
  } catch { /* observability only */ }
}

function pidAlive(pid) {
  try { process.kill(pid,0); return true; }
  catch (error) { if (error.code==='ESRCH') return false; return true; }
}

/**
 * Read-only supervision health for one repository. `pid_alive` is a pid probe, so it cannot rule
 * out pid reuse — `tick_age_ms` is the signal that actually proves a supervisor is doing its job.
 */
export async function supervisionStatus({consumer,env=process.env,home=homedir()}={}) {
   const identity=await canonicalRepoId(consumer), key=repoKey(identity.id);
   const root=join(stateRoot(env,home),'supervision');
   const owner=await lockOwner(join(root,`${key}.lock`));
  const recordPath=join(root,`${key}.process.json`);
  const record=await readJson(recordPath).catch(()=>null);
  const tick=await readJson(join(root,`${key}.json`)).catch(()=>null);
  const at=tick?.at ? Date.parse(tick.at) : NaN;
   const alive=record ? pidAlive(record.pid) : false;
   const ownerIdentity=owner?.pid ? await processIdentity(owner.pid) : null;
   const ownerAlive=Boolean(owner && pidAlive(owner.pid) && ownerIdentity && ownerIdentity===owner.process_identity);
   const recordOwns=Boolean(record && ownerAlive && record.pid===owner.pid && record.process_identity===owner.process_identity && record.lock_token===owner.token);
  // The consumer can outlive nothing: `tm` removes a task-owned worktree after a verified merge,
  // and a record naming a directory that is gone can never be reclaimed by a restart. It is debris,
  // and saying so is what stops it making the next diagnosis harder.
  const consumerExists=record?.consumer ? await exists(record.consumer) : true;
   const state = ownerAlive ? (recordOwns ? 'running' : 'ownership-record-mismatch')
    : !record ? 'never-started'
    : alive ? 'running-without-lock'
    // A supervisor that noticed its repository was gone and stopped did the right thing; only an
    // UNEXPLAINED record for a vanished consumer is debris worth flagging.
    : record.state === 'consumer-gone' ? 'retired-consumer-gone'
    : !consumerExists ? 'orphaned'
    // `starting` on a dead pid means it never reached its first tick — a startup crash, not a
    // long-running supervisor that later fell over. The log holds the reason.
    : record.state === 'starting' ? 'died-before-first-tick'
    : 'down';
  return {
    repo_id:identity.id, key, state,
    pid:record?.pid ?? null, pid_alive:alive,
    owner:owner ? {...owner,alive:ownerAlive,current_process_identity:ownerIdentity} : null,
    record_owns_lock:recordOwns,
    consumer:record?.consumer ?? null, consumer_exists:consumerExists,
    record_state:record?.state ?? null, record_path:recordPath,
    started_at:record?.started_at ?? null, first_tick_at:record?.first_tick_at ?? null, stopped_at:record?.stopped_at ?? null,
    source_entrypoint:record?.source_entrypoint ?? null, source_fingerprint:record?.source_fingerprint ?? null,
    restarts:record?.restarts ?? 0,
    log:record?.log ?? join(root,`${key}.log`),
    last_tick_at:tick?.at ?? null, tick_age_ms:Number.isFinite(at) ? Date.now()-at : null,
    reconcile_min_ms:tick?.reconcile_min_ms ?? reconcileFloor(env),
  };
}

/** Start only a local reconciliation process, never a model/provider. Existing ownership is retained. */
export async function startRepositorySupervision(options) {
 const {env=process.env,home=homedir()}=options;
 const consumer=await repositoryConsumer(options.consumer);
 const startTimeoutRaw=options.startTimeoutMs ?? env.AO_SUPERVISION_START_TIMEOUT_MS;
 const startTimeoutMs=Number.isFinite(Number(startTimeoutRaw)) && Number(startTimeoutRaw)>0 ? Number(startTimeoutRaw) : DEFAULT_START_TIMEOUT_MS;
 const identity=await canonicalRepoId(consumer), key=repoKey(identity.id);
 const root=join(stateRoot(env,home),'supervision'), recordPath=join(root,`${key}.process.json`), logPath=join(root,`${key}.log`);
 return withLock(join(root,`${key}.start.lock`),async()=>{
   const owner=await lockOwner(join(root,`${key}.lock`));
   if(owner?.pid && await processIdentity(owner.pid)===owner.process_identity) return {...owner,consumer,repo_id:identity.id,state:'running'};
   const prior=await readJson(recordPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
   // stdio:'ignore' loses the one thing you need when a supervisor dies: why. Both streams append
   // to a per-repo log, and `restarts` counts how often we have found the previous one dead — a
   // supervisor on its fortieth restart is a crash loop, and nothing could tell you that before.
   await mkdir(root,{recursive:true});
   const log=await open(logPath,'a');
   const restarts=prior ? (prior.restarts ?? 0)+1 : 0;
   try {
     const child=spawn(process.execPath,[cli,'supervise','--consumer',consumer,...(options.tmuxServer?['--server',options.tmuxServer]:[])],{cwd:consumer,env:{...process.env,...env},detached:true,stdio:['ignore',log.fd,log.fd]});
     await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
     await log.write(`\n=== ao supervise start ${new Date().toISOString()} pid=${child.pid} restarts=${restarts} repo=${identity.id} ===\n`);
     const record={pid:child.pid,repo_id:identity.id,consumer,started_at:new Date().toISOString(),restarts,log:logPath,state:'spawned-awaiting-lock'};
     child.unref();
     // Do not release the start gate until the child has either acquired the lifetime lock or lost
     // it to an existing winner. This closes the small spawn/acquire gap without letting this
     // launcher publish the authoritative process record on the child's behalf.
     const deadline=Date.now()+startTimeoutMs;
     while(Date.now()<=deadline) {
       const winner=await lockOwner(join(root,`${key}.lock`));
       if(winner?.pid && await processIdentity(winner.pid)===winner.process_identity) {
         const published=await readJson(recordPath).catch(()=>null);
         if(published?.pid===winner.pid) return published;
         if(winner.pid!==child.pid) return {...winner,consumer,repo_id:identity.id,state:'running'};
       }
       if(!pidAlive(child.pid)) break;
       await sleep(Math.min(25,Math.max(1,deadline-Date.now())));
     }
     return record;
   } finally { await log.close(); }
 });
}

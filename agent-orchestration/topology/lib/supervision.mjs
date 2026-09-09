// One repository service reconciles derived state; it never launches or kills agents.
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
//   L3 the tick — an adaptive 2s/5s/15s sleep. A tick that finds no activity backs off; the next
//      tick that does snaps straight back to 2s.
//
// A QUIET REPOSITORY THEREFORE PUBLISHES PRESENCE MORE OFTEN THAN IT RECONCILES. That looks like
// a bug and is not one: presence staleness is a contract a consumer enforces, reconcile staleness
// is a hint nobody is owed. Do not "fix" it by driving L1 off this loop's sleep.
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { mkdir, open, readdir } from 'node:fs/promises';
import { createPresenceProducer, collectPresenceAgents } from './presence.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { withLock } from './lockfile.mjs';
import { listAgents, agentDirs } from './agents.mjs';
import { refreshPrompt } from './prompt-lifecycle.mjs';
import { resumeStandingMessages } from './standing-mailbox.mjs';
import { sleep, writeJson, readJson, run } from './util.mjs';

/** Adaptive tick sleep. Index 0 is the busy rung; a quiet tick walks one rung down the list. */
export const SLEEP_LADDER_MS = [2000, 5000, 15000];
/** Floor between two runs of the expensive reconcile body. AO_RECONCILE_MIN_MS overrides. */
export const DEFAULT_RECONCILE_MIN_MS = 10_000;

/** Quiet ticks walk one rung down the ladder; ANY activity snaps straight back to the busy rung.
 *  `rung` is the previous rung, or -1 before the first tick. */
export function nextRung(rung, activity) {
  return activity ? 0 : Math.min(rung + 1, SLEEP_LADDER_MS.length - 1);
}

function reconcileFloor(env, override) {
  const raw = override ?? env.AO_RECONCILE_MIN_MS;
  const value = raw === undefined || raw === null || raw === '' ? DEFAULT_RECONCILE_MIN_MS : Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_RECONCILE_MIN_MS;
}

export async function superviseRepository(options, { signal, once = false, intervalMs, reconcileMinMs, onTick = () => {}, sleepFn = sleep } = {}) {
 const { consumer, env=process.env, home=homedir() }=options;
 const identity=await canonicalRepoId(consumer), root=join(stateRoot(env,home),'supervision');
 const key=repoKey(identity.id);
 const floorMs=reconcileFloor(env,reconcileMinMs);
 // A losing supervisor should give the lock back to the winner immediately rather than idling in
 // the poll loop: on a machine with eight linked worktrees open, seven lose this race every time a
 // session starts, and their only correct move is to exit.
 return withLock(join(root,`${key}.lock`),async()=>{
   const producer=await createPresenceProducer(options);
   const controller = new AbortController();
   signal?.addEventListener('abort', () => controller.abort(), {once:true});
   let latest, heartbeatError;
   const heartbeat = once ? null : producer.watch({signal:controller.signal,onPublish:snapshot=>{latest=snapshot;}}).catch(error=>{heartbeatError=error;controller.abort();});
   // The expensive body. Returns the report it wrote plus whether anything actually moved.
   const reconcile=async()=>{
     const observed=await collectPresenceAgents(options);
     const panes=observed.filter(p=>p.lifecycle!=="dead").map(p=>({...p.session,alive:true}));
     const agents=await listAgents(agentDirs(options));
     const prompts=[];
     for(const agent of agents){
       if(!observed.some(p=>p.agentId===agent.id && p.lifecycle!=="dead" && p.enrollment==="enrolled" && p.primaryRunId===null)) continue;
       prompts.push({agent:agent.id,state:await refreshPrompt({...options,agent,live:true})});
     }
     const listing=await run('git',['-C',consumer,'worktree','list','--porcelain'],{allowFailure:true});
     const roots=new Set([consumer,...listing.stdout.split('\n').filter(line=>line.startsWith('worktree ')).map(line=>line.slice(9))]);
     for(const checkout of roots) {
       const runsRoot=join(checkout,'.bytedesk/agent-orchestration/runs');
       for(const name of await readdir(runsRoot).catch(()=>[])) {
         const runDir=join(runsRoot,name), runRecord=await readJson(join(runDir,'run.json')).catch(()=>null);
         if(!runRecord || (await canonicalRepoId(runRecord.consumer || checkout)).id!==identity.id) continue;
         for(const entry of runRecord.agents || []) {
           if(!entry.binding || !panes.some(p=>p.alive && ['serverKey','serverPid','sessionId','sessionCreated','paneId','panePid'].every(k=>p[k]===entry.binding[k]))) continue;
           const dir=join(runDir,'agents',entry.id), definition=await readJson(join(dir,'prompt-agent.json')).catch(()=>null);
           if(!definition) continue;
           prompts.push({agent:entry.id,run:runRecord.run_id,state:await refreshPrompt({...options,consumer:runRecord.consumer || checkout,agent:{...definition,_dir:dir},live:true})});
         }
       }
     }
     if(heartbeatError) throw heartbeatError;
     const snapshot=latest || await producer.publish();
     const resumed=await resumeStandingMessages(options);
     // Activity means something MOVED, not merely that agents exist: a prompt that is already
     // `current` is a steady state and must not pin the ladder to its busy rung forever.
     const activity=prompts.some(p=>p.state?.status && p.state.status!=='current') || resumed.length>0;
     const report={pid:process.pid,at:new Date().toISOString(),repo_id:identity.id,generation:snapshot.generation,revision:snapshot.revision,
       reconciled:true,reconcile_min_ms:floorMs,activity,
       prompts:prompts.map(p=>({agent:p.agent,status:p.state.status,errors:p.state.errors})),
       mail:resumed.map(m=>({id:m.envelope.id,status:m.status,reason:m.reason}))};
     await writeJson(join(root,`${key}.json`),report);
     return {report,activity};
   };
   try {
     // rung -1 is "no quiet tick yet", so the first sleep is the busy rung and the ladder is walked
     // only by ticks that actually found nothing to do.
     let lastReconcileAt=-Infinity, rung=-1, report=null;
     do {
       if(heartbeatError) throw heartbeatError;
       let activity=false;
       // `once` always reconciles: a single-shot supervise is asking for the expensive answer.
       if(once || Date.now()-lastReconcileAt>=floorMs) {
         lastReconcileAt=Date.now();
         ({report,activity}=await reconcile());
       } else {
         // A cheap tick costs a timestamp. It exists so the observation work that belongs at this
         // cadence has somewhere to live without dragging L2's git-and-filesystem body with it.
         report={...report,at:new Date().toISOString(),reconciled:false,activity:false};
       }
       rung=nextRung(rung,activity);
       const sleepMs=intervalMs ?? SLEEP_LADDER_MS[rung];
       report={...report,sleep_ms:sleepMs};
       await onTick(report);
       if(once || signal?.aborted) return report;
       await sleepFn(sleepMs);
     } while(!signal?.aborted && !controller.signal.aborted);
     if(heartbeatError) throw heartbeatError;
     return report;
   } finally { controller.abort(); await heartbeat; }
 },{timeoutMs:100});
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
  const record=await readJson(join(root,`${key}.process.json`)).catch(()=>null);
  const tick=await readJson(join(root,`${key}.json`)).catch(()=>null);
  const at=tick?.at ? Date.parse(tick.at) : NaN;
  return {
    repo_id:identity.id, key,
    state: !record ? 'never-started' : pidAlive(record.pid) ? 'running-or-ownership-unknown' : 'down',
    pid:record?.pid ?? null, pid_alive:record ? pidAlive(record.pid) : false,
    started_at:record?.started_at ?? null, restarts:record?.restarts ?? 0,
    log:record?.log ?? join(root,`${key}.log`),
    last_tick_at:tick?.at ?? null, tick_age_ms:Number.isFinite(at) ? Date.now()-at : null,
    reconcile_min_ms:tick?.reconcile_min_ms ?? reconcileFloor(env),
  };
}

/** Start only a local reconciliation process, never a model/provider. Existing ownership is retained. */
export async function startRepositorySupervision(options) {
 const {consumer,env=process.env,home=homedir()}=options;
 const identity=await canonicalRepoId(consumer), key=repoKey(identity.id);
 const root=join(stateRoot(env,home),'supervision'), recordPath=join(root,`${key}.process.json`), logPath=join(root,`${key}.log`);
 return withLock(join(root,`${key}.start.lock`),async()=>{
   const prior=await readJson(recordPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(prior?.pid){try{process.kill(prior.pid,0);return {...prior,state:'running-or-ownership-unknown'};}catch(error){if(error.code!=='ESRCH')throw error;}}
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
     const record={pid:child.pid,repo_id:identity.id,consumer,started_at:new Date().toISOString(),restarts,log:logPath,state:'starting'};
     await writeJson(recordPath,record);child.unref();return record;
   } finally { await log.close(); }
 });
}

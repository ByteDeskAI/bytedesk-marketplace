// One repository service reconciles derived state; it never launches or kills agents.
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { readdir } from 'node:fs/promises';
import { createPresenceProducer, collectPresenceAgents } from './presence.mjs';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { withLock } from './lockfile.mjs';
import { listAgents, agentDirs } from './agents.mjs';
import { refreshPrompt } from './prompt-lifecycle.mjs';
import { resumeStandingMessages } from './standing-mailbox.mjs';
import { sleep, writeJson, readJson, run } from './util.mjs';

export async function superviseRepository(options, { signal, once = false, intervalMs = 1000, onTick = () => {} } = {}) {
 const { consumer, env=process.env, home=homedir() }=options;
 const identity=await canonicalRepoId(consumer), root=join(stateRoot(env,home),'supervision');
 const key=repoKey(identity.id);
 return withLock(join(root,`${key}.lock`),async()=>{
   const producer=await createPresenceProducer(options);
   const controller = new AbortController();
   signal?.addEventListener('abort', () => controller.abort(), {once:true});
   let latest, heartbeatError;
   const heartbeat = once ? null : producer.watch({signal:controller.signal,onPublish:snapshot=>{latest=snapshot;}}).catch(error=>{heartbeatError=error;controller.abort();});
   try { do {
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
     const report={pid:process.pid,at:new Date().toISOString(),repo_id:identity.id,generation:snapshot.generation,revision:snapshot.revision,
       prompts:prompts.map(p=>({agent:p.agent,status:p.state.status,errors:p.state.errors})),
       mail:resumed.map(m=>({id:m.envelope.id,status:m.status,reason:m.reason}))};
     await writeJson(join(root,`${key}.json`),report); await onTick(report);
     if(once || signal?.aborted) return report;
     await sleep(intervalMs);
   }while(!signal?.aborted && !controller.signal.aborted);
   if(heartbeatError) throw heartbeatError;
   } finally { controller.abort(); await heartbeat; }
 },{timeoutMs:100});
}

/** Start only a local reconciliation process, never a model/provider. Existing ownership is retained. */
export async function startRepositorySupervision(options) {
 const {consumer,env=process.env,home=homedir()}=options;
 const identity=await canonicalRepoId(consumer), key=repoKey(identity.id);
 const root=join(stateRoot(env,home),'supervision'), recordPath=join(root,`${key}.process.json`);
 return withLock(join(root,`${key}.start.lock`),async()=>{
   const prior=await readJson(recordPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
   if(prior?.pid){try{process.kill(prior.pid,0);return {...prior,state:'running-or-ownership-unknown'};}catch(error){if(error.code!=='ESRCH')throw error;}}
   const cli=fileURLToPath(new URL('../cli.mjs',import.meta.url));
   const child=spawn(process.execPath,[cli,'supervise','--consumer',consumer,...(options.tmuxServer?['--server',options.tmuxServer]:[])],{cwd:consumer,env:{...process.env,...env},detached:true,stdio:'ignore'});
   await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
   const record={pid:child.pid,repo_id:identity.id,consumer,started_at:new Date().toISOString(),state:'starting'};
   await writeJson(recordPath,record);child.unref();return record;
 });
}

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLead, assignLead, detachLead, leadState } from '../../topology/lib/lead.mjs';
import { run } from '../../topology/lib/util.mjs';
const pluginRoot=fileURLToPath(new URL('../..',import.meta.url));

test('concurrent shared-worktree ensure converges, distinguishes dead and unresponsive, and preserves external assignment',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ao-lead-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=join(root,'repo'), linked=join(root,'linked'), home=join(root,'home');
 await run('git',['init',repo]); await run('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','init']); await run('git',['-C',repo,'worktree','add','-b','linked',linked]);
 const env={XDG_CONFIG_HOME:join(home,'.config'),AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')};
 let opens=0, alive=true, responsive=true;
 const probes={alive:async()=>alive,responsive:async()=>responsive,pane:async()=>'%2',open:async()=>{opens++; await new Promise(r=>setTimeout(r,10)); return {session:'test-lead',pane:'%2'};},kill:()=>assert.fail('must not kill')};
 const opts={consumer:repo,home,pluginRoot,env,probes};
 const results=await Promise.all(Array.from({length:6},(_,i)=>ensureLead({...opts,consumer:i%2?linked:repo})));
 assert.equal(opens,1); assert.equal(new Set(results.map(r=>r.record.agent_id)).size,1);
 responsive=false; assert.equal((await ensureLead(opts)).action,'kept-unresponsive'); assert.equal((await leadState(opts)).status,'unresponsive'); assert.equal(opens,1);
 alive=false; assert.equal((await ensureLead(opts)).action,'restarted'); assert.equal(opens,2);
 alive=true; responsive=false;
 await assert.rejects(assignLead({...opts,agentRef:results[0].record.agent_id}),{code:'TOPOLOGY_LEAD_HANDSHAKE_REQUIRED'});
 responsive=true; const assigned=await assignLead({...opts,agentRef:results[0].record.agent_id,session:'existing'}); assert.equal(assigned.privileges,'unchanged');
 alive=false; assert.equal((await ensureLead(opts)).action,'dead-external'); assert.equal(opens,2);
 assert.equal((await detachLead({...opts,kill:true})).killed,false);
 const self=await ensureLead({...opts,env:{...env,AO_LEAD_ID:assigned.record.agent_id,AO_CONSUMER:linked}}); assert.equal(self.action,'self'); assert.equal(opens,2);
});

test('separate startup processes race on a real tmux server and converge on one session',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ao-lead-process-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=join(root,'repo'),home=join(root,'home'),server=`ao-lead-test-${process.pid}-${Date.now()}`;
 await run('git',['init',repo]);
 t.after(()=>run('tmux',['-L',server,'kill-server'],{allowFailure:true}));
 const program=`import { ensureLead } from ${JSON.stringify(new URL('../../topology/lib/lead.mjs',import.meta.url).href)};
 import { run } from ${JSON.stringify(new URL('../../topology/lib/util.mjs',import.meta.url).href)};
 const options=JSON.parse(process.argv[1]);
 const probes={alive:async r=>(await run('tmux',['-L',options.server,'has-session','-t',r.session],{allowFailure:true})).code===0,responsive:async()=>true,open:async()=>{await run('tmux',['-L',options.server,'new-session','-d','-s','lead','sleep','30']); return {session:'lead',pane:'%0'};}};
 const result=await ensureLead({...options,probes}); console.log(JSON.stringify({id:result.record.agent_id,action:result.action}));`;
 const opts={consumer:repo,home,pluginRoot,server,env:{XDG_CONFIG_HOME:join(home,'.config'),AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')}};
 const results=await Promise.all(Array.from({length:5},()=>run(process.execPath,['--input-type=module','-e',program,JSON.stringify(opts)])));
 const rows=results.map(r=>JSON.parse(r.stdout)); assert.equal(new Set(rows.map(r=>r.id)).size,1); assert.equal(rows.filter(r=>r.action==='created').length,1);
 const sessions=await run('tmux',['-L',server,'list-sessions','-F','#{session_name}']); assert.deepEqual(sessions.stdout.trim().split('\n'),['lead']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshPrompt, acknowledgePrompt, promotePromptForIncarnation } from '../../topology/lib/prompt-lifecycle.mjs';

test('last-valid prompt survives malformed config and live changes require restart and agent acknowledgment', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-prompt-live-')); t.after(() => rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'), home=join(root,'home'), dir=join(root,'agent');
  const conf=join(consumer,'.bytedesk','agent-orchestration'); await mkdir(conf,{recursive:true});
  const agent={id:'abc12345',role:'worker',full_name:'Test Worker',_dir:dir,instructions:'original'};
  const binding={serverKey:'default',serverPid:1,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:11};
  const session='ao-abc12345', agentEnv={AO_AGENT_ID:agent.id,AO_SESSION:session,AO_CONSUMER:consumer};
  const opts={agent,consumer,home,session,binding,env:{XDG_CONFIG_HOME:join(home,'.config')}};
  const staged=await refreshPrompt(opts); assert.equal(staged.status,'awaiting-ack'); assert.equal(staged.applied_revision,undefined);
  const unchanged=await refreshPrompt({...opts,live:true}); assert.equal(unchanged.status,'awaiting-ack'); assert.equal(unchanged.nonce,staged.nonce);
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding,env:{...agentEnv,AO_AGENT_ID:'wrong'}}),e=>e.code==='TOPOLOGY_PROMPT_ACK_INVALID'&&e.details.reason==='agent-mismatch');
  const applied=await acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding,env:agentEnv});
  const before=await readFile(join(dir,'prompt.md'),'utf8');
  await writeFile(join(conf,'config.json'),'{');
  const invalid=await refreshPrompt({...opts,live:true}); assert.equal(invalid.status,'invalid-config'); assert.equal(invalid.applied_revision,applied.applied_revision); assert.equal(await readFile(join(dir,'prompt.md'),'utf8'),before);
  await writeFile(join(conf,'config.json'),'{}');
  const restored=await refreshPrompt({...opts,live:true}); assert.equal(restored.status,'current');
  assert.deepEqual(JSON.parse(await readFile(join(dir,'prompt-state.json'),'utf8')).errors,[]);
  const sameRestart=await refreshPrompt(opts); assert.equal(sameRestart.status,'awaiting-ack'); assert.notEqual(sameRestart.nonce,staged.nonce); assert.equal(sameRestart.applied_revision,undefined);
  await acknowledgePrompt({agent,consumer,session,revision:sameRestart.desired_revision,nonce:sameRestart.nonce,binding,env:agentEnv});
  agent.instructions='changed';
  const queued=await refreshPrompt({...opts,live:true}); assert.equal(queued.status,'queued');
  const safe=await refreshPrompt({...opts,live:true,safeBoundary:true}); assert.equal(safe.status,'restart-required'); assert.equal(safe.applied_revision,applied.applied_revision); assert.equal(await readFile(join(dir,'prompt.md'),'utf8'),before);
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:safe.desired_revision,nonce:staged.nonce,binding,env:agentEnv}),e=>e.code==='TOPOLOGY_PROMPT_ACK_INVALID'&&e.details.reason==='state-not-awaiting-ack');
  const replacement={...binding,panePid:12};
  const restart=await refreshPrompt({...opts,binding:replacement}); const ack=await acknowledgePrompt({agent,consumer,session,revision:restart.desired_revision,nonce:restart.nonce,binding:replacement,env:agentEnv}); assert.notEqual(ack.applied_revision,applied.applied_revision);
});

test('acknowledgement belongs to one exact process incarnation and replacement invalidates current', async t => {
  const root=await mkdtemp(join(tmpdir(),'ao-prompt-binding-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),home=join(root,'home'),dir=join(root,'agent');await mkdir(consumer,{recursive:true});
  const agent={id:'bound001',role:'worker',full_name:'Bound Worker',_dir:dir,instructions:'work'};
  const a={serverKey:'s',serverPid:1,sessionId:'$1',sessionCreated:2,paneId:'%1',panePid:3};
  const b={...a,panePid:4};
  const session='ao-bound001',env={AO_AGENT_ID:agent.id,AO_SESSION:session,AO_CONSUMER:consumer};
  const staged=await refreshPrompt({agent,consumer,session,home,binding:a,env:{XDG_CONFIG_HOME:join(home,'config')}});
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding:a,env:{...env,AO_SESSION:'other'}}),e=>e.details.reason==='session-mismatch');
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding:a,env:{...env,AO_CONSUMER:root}}),e=>e.details.reason==='repository-mismatch');
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding:b,env}),e=>e.code==='TOPOLOGY_PROMPT_ACK_INVALID'&&e.details.reason==='incarnation-mismatch');
  await acknowledgePrompt({agent,consumer,session,revision:staged.desired_revision,nonce:staged.nonce,binding:a,env});
  const replaced=await refreshPrompt({agent,consumer,session,home,binding:b,live:true,env:{XDG_CONFIG_HOME:join(home,'config')}});
  assert.equal(replaced.status,'queued');assert.deepEqual(replaced.desired_binding,b);
});

test('a controlled restart promotes pending text and mints an acknowledgement for the replacement only', async t => {
  const root=await mkdtemp(join(tmpdir(),'ao-prompt-promote-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),home=join(root,'home'),dir=join(root,'agent');await mkdir(consumer,{recursive:true});
  const agent={id:'promote1',role:'worker',full_name:'Prompt Worker',_dir:dir,instructions:'one'};
  const a={serverKey:'s',serverPid:1,sessionId:'$1',sessionCreated:2,paneId:'%1',panePid:3},b={...a,panePid:4};
  const session='ao-promote1',agentEnv={AO_AGENT_ID:agent.id,AO_SESSION:session,AO_CONSUMER:consumer};
  const opts={agent,consumer,session,home,binding:a,env:{XDG_CONFIG_HOME:join(home,'config')}};
  let state=await refreshPrompt(opts);await acknowledgePrompt({agent,consumer,session,revision:state.desired_revision,nonce:state.nonce,binding:a,env:agentEnv});
  agent.instructions='two';state=await refreshPrompt({...opts,live:true});assert.equal(state.status,'queued');
  state=await refreshPrompt({...opts,live:true,safeBoundary:true});assert.equal(state.status,'restart-required');
  const promoted=await promotePromptForIncarnation({agent,binding:b,consumer,session});assert.equal(promoted.status,'awaiting-ack');assert.deepEqual(promoted.desired_binding,b);assert.match(await readFile(join(dir,'prompt.md'),'utf8'),/two/);
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:promoted.desired_revision,nonce:promoted.nonce,binding:a,env:agentEnv}),e=>e.details.reason==='incarnation-mismatch');
});

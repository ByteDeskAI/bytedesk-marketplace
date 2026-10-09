import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshPrompt, acknowledgePrompt, bindStagedPrompt, promotePromptForIncarnation, collectPromptAcknowledgement } from '../../topology/lib/prompt-lifecycle.mjs';

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

test('restricted reviewer acknowledges through observed output without shell or write grants', async t=>{
  const root=await mkdtemp(join(tmpdir(),'ao-reviewer-prompt-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),dir=join(root,'reviewer');await mkdir(consumer);
  const agent={id:'review01',role:'reviewer',full_name:'Reviewer',_dir:dir,instructions:'Review only.'};
  const binding={serverKey:'/test/socket',serverPid:1,sessionId:'$1',sessionCreated:2,paneId:'%1',panePid:3};
  const opts={agent,consumer,session:'reviewer',binding,home:root,env:{XDG_CONFIG_HOME:join(root,'config')}};
  const state=await refreshPrompt(opts);
  const prompt=await readFile(join(dir,'prompt.md'),'utf8');
  assert.ok(!prompt.includes('ao-topology prompt ack'));
  assert.match(prompt,/AO_PROMPT_ACK/);
  const observe=async()=>[{...binding,alive:true}];
  const wrong=await collectPromptAcknowledgement({...opts,observe,output:async()=>`AO_PROMPT_ACK forged ${state.desired_revision}`});
  assert.equal(wrong.collected,false);
  await assert.rejects(collectPromptAcknowledgement({...opts,observe:async()=>[{...binding,panePid:4,alive:true}],output:async()=>`AO_PROMPT_ACK ${state.nonce} ${state.desired_revision}`}),{code:'TOPOLOGY_PROMPT_ACK_INVALID'});
  let observations=0;
  await assert.rejects(collectPromptAcknowledgement({...opts,observe:async()=>[{...binding,panePid:++observations===1?3:4,alive:true}],output:async()=>`AO_PROMPT_ACK ${state.nonce} ${state.desired_revision}`}),{code:'TOPOLOGY_PROMPT_ACK_INVALID'});
  const ack=await collectPromptAcknowledgement({...opts,observe,output:async()=>`● AO_PROMPT_ACK ${state.nonce} ${state.desired_revision}`});
  assert.equal(ack.collected,true);assert.equal(ack.state.status,'current');assert.deepEqual(ack.state.applied_binding,binding);
});

// TM-411: `prompt ack` runs from a child shell of the agent's pane (a Bash tool call), so the caller
// is a descendant of the pane process. Ancestry decides; an unrelated process is refused.
test('prompt ack binding is proven by process ancestry: a child shell of the pane is accepted, an unrelated process is not', async t => {
  const { spawn, execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const sibling = spawn('sleep', ['30'], { stdio: 'ignore' });
  t.after(() => sibling.kill('SIGKILL'));
  const moduleUrl = new URL('../../topology/lib/prompt-lifecycle.mjs', import.meta.url).href;
  const script = `const { callerBinding } = await import(${JSON.stringify(moduleUrl)});
    const pane = { serverKey: '/test/socket', serverPid: 1, sessionId: '$1', sessionCreated: 2, paneId: '%1' };
    const own = { ...pane, panePid: Number(process.env.PANE) }, other = { ...pane, paneId: '%2', panePid: Number(process.env.OTHER) };
    process.stdout.write(JSON.stringify({
      child: await callerBinding({ panes: [other, own], recorded: own }),
      unrelated: await callerBinding({ panes: [other], recorded: null }),
      replaced: await callerBinding({ panes: [own], recorded: { ...own, serverPid: 9 } }),
    }));`;
  // The outer bash is the "pane process"; node runs two shells below it. The trailing `; true`
  // keeps each bash from exec-ing its last command, so the ancestry is genuinely nested.
  const { stdout } = await promisify(execFile)('bash', ['-c',
    `PANE=$$ OTHER=${sibling.pid} bash -c 'node --input-type=module -e "$SCRIPT"; true'; true`],
    { env: { ...process.env, SCRIPT: script, TMUX_PANE: '' } });
  const result = JSON.parse(stdout);
  assert.equal(result.child?.paneId, '%1', 'a child shell of the registered pane process is accepted');
  assert.equal(result.unrelated, null, 'a pane whose process is not an ancestor is refused');
  assert.equal(result.replaced, null, 'a different incarnation of the pane is refused');
});

test('TM-417: a workflow-run member acks its launch-staged prompt once launch binds it, and supervision keeps it awaiting', async t => {
  const root=await mkdtemp(join(tmpdir(),'ao-prompt-run-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const consumer=join(root,'repo'),home=join(root,'home'),dir=join(root,'agent');await mkdir(consumer,{recursive:true});
  const agent={id:'worker',role:'orchestrator',full_name:'Run Worker',_dir:dir,instructions:'work'};
  const binding={serverKey:'s',serverPid:1,sessionId:'$1',sessionCreated:2,paneId:'%1',panePid:3};
  const session='tm-016-run',env={AO_AGENT_ID:agent.id,AO_SESSION:session,AO_CONSUMER:consumer},cfg={XDG_CONFIG_HOME:join(home,'config')};
  // What launch writes before the pane exists: no session, repository or binding.
  const composed=await refreshPrompt({agent,consumer,session,home,binding,env:cfg});
  const { desired_revision, sources, nonce } = composed;
  await writeFile(join(dir,'prompt-state.json'),JSON.stringify({desired_revision,sources,status:'awaiting-ack',nonce,replacement:'cold-start'}));
  await assert.rejects(acknowledgePrompt({agent,consumer,session,revision:desired_revision,nonce,binding,env}),e=>e.details.reason==='session-mismatch');
  const { canonicalRepoId } = await import('../../topology/lib/repoid.mjs');
  await bindStagedPrompt({dir,session,repoId:(await canonicalRepoId(consumer)).id,binding});
  const supervised=await refreshPrompt({agent,consumer,session,home,binding,live:true,env:cfg});
  assert.equal(supervised.status,'awaiting-ack');assert.equal(supervised.nonce,nonce);
  assert.equal((await acknowledgePrompt({agent,consumer,session,revision:desired_revision,nonce,binding,env})).status,'current');
});

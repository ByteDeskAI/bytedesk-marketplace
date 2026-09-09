import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestEnrollment, acknowledgeEnrollment } from '../../topology/lib/enrollment.mjs';
import { startupCheck, pendingEnrollments } from '../../topology/lib/startup.mjs';
import { collectPresenceAgents } from '../../topology/lib/presence.mjs';
import { writeJson, writeText } from '../../topology/lib/util.mjs';
const pluginRoot=fileURLToPath(new URL('../..',import.meta.url));
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'ao-enrollment-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const consumer=join(root,'repo'),home=join(root,'home');await mkdir(consumer);await mkdir(home);
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,'state'),XDG_CONFIG_HOME:join(home,'.config')};
 const pane={serverKey:'/tmp/enroll-test.sock',serverPid:100,sessionId:'$1',sessionCreated:200,paneId:'%1',panePid:300,sessionName:'existing-session',cwd:consumer,alive:true,command:'kimi'};
 for(const id of ['work0001','work0002']){
  const dir=join(consumer,'.bytedesk/agent-orchestration/agents',id);
  await writeJson(join(dir,'agent.json'),{id,role:'worker',full_name:`Worker ${id}`,cli:'kimi',instructions:'Keep the current task.'});
  await writeText(join(dir,'prompt.md'),'Existing running prompt.');
 }
 await writeText(join(consumer,'task.txt'),'Do not alter this task.');
 await startupCheck({consumer,source:'watcher',session:pane.sessionName,pane:pane.paneId,incarnation:pane,env,home});
 const [pending]=await pendingEnrollments({env,home});
 const options={consumer,pendingKey:pending.key,agentRef:'work0001',env,home,pluginRoot,listPanesFn:async()=>[pane]};
 const ackEnv={...env,AO_AGENT_ID:'work0001',AO_CONSUMER:consumer,TMUX:`${pane.serverKey},${pane.serverPid},0`,TMUX_PANE:pane.paneId};
 return {root,consumer,home,env,pane,options,ackEnv};
}
test('explicit nonce enrollment preserves session/task/privileges and appears in presence',async t=>{
 const f=await fixture(t);const before=JSON.stringify(f.pane);
 const request=await requestEnrollment(f.options);assert.equal(request.status,'awaiting-ack');assert.equal(request.privileges,'unchanged');
 assert.equal((await requestEnrollment(f.options)).challenge.nonce,request.challenge.nonce);
 const enrolled=await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce});
 assert.equal(enrolled.status,'enrolled');assert.equal(enrolled.privileges,'unchanged');assert.equal(enrolled.record.prompt_status,'queued');
 assert.equal(enrolled.record.agent_id,'work0001');assert.equal((await pendingEnrollments(f)).length,0);
 assert.equal(JSON.stringify(f.pane),before);assert.equal(await readFile(join(f.consumer,'task.txt'),'utf8'),'Do not alter this task.');
 assert.equal(await readFile(join(f.consumer,'.bytedesk/agent-orchestration/agents/work0001/prompt.md'),'utf8'),'Existing running prompt.');
 const agents=await collectPresenceAgents({consumer:f.consumer,env:f.env,home:f.home,listPanesFn:async()=>[f.pane]});
 assert.equal(agents.length,1);assert.equal(agents[0].agentId,'work0001');assert.equal(agents[0].enrollment,'enrolled');assert.equal(agents[0].session.panePid,300);
 assert.equal((await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce})).deduplicated,true);
});
test('wrong nonce, identity, repository or acknowledging pane preserves pending',async t=>{
 const f=await fixture(t);const request=await requestEnrollment(f.options);
 for(const change of [{nonce:'wrong'},{env:{...f.ackEnv,AO_AGENT_ID:'work0002'}},{env:{...f.ackEnv,AO_CONSUMER:f.home}},{env:{...f.ackEnv,TMUX_PANE:'%9'}}]){
  await assert.rejects(acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce,...change}));
  assert.equal((await pendingEnrollments(f)).length,1);
 }
});
test('each changed incarnation component rejects acknowledgement without clearing pending',async t=>{
 const f=await fixture(t);const request=await requestEnrollment(f.options);
 for(const key of ['serverKey','serverPid','sessionId','sessionCreated','paneId','panePid']){
  const changed={...f.pane,[key]:typeof f.pane[key]==='number'?f.pane[key]+1:`${f.pane[key]}-other`};
  await assert.rejects(acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce,listPanesFn:async()=>[changed]}),{code:'TOPOLOGY_ENROLLMENT_BINDING'});
  assert.equal((await pendingEnrollments(f)).length,1);
 }
});
test('concurrent requests cannot assign one incarnation to different identities',async t=>{
 const f=await fixture(t);
 const results=await Promise.allSettled([requestEnrollment(f.options),requestEnrollment({...f.options,agentRef:'work0002'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'TOPOLOGY_ENROLLMENT_ASSIGNED');
});
test('invalid prompt configuration retains pending and existing running prompt',async t=>{
 const f=await fixture(t);const request=await requestEnrollment(f.options);
 await writeText(join(f.home,'.config/agent-orchestration/config.json'),'{');
 await assert.rejects(acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce}));
 assert.equal((await pendingEnrollments(f)).length,1);
 assert.equal(await readFile(join(f.consumer,'.bytedesk/agent-orchestration/agents/work0001/prompt.md'),'utf8'),'Existing running prompt.');
});

test('expired challenge preserves pending and same identity can request a fresh nonce',async t=>{
 const f=await fixture(t);const request=await requestEnrollment(f.options);
 await writeJson(request.challengePath,{...request.challenge,expires_at:0});
 await assert.rejects(acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce}),{code:'TOPOLOGY_ENROLLMENT_EXPIRED'});
 assert.equal((await pendingEnrollments(f)).length,1);
 const next=await requestEnrollment(f.options);assert.notEqual(next.challenge.nonce,request.challenge.nonce);
 const success=await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:next.challenge.nonce});assert.equal(success.status,'enrolled');
 await assert.rejects(requestEnrollment({...f.options,agentRef:'work0002'}),{code:'TOPOLOGY_ENROLLMENT_ASSIGNED'});
});

test('ack recovery clears only the exact pending record after enrolled publication',async t=>{
 const f=await fixture(t);const [pending]=await pendingEnrollments(f);const request=await requestEnrollment(f.options);
 await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce});
 const pendingPath=join(f.env.AGENT_ORCHESTRATION_STATE_HOME,'enrollments/pending',`${pending.key}.json`);
 await writeJson(pendingPath,pending);
 const again=await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce});assert.equal(again.deduplicated,true);assert.equal((await pendingEnrollments(f)).length,0);
 await writeJson(pendingPath,{...pending,incarnation:{...pending.incarnation,panePid:999}});
 await acknowledgeEnrollment({...f.options,env:f.ackEnv,nonce:request.challenge.nonce});assert.equal((await pendingEnrollments(f)).length,1,'replacement pending data must not be deleted');
});

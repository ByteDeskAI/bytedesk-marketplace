import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendMessage } from '../../topology/lib/mailbox.mjs';
import { readStandingInbox, readStandingOutbox, resumeStandingMessages } from '../../topology/lib/standing-mailbox.mjs';
import { writeJson } from '../../topology/lib/util.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
async function fixture(t, legacy=false) {
 const root=await mkdtemp(join(tmpdir(),'shared-admission-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const dest=join(root,'dest'),source=join(root,'source'),runDir=join(root,'run');
 await Promise.all([dest,source,runDir].map(p=>mkdir(p,{recursive:true})));
 await writeJson(join(runDir,'run.json'),{consumer:legacy?undefined:dest,run_id:'r',sequence:0,agents:[{id:'worker01',role:'worker'}]});
 for(const [id,role] of [['lead0001','lead'],['worker01','worker']])await writeJson(join(agentsRoot(dest),id,'agent.json'),{id,role});
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')};
 const standingOptions={home:join(root,'home'),readiness:async()=>({status:'responsive',record:{agent_id:'lead0001'},library_lead:'lead0001'}),
  // TM-167: cross-repository standing mail requires both repositories to be enrolled.
  enrollment:async()=>({enrolled:true,source:'test'})};
 const input={runDir,from:'source01',to:['worker01'],body:'request body',stage:'ask',env,standingOptions};
 return {dest,source,runDir,env,standingOptions,input};
}
test('omitted source and callback cannot bypass production run send admission',async t=>{
 const f=await fixture(t);let calls=0;
 const r=await sendMessage({...f.input,route:async()=>{calls++;return {deliver_to:'worker01'}}});
 assert.equal(r.deliveries.length,0);assert.equal(r.holds[0].reason,'source_identity_required');assert.equal(calls,0);
 assert.deepEqual(await readdir(join(f.runDir,'agents')).catch(()=>[]),[]);
});
test('shared send stable hold resumes to absent-roster lead once',async t=>{
 const f=await fixture(t);let ready=false;
 const input={...f.input,fromProject:f.source,idempotencyKey:'request-42',standingOptions:{...f.standingOptions,readiness:async()=>ready?f.standingOptions.readiness():{status:'unresponsive'}}};
 const a=await sendMessage(input),b=await sendMessage(input);assert.equal(a.id,b.id);assert.equal(a.holds[0].id,b.holds[0].id);
 const opts={env:f.env,...f.standingOptions};
 const out=await readStandingOutbox({consumer:f.source,agent:'source01',...opts});assert.equal(out.length,1);assert.equal(out[0].envelope.body,'request body');
 ready=true;await resumeStandingMessages({force:true,consumer:f.dest,...opts});
 const done=await sendMessage(input);assert.equal(done.deliveries[0].standing,true);assert.equal(done.deliveries[0].agent,'lead0001');
 assert.equal((await readStandingInbox({consumer:f.dest,agent:'lead0001',...opts})).length,1);
 await assert.rejects(sendMessage({...input,body:'changed'}),{code:'TOPOLOGY_MESSAGE_ID_CONFLICT'});
});
test('local sender supplies explicit source or launcher AO_CONSUMER',async t=>{
 const f=await fixture(t);
 assert.equal((await sendMessage({...f.input,fromProject:f.dest})).deliveries[0].agent,'worker01');
 assert.equal((await sendMessage({...f.input,env:{...f.env,AO_CONSUMER:f.dest}})).deliveries[0].agent,'worker01');
});
test('legacy run needs explicit destination context',async t=>{
 const f=await fixture(t,true);
 await assert.rejects(sendMessage({...f.input,fromProject:f.dest}),{code:'TOPOLOGY_RUN_CONSUMER_REQUIRED'});
 assert.equal((await sendMessage({...f.input,consumer:f.dest,fromProject:f.dest})).deliveries.length,1);
});
test('standingOptions router cannot override production routing',async t=>{
 const f=await fixture(t);let called=false;
 const r=await sendMessage({...f.input,fromProject:f.source,standingOptions:{...f.standingOptions,router:async()=>{called=true;return {resolved:'worker01',deliver_to:'worker01'}}}});
 assert.equal(called,false);assert.equal(r.deliveries[0].agent,'lead0001');
});

test('held barrier stays pending through resume until correct standing recipient replies',async t=>{
 const f=await fixture(t);
 const {waitForReplies,pendingReplies}=await import('../../topology/lib/mailbox.mjs');
 const {recordStandingReply}=await import('../../topology/lib/standing-mailbox.mjs');
 const sent=await sendMessage({...f.input,fromProject:f.source,idempotencyKey:'barrier',standingOptions:{...f.standingOptions,readiness:async()=>({status:'unresponsive'})}});
 const waitArgs={runDir:f.runDir,agentIds:['worker01'],messageId:sent.id,timeoutMs:15,pollMs:5};
 const held=await waitForReplies(waitArgs);assert.equal(held.ok,false);assert.equal(held.pending[0].status,'held');
 await resumeStandingMessages({force:true,consumer:f.dest,env:f.env,...f.standingOptions});
 const unanswered=await waitForReplies(waitArgs);assert.equal(unanswered.ok,false);assert.equal(unanswered.pending[0].status,'delivered-unanswered');assert.equal(unanswered.pending[0].answered_by,'lead0001');
 const reply={consumer:f.dest,messageId:sent.holds[0].id,agentId:'lead0001',body:'Durable response',env:{...f.env,AO_AGENT_ID:'lead0001',AO_CONSUMER:f.dest}};
 await assert.rejects(recordStandingReply({...reply,env:{...reply.env,AO_AGENT_ID:'worker01'}}),{code:'TOPOLOGY_AGENT_UNAUTHORIZED'});
 await assert.rejects(recordStandingReply({...reply,agentId:'worker01',env:{...reply.env,AO_AGENT_ID:'worker01'}}),{code:'TOPOLOGY_AGENT_UNAUTHORIZED'});
 await recordStandingReply(reply);
 assert.equal((await recordStandingReply(reply)).deduplicated,true);
 await assert.rejects(recordStandingReply({...reply,body:'Changed response'}),{code:'TOPOLOGY_REPLY_CONFLICT'});
 const done=await waitForReplies(waitArgs);assert.equal(done.ok,true);assert.equal(done.replies[0].body,'Durable response');assert.equal(done.replies[0].agent,'lead0001');assert.equal(done.replies[0].on_behalf_of,'worker01');
 assert.deepEqual(await pendingReplies(f.runDir,['worker01']),[]);
 const retry=await sendMessage({...f.input,fromProject:f.source,idempotencyKey:'barrier'});assert.equal(retry.id,sent.id);assert.equal(retry.deliveries[0].standing,true);
 assert.equal((await readStandingInbox({consumer:f.dest,agent:'lead0001',env:f.env,...f.standingOptions})).length,1);
});

test('standing reply cannot precede delivery or use a different launcher repository',async t=>{
 const f=await fixture(t);const {recordStandingReply}=await import('../../topology/lib/standing-mailbox.mjs');
 const sent=await sendMessage({...f.input,fromProject:f.source,standingOptions:{...f.standingOptions,readiness:async()=>({status:'unresponsive'})}});
 const input={consumer:f.dest,messageId:sent.holds[0].id,agentId:'lead0001',body:'reply',env:{...f.env,AO_AGENT_ID:'lead0001',AO_CONSUMER:f.dest}};
 await assert.rejects(recordStandingReply(input),{code:'TOPOLOGY_MESSAGE_UNDELIVERED'});
 await assert.rejects(recordStandingReply({...input,env:{...input.env,AO_CONSUMER:f.source}}),{code:'TOPOLOGY_AGENT_UNAUTHORIZED'});
});

test('missing durable envelope keeps pre-admission bridge pending after interrupted write',async t=>{
 const f=await fixture(t);const {waitForReplies}=await import('../../topology/lib/mailbox.mjs');
 const {standingMailboxRoot}=await import('../../topology/lib/standing-mailbox.mjs');
 const {createHash}=await import('node:crypto');
 const sent=await sendMessage({...f.input,fromProject:f.source,standingOptions:{...f.standingOptions,readiness:async()=>({status:'unresponsive'})}});
 const digest=createHash('sha256').update(sent.holds[0].id).digest('hex');
 await rm(join(standingMailboxRoot({env:f.env}),'messages',`${digest}.json`));
 const result=await waitForReplies({runDir:f.runDir,agentIds:['worker01'],messageId:sent.id,timeoutMs:10,pollMs:5});
 assert.equal(result.ok,false);assert.equal(result.pending[0].status,'missing');
});

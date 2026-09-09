import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendStandingMessage, resumeStandingMessages, readStandingInbox, readStandingOutbox } from '../../topology/lib/standing-mailbox.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { issueDelegation } from '../../topology/lib/routing.mjs';
import { writeJson, writeText } from '../../topology/lib/util.mjs';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'standing-mail-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'), consumer=join(root,'destination'), home=join(root,'home');
 await Promise.all([source,consumer,home].map(p=>mkdir(p,{recursive:true})));
 const opts={env:{AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')},home,
  readiness:async()=>({status:'responsive',record:{agent_id:'lead0001'},library_lead:'lead0001'})};
 for(const [id,role] of [['lead0001','lead'],['work0001','worker']]) {
  await writeJson(join(agentsRoot(consumer),id,'agent.json'),{id,role,full_name:id});
 }
 const message={id:'stable-id',consumer,fromProject:source,from:'send0001',to:'work0001',body:'full request body',task:'TM-1',via:['ancestor'],parentId:'original-message',provenance:{run:'nested-run',root:'root-run'}};
 return {root,source,consumer,opts,message};
}

test('durable hold automatically resumes to standing lead, preserves immutable content and ancestry',async t=>{
 const {consumer,opts,message}=await fixture(t);
 const held=await sendStandingMessage(message,{...opts,readiness:async()=>({status:'unresponsive'})});
 assert.equal(held.status,'held');assert.equal(held.reason,'leads_not_ready');
 assert.equal((await readStandingInbox({consumer,agent:'lead0001',...opts})).length,0);
 const [delivered]=await resumeStandingMessages({consumer,...opts});
 assert.equal(delivered.status,'delivered');assert.equal(delivered.delivered_to,'lead0001');
 assert.deepEqual(delivered.envelope,held.envelope);
 assert.deepEqual(delivered.delivered_via,['ancestor','lead0001']);
 assert.equal(delivered.envelope.to,'work0001');
 assert.equal((await readStandingInbox({consumer,agent:'lead0001',...opts})).length,1);
 assert.equal((await readStandingOutbox({consumer:message.fromProject,agent:message.from,...opts})).length,1);
 assert.deepEqual(await resumeStandingMessages({consumer,...opts}),[]);
});

test('concurrent retry uses one stable delivery and rejects changed body/provenance',async t=>{
 const {consumer,opts,message}=await fixture(t);
 const results=await Promise.all(Array.from({length:8},()=>sendStandingMessage(message,opts)));
 assert.equal(results.filter(r=>!r.deduplicated).length,1);
 assert.equal((await readStandingInbox({consumer,agent:'lead0001',...opts})).length,1);
 await assert.rejects(sendStandingMessage({...message,body:'changed'},opts),{code:'TOPOLOGY_MESSAGE_ID_CONFLICT'});
 await assert.rejects(sendStandingMessage({...message,via:[]},opts),{code:'TOPOLOGY_MESSAGE_ID_CONFLICT'});
});

test('source omission cannot bypass admission even with ready destination and permissive injected router',async t=>{
 const {consumer,opts,message}=await fixture(t);let routed=0;
 const record=await sendStandingMessage({...message,fromProject:undefined},{...opts,router:async()=>{routed++;return {resolved:'work0001',deliver_to:'work0001'}}});
 assert.equal(record.status,'held');assert.equal(record.reason,'source_identity_required');assert.equal(routed,0);
 const resumed=await resumeStandingMessages({consumer,...opts});assert.equal(resumed[0].status,'held');
});

test('canonical same repository alias uses internal routing without external readiness',async t=>{
 const {root,consumer,opts,message}=await fixture(t);const alias=join(root,'alias');await symlink(consumer,alias,'dir');
 const result=await sendStandingMessage({...message,fromProject:alias},{...opts,readiness:async()=>assert.fail('same repo requires no cross-repo readiness')});
 assert.equal(result.status,'delivered');assert.equal(result.delivered_to,'work0001');assert.equal(result.decision.reason,'same project');
});

test('held delegation revalidates receiving task store and redirects after revoked claim',async t=>{
 const {consumer,opts,message}=await fixture(t);
 const taskFile=join(consumer,'.bytedesk/task-management/tasks/TM-1-work.md');
 await writeText(taskFile,'---\nid: "TM-1"\nstatus: "in_progress"\nassignee: "work0001"\n---\n');
 const delegation=await issueDelegation(consumer,{task:'TM-1',external_agent:message.from,local_agent:'work0001',issued_by:'lead0001'});
 const withToken={...message,token:delegation.token};
 const held=await sendStandingMessage(withToken,{...opts,readiness:async()=>({status:'registered'})});assert.equal(held.status,'held');
 await writeText(taskFile,'---\nid: "TM-1"\nstatus: "done"\nassignee: "work0001"\n---\n');
 const [result]=await resumeStandingMessages({consumer,...opts});
 assert.equal(result.status,'delivered');assert.equal(result.delivered_to,'lead0001');assert.equal(result.decision.delegation_rejected.length,1);
 assert.equal((await readStandingInbox({consumer,agent:'work0001',...opts})).length,0);
});

test('ready direct delegation reaches worker outside every run roster',async t=>{
 const {consumer,opts,message}=await fixture(t);
 await writeText(join(consumer,'.bytedesk/task-management/tasks/TM-1-work.md'),'---\nid: "TM-1"\nstatus: "in_progress"\nassignee: "work0001"\n---\n');
 await issueDelegation(consumer,{task:'TM-1',external_agent:message.from,local_agent:'work0001',issued_by:'lead0001'});
 const result=await sendStandingMessage(message,opts);assert.equal(result.status,'delivered');assert.equal(result.delivered_to,'work0001');
 assert.equal((await readStandingInbox({consumer,agent:'work0001',...opts})).length,1);
});

test('hop loops and coordinator assignments remain held with request retained',async t=>{
 const {opts,message}=await fixture(t);
 for(const [id,change,reason] of [
  ['loop',{via:['lead0001']},'loop'],
  ['hops',{via:['a','b','c','d']},'hop_limit'],
  ['assignment',{stage:'implement'},'coordinator_not_worker'],
 ]) {const result=await sendStandingMessage({...message,...change,id},opts);assert.equal(result.status,'held');assert.equal(result.reason,reason);assert.equal(result.envelope.body,message.body)}
});

test('readiness must prove both source and destination with matching library lead',async t=>{
 const {opts,message}=await fixture(t);
 for(const blocked of [message.fromProject,message.consumer]){
  const result=await sendStandingMessage({...message,id:`blocked-${blocked}`},{...opts,readiness:async({consumer})=>consumer===blocked?{status:'responsive',record:{agent_id:'deleted'},library_lead:null}:opts.readiness()});
  assert.equal(result.status,'held');assert.equal(result.reason,'leads_not_ready');
 }
});

test('admission exception persists recoverable hold, concurrent resumes deliver once',async t=>{
 const {consumer,opts,message}=await fixture(t);
 const held=await sendStandingMessage(message,{...opts,router:async()=>{throw new Error('sensitive detail')}});
 assert.equal(held.status,'held');assert.equal(held.reason,'admission_error');assert.ok(!JSON.stringify(held).includes('sensitive detail'));
 await Promise.all(Array.from({length:6},()=>resumeStandingMessages({consumer,...opts})));
 const inbox=await readStandingInbox({consumer,agent:'lead0001',...opts});assert.equal(inbox.length,1);assert.equal(inbox[0].attempts,2);
});

test('nested standing forwarding preserves original provenance and cannot shorten ancestry',async t=>{
 const {consumer,opts,message}=await fixture(t);
 const {forwardStandingMessage}=await import('../../topology/lib/standing-mailbox.mjs');
 const first=await sendStandingMessage(message,opts);
 const second=await forwardStandingMessage({id:'child-id',parentId:first.envelope.id,consumer,fromProject:consumer,from:'lead0001',to:'work0001',via:[],provenance:{forged:true}},opts);
 assert.equal(second.status,'delivered');assert.equal(second.envelope.parentId,message.id);
 assert.deepEqual(second.envelope.via,['ancestor','lead0001']);assert.deepEqual(second.envelope.provenance,message.provenance);
 const third=await forwardStandingMessage({id:'grandchild',parentId:'child-id',consumer,fromProject:consumer,from:'work0001',to:'lead0001'},opts);
 assert.deepEqual(third.envelope.via,['ancestor','lead0001','work0001']);
 await assert.rejects(forwardStandingMessage({parentId:message.id,consumer,fromProject:message.fromProject,from:message.from,to:'work0001'},opts),{code:'TOPOLOGY_FORWARD_OWNER'});
});

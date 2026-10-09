import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sendStandingMessage, resumeStandingMessages, readStandingInbox, readStandingOutbox, readStandingMessage, standingMailboxRoot, wakeStandingMessages, withdrawStandingMessage } from '../../topology/lib/standing-mailbox.mjs';
import { leadRecoveryStatus, recoverLead, requestLeadRecovery } from '../../topology/lib/lead-recovery.mjs';
import { leadRegistryDir } from '../../topology/lib/lead.mjs';
import { lockHeld } from '../../topology/lib/lockfile.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { agentsRoot } from '../../topology/lib/agents.mjs';
import { issueDelegation } from '../../topology/lib/routing.mjs';
import { writeJson, writeText } from '../../topology/lib/util.mjs';

async function fixture(t) {
 const root=await mkdtemp(join(tmpdir(),'standing-mail-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'), consumer=join(root,'destination'), home=join(root,'home');
 await Promise.all([source,consumer,home].map(p=>mkdir(p,{recursive:true})));
 // TM-167: a clock the test moves, and recorders in place of lead recovery. A held message asks each
 // non-ready side to recover; these tests observe the request instead of writing real markers or
 // starting supervisors, and record whether the message lock was still held when it was made.
 const clock={t:Date.parse('2026-09-11T12:00:00.000Z')}, calls={requests:[],activations:[]};
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')};
 const lockOf=id=>join(standingMailboxRoot({env,home}),'locks',`${createHash('sha256').update(id).digest('hex')}.lock`);
 const opts={env,home,now:()=>clock.t,
  readiness:async()=>({status:'responsive',record:{agent_id:'lead0001'},library_lead:'lead0001'}),
  requestRecovery:async request=>{calls.requests.push({...request,messageLocked:await lockHeld(lockOf(request.messageId))});},
  activate:async activation=>{calls.activations.push(activation);return {enrollment:{enrolled:true},supervision:{started:false,reason:'test'}};},
  // Both fixture repositories count as enrolled unless a test says otherwise; the production
  // resolver would call them unenrolled, which the enrollment test below relies on.
  enrollment:async()=>({enrolled:true,source:'test'})};
 for(const [id,role] of [['lead0001','lead'],['work0001','worker']]) {
  await writeJson(join(agentsRoot(consumer),id,'agent.json'),{id,role,full_name:id});
 }
 const message={id:'stable-id',consumer,fromProject:source,from:'send0001',to:'work0001',body:'full request body',task:'TM-1',via:['ancestor'],parentId:'original-message',provenance:{run:'nested-run',root:'root-run'}};
 return {root,source,consumer,home,opts,message,clock,calls};
}
const READY={status:'responsive',record:{agent_id:'lead0001'},library_lead:'lead0001'};

test('held mail across an unenrolled repository names enrollment and never schedules a lead start',async t=>{
 const {root,consumer,opts,message,calls}=await fixture(t);
 const readiness=async()=>({status:'none'});
 for(const [id,unenrolled,reason] of [['to-unenrolled',consumer,'destination_not_enrolled'],['from-unenrolled',message.fromProject,'source_not_enrolled']]) {
  const held=await sendStandingMessage({...message,id},{...opts,readiness,enrollment:async({consumer:repo})=>({enrolled:repo!==unenrolled})});
  assert.deepEqual([held.status,held.reason,held.last_error,held.permanent],['held',reason,reason,false],'backed off like any retryable hold: enrollment can change');
  assert.equal(held.recovery,undefined,'no recovery is scheduled');
 }
 const unknown=await sendStandingMessage({...message,id:'resolver-failed'},{...opts,readiness,enrollment:async()=>{throw Object.assign(new Error('settings unreadable'),{code:'EACCES'});}});
 assert.equal(unknown.reason,'destination_not_enrolled','an enrollment that cannot be read is not enrollment');
 assert.deepEqual([calls.requests.length,calls.activations.length],[0,0],'no recovery request and no activation for an unenrolled side');
 // Enrollment decides who is given a lead, not whether a lead already proven responsive receives mail.
 const proven=await sendStandingMessage({...message,id:'proven-leads'},{...opts,enrollment:async()=>({enrolled:false})});
 assert.equal(proven.status,'delivered');
 // The production resolver, requester and activator. These fixture directories are not enrolled.
 const {enrollment:_resolver,requestRecovery:_requester,activate:_activator,...production}=opts;
 const real=await sendStandingMessage({...message,id:'production-path'},{...production,readiness});
 assert.equal(real.reason,'destination_not_enrolled');
 const {readdir}=await import('node:fs/promises');
 const state=await readdir(join(root,'state')).catch(()=>[]);
 assert.ok(!state.includes('leads') && !state.includes('supervision'),`an unenrolled repository gets no recovery request and no supervisor; state holds: ${state}`);
});

test('durable hold automatically resumes to standing lead, preserves immutable content and ancestry',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);
 const held=await sendStandingMessage(message,{...opts,readiness:async()=>({status:'unresponsive'})});
 assert.equal(held.status,'held');assert.equal(held.reason,'leads_not_ready');
 assert.equal((await readStandingInbox({consumer,agent:'lead0001',...opts})).length,0);
 clock.t+=10_000;
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
 const {consumer,opts,message,clock}=await fixture(t);let routed=0;
 const record=await sendStandingMessage({...message,fromProject:undefined},{...opts,router:async()=>{routed++;return {resolved:'work0001',deliver_to:'work0001'}}});
 assert.equal(record.status,'held');assert.equal(record.reason,'source_identity_required');assert.equal(routed,0);
 // TM-167: an immutable envelope with no source can never gain one, so the hold is permanent and
 // resume leaves it exactly as it is instead of re-checking it on every tick.
 assert.equal(record.permanent,true);clock.t+=3_600_000;
 assert.deepEqual(await resumeStandingMessages({consumer,...opts}),[]);
 const stored=await readStandingMessage({id:message.id,...opts});assert.equal(stored.status,'held');assert.equal(stored.attempts,1);
});

test('canonical same repository alias uses internal routing without external readiness',async t=>{
 const {root,consumer,opts,message}=await fixture(t);const alias=join(root,'alias');await symlink(consumer,alias,'dir');
 const result=await sendStandingMessage({...message,fromProject:alias},{...opts,readiness:async()=>assert.fail('same repo requires no cross-repo readiness')});
 assert.equal(result.status,'delivered');assert.equal(result.delivered_to,'work0001');assert.equal(result.decision.reason,'same project');
});

test('held delegation revalidates receiving task store and redirects after revoked claim',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);
 const taskFile=join(consumer,'.bytedesk/task-management/tasks/TM-1-work.md');
 await writeText(taskFile,'---\nid: "TM-1"\nstatus: "in_progress"\nassignee: "work0001"\n---\n');
 const delegation=await issueDelegation(consumer,{task:'TM-1',external_agent:message.from,local_agent:'work0001',issued_by:'lead0001'});
 const withToken={...message,token:delegation.token};
 const held=await sendStandingMessage(withToken,{...opts,readiness:async()=>({status:'registered'})});assert.equal(held.status,'held');
 await writeText(taskFile,'---\nid: "TM-1"\nstatus: "done"\nassignee: "work0001"\n---\n');
 clock.t+=10_000;
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
 ]) {const result=await sendStandingMessage({...message,...change,id},opts);assert.equal(result.status,'held');assert.equal(result.reason,reason);assert.equal(result.envelope.body,message.body);assert.equal(result.permanent,true);assert.equal(result.next_retry_at,null)}
});

test('readiness must prove both source and destination with matching library lead',async t=>{
 const {opts,message}=await fixture(t);
 for(const blocked of [message.fromProject,message.consumer]){
  const result=await sendStandingMessage({...message,id:`blocked-${blocked}`},{...opts,readiness:async({consumer})=>consumer===blocked?{status:'responsive',record:{agent_id:'deleted'},library_lead:null}:opts.readiness()});
  assert.equal(result.status,'held');assert.equal(result.reason,'leads_not_ready');
 }
});

test('admission exception persists recoverable hold, concurrent resumes deliver once',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);
 const held=await sendStandingMessage(message,{...opts,router:async()=>{throw new Error('sensitive detail')}});
 assert.equal(held.status,'held');assert.equal(held.reason,'admission_error');assert.ok(!JSON.stringify(held).includes('sensitive detail'));
 assert.equal(held.last_error,'admission_error: ERROR');assert.equal(held.permanent,false);
 clock.t+=10_000;
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

// ── TM-167: held mail drives receiver-owned lead recovery ──────────────────────────────────────

test('held cross-repository mail asks each non-ready side to recover, read-only and after the message lock',async t=>{
 const {consumer,opts,message,calls}=await fixture(t);
 const timeouts=[];
 const readyWhere=ready=>async({consumer:side,ackTimeoutMs})=>{timeouts.push(ackTimeoutMs);return ready(side)?READY:{status:'registered'};};
 for(const [id,ready,sides] of [
  ['destination-down',side=>side!==consumer,['destination']],
  ['source-down',side=>side===consumer,['source']],
  ['both-down',()=>false,['source','destination']],
 ]) {
  calls.requests.length=0;calls.activations.length=0;
  const held=await sendStandingMessage({...message,id},{...opts,readiness:readyWhere(ready)});
  assert.equal(held.reason,'leads_not_ready');
  assert.deepEqual(Object.keys(held.recovery),sides,`${id}: recovery is asked of exactly the non-ready sides`);
  const repos=sides.map(side=>side==='source'?message.fromProject:consumer);
  assert.deepEqual(calls.requests.map(r=>[r.consumer,r.messageId,r.reason]),repos.map(repo=>[repo,id,'leads_not_ready']));
  assert.deepEqual(calls.activations.map(a=>a.consumer),repos,'each side is activated so its own supervisor exists');
  assert.ok(calls.requests.every(r=>r.messageLocked===false),'recovery is never scheduled while the message lock is held');
 }
 assert.ok(timeouts.length>0 && timeouts.every(ms=>ms===0),`readiness under a message lock must never wait for a model turn: ${timeouts}`);
});

test('held mail backs off on the lead-recovery schedule, and resume honours it unless forced',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);let looks=0;
 const notReady=async()=>{looks++;return {status:'unresponsive'};};
 const o={...opts,readiness:notReady};
 const held=await sendStandingMessage(message,o);
 assert.deepEqual([held.attempts,held.last_error,held.permanent,held.next_retry_at],[1,'leads_not_ready',false,new Date(clock.t+10_000).toISOString()]);
 for(const [wait,next] of [[10_000,30_000],[30_000,120_000],[120_000,600_000],[600_000,600_000]]) {
  looks=0;clock.t+=wait-1;
  assert.deepEqual(await resumeStandingMessages({consumer,...o}),[],'not due yet');assert.equal(looks,0,'a message that is not due is not even looked at');
  clock.t+=1;
  const [retried]=await resumeStandingMessages({consumer,...o});
  assert.equal(retried.next_retry_at,new Date(clock.t+next).toISOString());
 }
 const [forced]=await resumeStandingMessages({consumer,force:true,...o});
 assert.equal(forced.attempts,6,'--force retries now');
});

test('a permanent hold is not retried every tick, not even when forced',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);let routed=0,looks=0;
 const o={...opts,router:async()=>{routed++;return {};},readiness:async()=>{looks++;return READY;}};
 const held=await sendStandingMessage({...message,id:'too-many-hops',via:['a','b','c','d']},o);
 assert.deepEqual([held.reason,held.permanent,held.next_retry_at],['hop_limit',true,null]);
 for(let tick=0;tick<5;tick++){clock.t+=600_000;assert.deepEqual(await resumeStandingMessages({consumer,...o}),[]);}
 assert.deepEqual(await resumeStandingMessages({consumer,force:true,...o}),[]);
 assert.equal((await readStandingMessage({id:'too-many-hops',...opts})).attempts,1);
 assert.deepEqual([routed,looks],[0,0]);
});

test('exactly one delivery with concurrent resumers and resends across a recovery',async t=>{
 const {consumer,opts,message,clock}=await fixture(t);
 let recovered=false;
 const readiness=async()=>{await new Promise(r=>setTimeout(r,2));return recovered?READY:{status:'registered'};};
 const o={...opts,readiness};
 assert.equal((await sendStandingMessage(message,o)).reason,'leads_not_ready');
 // Attempt 2: eight resumers race while the lead is still down. One re-holds it; the rest find it not
 // due under the message lock and leave it alone.
 clock.t+=10_000;
 const racing=(await Promise.all(Array.from({length:8},()=>resumeStandingMessages({consumer,...o})))).flat();
 assert.equal(racing.length,1);assert.equal(racing[0].attempts,2);assert.equal(racing[0].status,'held');
 // The recovery lands between attempts and makes the message due at once.
 recovered=true;
 assert.deepEqual(await wakeStandingMessages({ids:[message.id],...opts}),[message.id]);
 const results=(await Promise.all([
  ...Array.from({length:8},()=>resumeStandingMessages({consumer,...o})),
  sendStandingMessage(message,o),sendStandingMessage(message,o),
 ])).flat();
 const stored=await readStandingMessage({id:message.id,...opts});
 assert.equal(stored.status,'delivered');assert.equal(stored.attempts,3,'exactly one attempt delivered it');
 assert.equal((await readStandingInbox({consumer,agent:'lead0001',...opts})).length,1);
 assert.ok(results.filter(r=>r.status==='delivered').every(r=>r.delivered_at===stored.delivered_at),'every view names the one delivery');
 clock.t+=3_600_000;assert.deepEqual(await resumeStandingMessages({consumer,...o}),[]);
});

test('the supervisor that proves its lead responsive wakes the mail that asked, and only its own request is consumed',async t=>{
 const {consumer,source,home,opts,message,clock}=await fixture(t);
 const env=opts.env;
 const held=await sendStandingMessage(message,{...opts,requestRecovery:requestLeadRecovery,readiness:async()=>({status:'registered'})});
 assert.equal(held.next_retry_at,new Date(clock.t+10_000).toISOString());
 const identity=await canonicalRepoId(consumer);
 await writeJson(join(leadRegistryDir(env,home),`${repoKey(identity.id)}.json`),{version:1,repo_id:identity.id,agent_id:'lead0001',mode:'dedicated',managed:true,externally_owned:false,
  session:'lead',pane:'%1',binding:{serverKey:'/nonexistent',serverPid:1,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:1},consumer});
 const probed=[];
 const recovery=await recoverLead({consumer,env,home,now:()=>clock.t,enrollment:async()=>({enrolled:true,root:consumer}),
  probes:{alive:async()=>true,responsive:async(_record,ms)=>{probed.push(ms);return true;},open:()=>assert.fail('a responsive lead is not opened'),kill:()=>assert.fail('never kill')}});
 assert.equal(recovery.action,'reused');assert.deepEqual(recovery.woken,[message.id]);
 assert.ok(probed[0]>0,'the request licensed one active probe');
 assert.equal((await readStandingMessage({id:message.id,...opts})).next_retry_at,null);
 assert.equal((await leadRecoveryStatus({consumer,env,home})).pending_requests,0);
 assert.equal((await leadRecoveryStatus({consumer:source,env,home})).pending_requests,1,'the source repository request is its own supervisor\'s to consume');
 const [delivered]=await resumeStandingMessages({consumer,...opts});
 assert.equal(delivered.status,'delivered','woken mail is due without waiting out its backoff');
});

// TM-384 / ADR-0041. No test here touches tmux: the bell is injected (wake), so no server, real or
// isolated, is ever addressed.
const NL = String.fromCharCode(10);
const LEAD_BINDING = { serverKey: 'tm384-test-socket', serverPid: 11, sessionId: 's7', sessionCreated: 1700000000, paneId: 'p9', panePid: 12 };
function leadRing(rings, outcome = { rang: true }) {
  return {
    readiness: async ({ consumer: repo }) => repo.endsWith('destination') ? { status: 'unresponsive', record: { agent_id: 'lead0001' }, library_lead: 'lead0001' } : READY,
    readLead: async () => ({ record: { agent_id: 'lead0001', pane: 'p9', provider: 'claude', binding: LEAD_BINDING } }),
    loadAdapters: async () => new Map([['claude', { id: 'claude', composer: { empty_tmux_pattern: '^>' }, submit_keys: ['Enter'] }]]),
    wake: async (args) => { rings.push(args); return outcome; },
  };
}

test('held leads_not_ready mail rings an alive lead after one backoff, once per window, and records the outcome', async (t) => {
  const { consumer, opts, message, clock } = await fixture(t);
  const rings = []; const ring = { ...opts, ...leadRing(rings) };
  const held = await sendStandingMessage(message, ring);
  assert.deepEqual([held.status, held.reason, held.readiness.destination], ['held', 'leads_not_ready', 'unresponsive']);
  assert.equal(rings.length, 0, 'the first hold has not yet survived a recovery backoff');
  assert.equal(held.lead_ring, undefined);
  clock.t += 10_000;
  const [first] = await resumeStandingMessages({ consumer, ...ring });
  assert.equal(rings.length, 1, 'rang after one backoff');
  assert.equal(rings[0].pane, 'p9'); assert.deepEqual(rings[0].binding, LEAD_BINDING);
  assert.match(rings[0].text, /stable-id/); assert.match(rings[0].text, /mailbox inbox --consumer [^ ]+ --agent lead0001/);
  assert.deepEqual([first.status, first.lead_ring.rang, first.lead_ring.at, first.lead_ring.attempt], ['held', true, new Date(clock.t).toISOString(), 2]);
  assert.equal((await readStandingMessage({ id: message.id, ...opts })).lead_ring.rang, true, 'the outcome is durable on the record');
  const [again] = await resumeStandingMessages({ consumer, ...ring, force: true });
  assert.equal(rings.length, 1, 'at most once per backoff window, even when forced');
  assert.equal(again.lead_ring.at, first.lead_ring.at);
  clock.t += 120_000; // the forced resume was attempt 3, so the next resume is due 2m later
  await resumeStandingMessages({ consumer, ...ring });
  assert.equal(rings.length, 2, 'a new window may ring again');
});

test('a ring the bell refuses is recorded with its reason, and a lead not alive is never rung', async (t) => {
  const { consumer, opts, message, clock } = await fixture(t);
  const rings = []; const refused = { ...opts, ...leadRing(rings, { rang: false, reason: 'composer is not empty' }) };
  await sendStandingMessage(message, refused); clock.t += 10_000;
  const [result] = await resumeStandingMessages({ consumer, ...refused });
  assert.deepEqual([result.lead_ring.rang, result.lead_ring.reason], [false, 'composer is not empty']);
  const dead = [];
  const notAlive = { ...opts, ...leadRing(dead), readiness: async ({ consumer: repo }) => repo.endsWith('destination') ? { status: 'registered' } : READY };
  await sendStandingMessage({ ...message, id: 'dead-lead' }, notAlive); clock.t += 10_000;
  await resumeStandingMessages({ consumer, ...notAlive }); clock.t += 30_000;
  await resumeStandingMessages({ consumer, ...notAlive });
  assert.equal(dead.length, 0, 'only a lead whose record is alive is rung');
});

async function bindWorker({ consumer, opts }, task, worker) {
  const id = (await canonicalRepoId(consumer)).id;
  const state = dirname(standingMailboxRoot({ env: opts.env, home: opts.home }));
  await writeJson(join(state, 'management', repoKey(id), task + '.json'), { task, repo_id: id, started: true, worker });
}
const CODEX_WORKER = { name: 'codex-tm7', run: 'tmux:tm-TM-7', backend: 'tmux', kind: 'tmux', session_name: 'tm-TM-7', binding: LEAD_BINDING };

test('task address reaches the bound non-roster Codex worker instead of unknown_recipient', async (t) => {
  const f = await fixture(t); const { consumer, opts, message } = f;
  await bindWorker(f, 'TM-7', CODEX_WORKER);
  const same = { ...message, id: 'task-mail', fromProject: consumer, to: 'task:TM-7', task: 'TM-7' };
  const result = await sendStandingMessage(same, opts);
  assert.deepEqual([result.status, result.delivered_to, result.decision.task_address], ['delivered', 'codex-tm7', 'TM-7']);
  assert.equal((await readStandingInbox({ consumer, agent: 'codex-tm7', ...opts })).length, 1);
  const unbound = await sendStandingMessage({ ...same, id: 'task-unbound', to: 'task:TM-8', task: 'TM-8' }, opts);
  assert.deepEqual([unbound.status, unbound.reason, unbound.permanent], ['held', 'task_worker_unbound', false], 'no bound worker is a clear, retryable hold');
  await bindWorker(f, 'TM-9', { ...CODEX_WORKER, name: 'codex-tm9', stopped_at: '2026-10-05T00:00:00.000Z' });
  const stopped = await sendStandingMessage({ ...same, id: 'task-stopped', to: 'task:TM-9', task: 'TM-9' }, opts);
  assert.equal(stopped.reason, 'task_worker_unbound', 'a stopped worker is history');
});

test('cross-repo task address mail reaches the worker only under a delegation, otherwise the lead', async (t) => {
  const f = await fixture(t); const { consumer, opts, message } = f;
  await bindWorker(f, 'TM-7', CODEX_WORKER);
  const cross = { ...message, id: 'cross-task', to: 'task:TM-7', task: 'TM-7' };
  const redirected = await sendStandingMessage(cross, opts);
  assert.deepEqual([redirected.status, redirected.delivered_to, redirected.decision.redirected], ['delivered', 'lead0001', true]);
  const unbound = await sendStandingMessage({ ...cross, id: 'cross-unbound', to: 'task:TM-8', task: 'TM-8' }, opts);
  assert.equal(unbound.delivered_to, 'lead0001', 'cross-repo with no bound worker still goes to the lead');
  const frontmatter = ['---', 'id: TM-7', 'status: in_progress', 'assignee: codex-tm7', '---', ''].join(NL);
  await writeText(join(consumer, '.bytedesk/task-management/tasks/TM-7-work.md'), frontmatter);
  await issueDelegation(consumer, { task: 'TM-7', external_agent: message.from, local_agent: 'codex-tm7', issued_by: 'lead0001' });
  const direct = await sendStandingMessage({ ...cross, id: 'cross-delegated' }, opts);
  assert.deepEqual([direct.status, direct.delivered_to, direct.decision.redirected], ['delivered', 'codex-tm7', false]);
  const otherTask = await sendStandingMessage({ ...cross, id: 'cross-other-task', task: 'TM-1' }, opts);
  assert.equal(otherTask.delivered_to, 'lead0001', 'a delegation for TM-7 does not cover mail naming another task');
});

// ── TM-354: held mail launches or recovers the target repository's lead ───────────────────────────

test('a no_lead hold asks only the destination to recover its lead', async t => {
 const {consumer,opts,message,calls}=await fixture(t);
 const held=await sendStandingMessage({...message,id:'no-lead'},{...opts,router:async()=>({blocked:'no_lead',reason:'no lead'})});
 assert.equal(held.reason,'no_lead');
 assert.equal(held.permanent,false,'a lead can end this hold, so it is retried');
 assert.deepEqual(Object.keys(held.recovery??{}),['destination']);
 assert.deepEqual(calls.requests.map(r=>[r.consumer,r.messageId,r.reason]),[[consumer,'no-lead','no_lead']]);
 assert.deepEqual(calls.activations.map(a=>a.consumer),[consumer]);
});

test('no_lead mail launches exactly one lead across repeated triggers and is delivered once it is proven ready', async t => {
 const root=await mkdtemp(join(tmpdir(),'standing-no-lead-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'), consumer=join(root,'destination'), home=join(root,'home');
 await Promise.all([source,consumer,home].map(p=>mkdir(p,{recursive:true})));
 const env={AGENT_ORCHESTRATION_STATE_HOME:join(root,'state'),XDG_CONFIG_HOME:join(home,'.config')};
 const pluginRoot=new URL('../..',import.meta.url).pathname;
 // The destination has a worker and no lead, so external contact for the worker is refused as no_lead.
 await writeJson(join(agentsRoot(consumer),'work0001','agent.json'),{id:'work0001',role:'worker',full_name:'Worker'});
 let opens=0, responsive=false;
 const probes={alive:async()=>true,responsive:async()=>responsive,pane:async()=>'%1',kill:()=>assert.fail('never kill'),
  open:async()=>{opens++;await new Promise(r=>setTimeout(r,5));return {session:'ao-lead',pane:'%1',binding:{serverKey:'/nonexistent',serverPid:1,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:100+opens}};}};
 const {leadState}=await import('../../topology/lib/lead.mjs');
 const enrollment=async({consumer:c})=>({enrolled:true,root:c});
 const sourceReady={status:'responsive',record:{agent_id:'srclead1'},library_lead:'srclead1'};
 const opts={env,home,pluginRoot,enrollment,requestRecovery:requestLeadRecovery,activate:async()=>({enrollment:{enrolled:true}}),
  readiness:async args=>args.consumer===source?sourceReady:leadState({...args,probes})};
 const base={consumer,fromProject:source,from:'send0001',to:'work0001',body:'please'};
 // The readiness gate passes (as when a stale registration answers), and the router finds no library lead.
 const gatePassed={...opts,readiness:async()=>sourceReady};
 for(const id of ['m1','m2']) assert.equal((await sendStandingMessage({...base,id},gatePassed)).reason,'no_lead');
 assert.equal((await leadRecoveryStatus({consumer,env,home})).pending_requests,2);
 // Six supervisor ticks race on the same requests: one lead is launched.
 const tick=(extra={})=>recoverLead({consumer,env,home,pluginRoot,probes,enrollment,ackTimeoutMs:0,...extra});
 const raced=await Promise.all(Array.from({length:6},()=>tick()));
 assert.equal(opens,1,`one lead, not ${opens}: ${JSON.stringify(raced.map(r=>r.action))}`);
 assert.equal(raced.filter(r=>r.action==='created').length,1);
 // Proven ready after the backoff: the tick wakes both held messages, and resume delivers them.
 responsive=true;
 const proven=await tick({now:()=>Date.now()+3_600_000});
 assert.equal(proven.action,'reused');assert.deepEqual([...proven.woken].sort(),['m1','m2']);
 const resumed=await resumeStandingMessages({consumer,...opts});
 const lead=(await leadState({consumer,env,home,pluginRoot,probes,ackTimeoutMs:0})).record.agent_id;
 assert.deepEqual(resumed.map(r=>[r.envelope.id,r.status,r.delivered_to]).sort(),[['m1','delivered',lead],['m2','delivered',lead]]);
 assert.equal(opens,1,'delivery launched nothing more');
});

test('TM-478: the sender withdraws held mail with one verb, only its own, and the TM-384 ring stops for it', async (t) => {
  const { consumer, source, opts, message, clock } = await fixture(t);
  const rings = []; const ring = { ...opts, ...leadRing(rings) };
  await sendStandingMessage(message, ring); clock.t += 10_000;
  await resumeStandingMessages({ consumer, ...ring });
  assert.equal(rings.length, 1, 'held mail rings the lead before it is withdrawn');
  await assert.rejects(withdrawStandingMessage({ id: message.id, agent: 'someone-else', consumer: source, ...opts }), { code: 'TOPOLOGY_SENDER_MISMATCH' });
  await assert.rejects(withdrawStandingMessage({ id: message.id, agent: message.from, consumer, ...opts }), { code: 'TOPOLOGY_SENDER_MISMATCH' }, 'the right name from another repository is not the sender');
  const withdrawn = await withdrawStandingMessage({ id: message.id, agent: message.from, consumer: source, reason: 'sent to the wrong lead', ...opts });
  assert.deepEqual([withdrawn.status, withdrawn.permanent, withdrawn.withdrawn_reason], ['withdrawn', true, 'sent to the wrong lead']);
  clock.t += 3_600_000;
  const after = await resumeStandingMessages({ consumer, ...ring, force: true });
  assert.equal(rings.length, 1, 'no ring for a withdrawn message, even when forced');
  assert.equal(after.length, 0, 'and resume never retries it');
  assert.equal((await readStandingMessage({ id: message.id, ...opts })).status, 'withdrawn');
  assert.equal((await withdrawStandingMessage({ id: message.id, agent: message.from, consumer: source, ...opts })).status, 'withdrawn', 'withdrawing twice is a no-op');
  const delivered = await sendStandingMessage({ ...message, id: 'admitted' }, { ...opts, readiness: async () => READY });
  assert.equal(delivered.status, 'delivered');
  await assert.rejects(withdrawStandingMessage({ id: 'admitted', agent: message.from, consumer: source, ...opts }), { code: 'TOPOLOGY_WITHDRAW_NOT_HELD' });
  await assert.rejects(withdrawStandingMessage({ id: 'nope', agent: message.from, consumer: source, ...opts }), { code: 'TOPOLOGY_SENDER_MISMATCH' }, 'an unknown id answers exactly like a foreign one');
  const resent = await sendStandingMessage(message, ring);
  assert.deepEqual([resent.status, resent.deduplicated], ['withdrawn', true], 'resending a withdrawn id never revives it');
  assert.equal(rings.length, 1);
});

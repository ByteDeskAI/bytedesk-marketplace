import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureLead, assignLead, detachLead, leadState, leadNonceAck, leadRegistryDir, readLeadRegistration, responsiveForTest, pendingLeadProbes } from '../../topology/lib/lead.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { run, readJson, writeJson, exists } from '../../topology/lib/util.mjs';
const pluginRoot=fileURLToPath(new URL('../..',import.meta.url));
const BINDING = { serverKey: '/isolated/lead-test', serverPid: 100, sessionId: '$1', sessionCreated: 200, paneId: '%2', panePid: 300 };

async function readinessFixture(t) {
 const root = await mkdtemp(join(tmpdir(), 'ao-lead-ready-'));
 t.after(() => rm(root, { recursive: true, force: true }));
 const consumer = join(root, 'repo'), home = join(root, 'home');
 await run('git', ['init', consumer]);
 const env = { XDG_CONFIG_HOME: join(home, '.config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), AO_AGENT_ID: 'lead0001' };
 const identity = await canonicalRepoId(consumer);
 const registryDir = leadRegistryDir(env, home);
 const record = { repo_id: identity.id, agent_id: env.AO_AGENT_ID, session: 'lead', pane: BINDING.paneId, consumer, provider: 'claude', binding: { ...BINDING } };
 const recordPath = join(registryDir, `${repoKey(identity.id)}.json`);
 return { consumer, home, env, record, recordPath, registryDir, dir: join(registryDir, 'probes') };
}

test('read-only lead readiness preserves missing, invalid and valid acknowledgement evidence', async t => {
 const f = await readinessFixture(t);
 await writeJson(f.recordPath, f.record);
 const options = { ...f, readOnly: true, ackTimeoutMs: 1000, probes: { alive: async () => true } };
 assert.equal((await leadState(options)).status, 'unresponsive');
 assert.equal(await exists(f.dir), false, 'read-only diagnostics mint no probe directory');
 const nonce = 'read-only-lead-proof';
 const probe = { nonce, repo_id: f.record.repo_id, agent_id: f.record.agent_id, session: f.record.session, binding: BINDING, expires_at: Date.now() + 60000 };
 const snapshot = async () => Promise.all((await readdir(f.dir)).sort().map(async name => {
   const path = join(f.dir, name), metadata = await stat(path);
   return { name, contents: await readFile(path, 'utf8'), mtime: metadata.mtimeMs, ctime: metadata.ctimeMs };
 }));
 await writeJson(join(f.dir, `${nonce}.json`), probe);
 for (const [ack, expected] of [[{ ...probe, binding: { ...BINDING, panePid: 999 } }, 'unresponsive'], [probe, 'responsive']]) {
   await writeJson(join(f.dir, `${nonce}.ack.json`), ack);
   const before = await snapshot();
   assert.equal((await leadState(options)).status, expected);
   assert.deepEqual(await snapshot(), before, 'screening cannot consume, rewrite, or replace proof files');
   assert.equal(await exists(join(f.dir, `${f.record.agent_id}.answered.json`)), false, 'screening cannot publish a memo');
 }
});

test('lead readiness stores an exact-incarnation proof and rejects stale or unbound memos', async t => {
 const f = await readinessFixture(t);
 const options = { registryDir: f.registryDir, alive: async () => true, wake: async (_record, nonce) => {
   const probe = await readJson(join(f.dir, `${nonce}.json`));
   assert.deepEqual(probe.binding, BINDING);
   assert.equal(probe.session, f.record.session);
   assert.equal(probe.purpose, 'readiness');
   await writeJson(join(f.dir, `${nonce}.ack.json`), probe);
 } };
 assert.equal(await responsiveForTest(f.record, 50, options), true);
 const memoPath = join(f.dir, `${f.record.agent_id}.answered.json`);
 const memo = await readJson(memoPath);
 assert.deepEqual(memo.binding, BINDING);
 assert.equal(memo.repo_id, f.record.repo_id);
 assert.equal(memo.session, f.record.session);
 assert.equal(await responsiveForTest(f.record, 0, options), true);
 assert.equal(await responsiveForTest(f.record, 0, { ...options, alive: async () => false }), false, 'cached readiness never substitutes for live identity');
 for (const field of Object.keys(BINDING)) {
   const changed = { ...f.record, binding: { ...BINDING, [field]: `${BINDING[field]}-reused` } };
   assert.equal(await responsiveForTest(changed, 0, options), false, `${field} is part of the proof`);
 }
 for (const binding of [null, {}, { paneId: BINDING.paneId }]) {
   await writeJson(memoPath, { ...memo, binding });
   assert.equal(await responsiveForTest(f.record, 0, options), false, 'legacy unbound proof is never reused');
 }
 await writeJson(memoPath, { ...memo, repo_id: 'another-repository' });
 assert.equal(await responsiveForTest(f.record, 0, options), false);
});

test('lead late acknowledgements require matching challenge and acknowledgement incarnations', async t => {
 const f = await readinessFixture(t);
 const options = { registryDir: f.registryDir, alive: async () => true, wake: async () => assert.fail('read-only screening cannot wake') };
 const nonce = 'late-lead-proof';
 const base = { nonce, repo_id: f.record.repo_id, agent_id: f.record.agent_id, session: f.record.session, binding: { ...BINDING }, expires_at: Date.now() + 60000 };
 const cases = [
   [{ ...base, binding: null }, base],
   [base, { ...base, binding: null }],
   [{ ...base, binding: { ...BINDING, panePid: 999 } }, base],
   [base, { ...base, binding: { ...BINDING, sessionCreated: 999 } }],
   [{ ...base, nonce: 'another-nonce' }, base],
   [base, { ...base, session: 'another-session' }],
 ];
 for (const [probe, ack] of cases) {
   await writeJson(join(f.dir, `${nonce}.json`), probe);
   await writeJson(join(f.dir, `${nonce}.ack.json`), ack);
   assert.equal(await responsiveForTest(f.record, 0, options), false);
   assert.equal(await exists(join(f.dir, `${f.record.agent_id}.answered.json`)), false);
 }
 await writeJson(join(f.dir, `${nonce}.json`), base);
 await writeJson(join(f.dir, `${nonce}.ack.json`), base);
 let observations = 0;
 assert.equal(await responsiveForTest(f.record, 0, { ...options, alive: async () => ++observations === 1 }), false, 'an incarnation that disappears after reading the late ack is not ready');
 assert.equal(await exists(join(f.dir, `${f.record.agent_id}.answered.json`)), false);
 await writeJson(join(f.dir, `${nonce}.json`), base);
 await writeJson(join(f.dir, `${nonce}.ack.json`), base);
 assert.equal(await responsiveForTest(f.record, 0, options), true);
});

test('lead refuses acknowledgement after its candidate binding changes during the probe', async t => {
 const f = await readinessFixture(t);
 assert.equal(await responsiveForTest(f.record, 50, { registryDir: f.registryDir, alive: async () => true, wake: async (record, nonce) => {
   const probe = await readJson(join(f.dir, `${nonce}.json`));
   await writeJson(join(f.dir, `${nonce}.ack.json`), probe);
   record.binding.panePid++;
 } }), false);
 assert.equal(await exists(join(f.dir, `${f.record.agent_id}.answered.json`)), false, 'changed incarnation cannot become a remembered proof');
});

test('lead ack validates current registration and records the complete tuple', async t => {
 const f = await readinessFixture(t);
 await writeJson(f.recordPath, f.record);
 const nonce = 'registered-lead-proof';
 const probe = { nonce, repo_id: f.record.repo_id, agent_id: f.record.agent_id, session: f.record.session, binding: { ...BINDING }, expires_at: Date.now() + 60000 };
 const probePath = join(f.dir, `${nonce}.json`), ackPath = join(f.dir, `${nonce}.ack.json`);
 await writeJson(probePath, probe);
 assert.equal((await leadNonceAck({ ...f, nonce, alive: async () => true })).ok, true);
 const ack = await readJson(ackPath);
 assert.deepEqual(ack.binding, BINDING);
 assert.equal(ack.session, f.record.session);
 await rm(ackPath);
 await writeJson(f.recordPath, { ...f.record, binding: { ...BINDING, panePid: 999 } });
 assert.deepEqual(await pendingLeadProbes(f), [], 'old-incarnation challenges are not offered to the recovered lead');
 await assert.rejects(leadNonceAck({ ...f, nonce, alive: async () => true }), { code: 'TOPOLOGY_LEAD_PROBE_OWNER' });
 assert.equal(await exists(ackPath), false);
 await writeJson(f.recordPath, f.record);
 await assert.rejects(leadNonceAck({ ...f, nonce, alive: async () => false }), { code: 'TOPOLOGY_LEAD_PROBE_OWNER' });
 await writeJson(probePath, { ...probe, binding: null });
 await assert.rejects(leadNonceAck({ ...f, nonce, alive: async () => true }), { code: 'TOPOLOGY_LEAD_PROBE_OWNER' });
 await writeJson(probePath, probe);
 await rm(f.recordPath);
 await assert.rejects(leadNonceAck({ ...f, nonce, alive: async () => true }), { code: 'TOPOLOGY_LEAD_PROBE_OWNER' });
});

test('lead assignment can prove an unregistered candidate but cannot register a changed incarnation', async t => {
 const f = await readinessFixture(t);
 const base = { consumer: f.consumer, home: f.home, env: f.env, pluginRoot };
 const created = await ensureLead({ ...base, probes: { alive: async () => true, responsive: async () => true, open: async () => ({ session: 'dedicated', pane: BINDING.paneId, binding: { ...BINDING } }) } });
 await detachLead(base);
 const alive = async candidate => {
   assert.equal(candidate.consumer, f.consumer);
   assert.ok(candidate.provider);
   assert.deepEqual(candidate.binding, BINDING);
   return true;
 };
 const probes = { binding: async () => ({ ...BINDING }), alive, responsive: async (candidate, timeout, options) => {
   assert.equal(options.assignment, true);
   assert.equal(await readLeadRegistration(base), null, 'assignment proof precedes registration');
   return responsiveForTest(candidate, timeout, { registryDir: f.registryDir, alive, assignment: options.assignment, wake: async (_record, nonce) => {
     const challenge = await readJson(join(f.dir, `${nonce}.json`));
     assert.equal(challenge.purpose, 'assignment');
     await leadNonceAck({ ...base, nonce, env: { ...f.env, AO_AGENT_ID: candidate.agent_id }, alive: async target => {
       assert.deepEqual(target.binding, BINDING);
       return true;
     } });
   } });
 } };
 const opts = { ...base, agentRef: created.record.agent_id, session: 'assigned', ackTimeoutMs: 50, probes };
 const assigned = await assignLead(opts);
 assert.equal(assigned.action, 'assigned');
 assert.deepEqual(assigned.record.binding, BINDING);
 await detachLead(base);
 await assert.rejects(assignLead({ ...opts, probes: { ...probes, responsive: async candidate => { candidate.binding.panePid++; return true; } } }), { code: 'TOPOLOGY_LEAD_HANDSHAKE_REQUIRED' });
 assert.equal(await readLeadRegistration(base), null);
 let observed = 0;
 await assert.rejects(assignLead({ ...opts, probes: { ...probes, alive: async () => ++observed === 1, responsive: async () => true } }), { code: 'TOPOLOGY_LEAD_HANDSHAKE_REQUIRED' });
 assert.equal(await readLeadRegistration(base), null);
});

test('concurrent shared-worktree ensure converges, distinguishes dead and unresponsive, and preserves external assignment',async t=>{
 const root=await mkdtemp(join(tmpdir(),'ao-lead-')); t.after(()=>rm(root,{recursive:true,force:true}));
 const repo=join(root,'repo'), linked=join(root,'linked'), home=join(root,'home');
 await run('git',['init',repo]); await run('git',['-C',repo,'-c','user.name=Test','-c','user.email=test@example.invalid','commit','--allow-empty','-m','init']); await run('git',['-C',repo,'worktree','add','-b','linked',linked]);
 const env={XDG_CONFIG_HOME:join(home,'.config'),AGENT_ORCHESTRATION_STATE_HOME:join(root,'state')};
 let opens=0, alive=true, responsive=true;
 const probes={alive:async()=>alive,responsive:async()=>responsive,binding:async()=>({...BINDING}),pane:async()=>'%2',open:async()=>{opens++; await new Promise(r=>setTimeout(r,10)); return {session:'test-lead',pane:'%2',binding:{...BINDING}};},kill:()=>assert.fail('must not kill')};
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

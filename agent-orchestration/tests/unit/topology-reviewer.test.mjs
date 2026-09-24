import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { ensureReviewer, reviewerAvailability, reviewerPaths, reviewerNonceAck, reviewerProbeReady, recordReview, reviewEligibility, requestReview, collectReview, collectPendingReviews, reviewerInboxRoot, assignReviewer } from '../../topology/lib/reviewer.mjs';

const binding={serverKey:'/test/socket',serverPid:10,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:20};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-reviewer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  await mkdir(consumer); await run('git', ['init', '-q', consumer]);
  await run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base']);
  const revision = (await run('git', ['-C', consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'codex', instructions: 'Review independently.' } }, management: { reviewer_providers: ['codex', 'claude'] } });
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const { canonicalRepoId, repoKey } = await import('../../topology/lib/repoid.mjs');
  const identity = await canonicalRepoId(consumer);
  const managementPath = join(env.AGENT_ORCHESTRATION_STATE_HOME, 'management', repoKey(identity.id), 'TM-1.json');
  const management = { started: true, task: 'TM-1', owner: 'author', repo_id: identity.id, base_revision: revision, finish: { revision } };
  await writeJson(managementPath, management);
  return { consumer, pluginRoot, home, env, revision, managementPath, management };
}

test('eight ensures converge and restart preserves reviewer identity', async t => {
  const f = await fixture(t); let opens = 0, alive = false;
  const probes = { alive: async () => alive, open: async () => { opens++; alive = true; return { session: 'review', pane: '%1', binding: { paneId: '%1' } }; } };
  const results = await Promise.all(Array.from({ length: 8 }, () => ensureReviewer({ ...f, probes })));
  assert.equal(opens, 1); assert.equal(new Set(results.map(r => r.record.agent_id)).size, 1);
  assert.equal(results[0].record.binding.paneId, '%1');
  alive = false; const restarted = await ensureReviewer({ ...f, probes });
  assert.equal(restarted.record.agent_id, results[0].record.agent_id); assert.equal(opens, 2);
});

test('alive reviewer is unavailable without nonce; only current reviewer can acknowledge', async t => {
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', pane: '%1', binding }) } });
  assert.equal((await reviewerAvailability({ ...f, probes: { alive: async () => true, responsive: async () => false } })).available, false);
  const ready = await reviewerProbeReady({ ...f, record, alive: async () => true, timeoutMs: 500, onProbe: async p => {
    await assert.rejects(reviewerNonceAck({ ...f, alive: async () => true, nonce: p.nonce, env: { ...f.env, AO_AGENT_ID: 'author' } }), { code: 'TOPOLOGY_REVIEWER_ACK_OWNER' });
    await reviewerNonceAck({ ...f, alive: async () => true, nonce: p.nonce, env: { ...f.env, AO_AGENT_ID: record.agent_id } });
  } });
  assert.equal(ready, true);
});

test('read-only reviewer readiness neither rings nor consumes missing, invalid or valid proof', async t => {
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', pane: binding.paneId, binding }) } });
  const dir = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'probes');
  const options = { ...f, record, readOnly: true, alive: async () => true,
    wake: async () => assert.fail('diagnostics cannot ring'), output: async () => assert.fail('diagnostics cannot collect output'),
    onProbe: async () => assert.fail('diagnostics cannot mint probes') };
  assert.equal(await reviewerProbeReady(options), false);
  assert.deepEqual(await readdir(dir).catch(() => []), []);
  const nonce = 'read-only-reviewer-proof';
  const probe = { nonce, repo_id: record.repo_id, agent_id: record.agent_id, session: record.session, binding, expires_at: Date.now() + 60000 };
  const snapshot = async () => Promise.all((await readdir(dir)).sort().map(async name => {
    const path = join(dir, name), metadata = await stat(path);
    return { name, contents: await readFile(path, 'utf8'), mtime: metadata.mtimeMs, ctime: metadata.ctimeMs };
  }));
  await writeJson(join(dir, `${nonce}.json`), probe);
  for (const [ack, expected] of [[{ ...probe, binding: { ...binding, panePid: 999 } }, false], [probe, true]]) {
    await writeJson(join(dir, `${nonce}.ack.json`), ack);
    const before = await snapshot();
    assert.equal(await reviewerProbeReady(options), expected);
    assert.deepEqual(await snapshot(), before, 'proof remains unchanged for the supervising producer to collect');
  }
});

test('review record rejects impersonation, self review, findings and abbreviated commits', async t => {
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const args = { ...f, task: 'TM-1', reviewerId: record.agent_id, authorAgentIds: ['author'], verdict: 'approve', env: { ...f.env, AO_AGENT_ID: record.agent_id } };
  await assert.rejects(recordReview({ ...args, reviewerId: 'stranger' }), { code: 'TOPOLOGY_REVIEWER_IDENTITY' });
  await assert.rejects(recordReview({ ...args, authorAgentIds: [record.agent_id] }), { code: 'TOPOLOGY_REVIEWER_CONFLICT' });
  await assert.rejects(recordReview({ ...args, findings: ['fix bug'] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(recordReview({ ...args, revision: f.revision.slice(0, 8) }), { code: 'TOPOLOGY_REVIEWER_REVISION_REQUIRED' });
  await recordReview(args);
  const gate = { ...f, task: 'TM-1', authorAgentIds: ['author'], probes: { alive: async () => true, responsive: async () => true } };
  const uncollected = await reviewEligibility(gate);
  assert.equal(uncollected.eligible, false);
  assert.ok(uncollected.reasons.some(reason => reason.includes('not collected')));
  const request = await requestReview({ ...args, wake: async () => ({rang:false}) });
  await collectReview({ ...args, output: async () => `AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}` });
  assert.equal((await reviewEligibility(gate)).eligible, true);
  assert.equal((await reviewEligibility({ ...gate, revision: '0'.repeat(40) })).eligible, false);
  const paths = await reviewerPaths(f.consumer, f.env, f.home);
  await writeJson(paths.recordPath, { ...record, agent_id: 'replacement' });
  assert.equal((await reviewEligibility(gate)).eligible, false);
});

test('host collects nonce-bound read-only output and rejects forged response nonces', async t => {
  const { requestReview, collectReview, buildReviewerArgv, independentReviewStatus } = await import('../../topology/lib/reviewer.mjs');
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'] });
  assert.equal((await independentReviewStatus({...f,task:'TM-1'})).status,'awaiting-review');
  const repeated = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'] });
  assert.equal(request.nonce, repeated.nonce);
  await assert.rejects(collectReview({ ...f, task: 'TM-1', output: async () => 'AO_REVIEW forged {"verdict":"approve","findings":[]}' }), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  const review = await collectReview({ ...f, task: 'TM-1', output: async () => `AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}` });
  assert.equal(review.reviewer_id, record.agent_id); assert.equal(review.verified_commit, f.revision);
  assert.equal((await independentReviewStatus({...f,task:'TM-1'})).status,'approved');
  assert.equal((await collectReview({...f,task:'TM-1',output:async()=>{throw new Error('collected output must not be read again');}})).request_nonce,request.nonce);
  assert.throws(() => buildReviewerArgv({ id: 'claude' }, { args: ['--dangerously-skip-permissions'] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
  assert.throws(() => buildReviewerArgv({ id: 'codex' }, { args: [], env: {}, mcp: [] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
  const adapter = { id: 'claude', command: 'claude', args: [], model_args: [], system_prompt_args: [], add_dir_args: ['--add-dir', '{{dir}}'] };
  const argv = buildReviewerArgv(adapter, { args: [], env: {}, mcp: [] }, {}, { consumer: f.consumer });
  assert.ok(argv.includes('--restricted')); assert.ok(argv.includes('--strict-mcp-config')); assert.ok(!argv.includes('--dangerously-skip-permissions'));
});

test('TM-214: the reviewer stays read-only even though every other agent now defaults to auto_approve', async () => {
  const { buildReviewerArgv } = await import('../../topology/lib/reviewer.mjs');
  const { loadAdapters } = await import('../../topology/lib/providers.mjs');
  const claude = (await loadAdapters([new URL('../../providers', import.meta.url).pathname])).get('claude');
  assert.ok(claude.auto_approve_args.includes('--dangerously-skip-permissions'), 'the real adapter must carry the flag, or this test proves nothing');
  // auto_approve: true is what createAgent now stores for a reviewer whose template omits the key.
  const argv = buildReviewerArgv(claude, { args: [], env: {}, mcp: [], auto_approve: true }, {}, { consumer: '/repo' });
  assert.ok(argv.includes('--restricted'), argv.join(' '));
  assert.ok(argv.includes('--safe-mode'), argv.join(' '));
  assert.ok(!argv.includes('--dangerously-skip-permissions'), argv.join(' '));
});

test('concurrent review collectors record one response and replaced reviewer bindings require a fresh nonce',async t=>{
  const {requestReview,collectReview,independentReviewStatus}=await import('../../topology/lib/reviewer.mjs');
  const f=await fixture(t);
  const {record}=await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',binding})}});
  const options={...f,task:'TM-1',authorAgentIds:['author'],wake:async()=>({rang:false,reason:'test'})};
  const request=await requestReview(options);
  let captures=0;
  const output=async()=>{captures++;return `● AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}`;};
  const reviews=await Promise.all([collectReview({...options,output}),collectReview({...options,output})]);
  assert.equal(captures,1);assert.equal(reviews[0].request_nonce,reviews[1].request_nonce);
  const paths=await reviewerPaths(f.consumer,f.env,f.home);
  await writeJson(paths.recordPath,{...record,binding:{...binding,panePid:binding.panePid+1}});
  assert.equal((await independentReviewStatus(options)).status,'invalid');
  await assert.rejects(collectReview({...options,output}),{code:'TOPOLOGY_REVIEWER_IDENTITY'});
  const fresh=await requestReview(options);
  assert.notEqual(fresh.nonce,request.nonce);
  await assert.rejects(collectReview({...options,output}),{code:'TOPOLOGY_REVIEWER_RESPONSE'});
});

test('linked worktrees share reviewer identity and exact review evidence', async t => {
  const f = await fixture(t); const linked = join(f.home, 'linked'); await mkdir(f.home, { recursive: true });
  await run('git', ['-C', f.consumer, 'worktree', 'add', '--detach', linked]);
  const probes = { alive: async () => true, responsive: async () => true, open: async () => ({ session: 'review', binding }) };
  const { record } = await ensureReviewer({ ...f, probes });
  const second = await ensureReviewer({ ...f, consumer: linked, probes });
  assert.equal(second.record.agent_id, record.agent_id);
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'], wake: async () => ({rang:false}) });
  await collectReview({ ...f, consumer: linked, task: 'TM-1', output: async () => `AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}` });
  assert.equal((await reviewEligibility({ ...f, consumer: linked, task: 'TM-1', authorAgentIds: ['author'], probes })).eligible, true);
});

test('review covers harmful first commit and harmless final commit from trusted admission base', async t => {
  const { requestReview, collectReview } = await import('../../topology/lib/reviewer.mjs');
  const { readFile } = await import('node:fs/promises');
  const f = await fixture(t);
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const git = args => run('git', ['-C', f.consumer, ...args]);
  const commit = async (path, content, message) => {
    await writeFile(join(f.consumer, path), content); await git(['add', path]);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', message]);
    return (await git(['rev-parse', 'HEAD'])).stdout.trim();
  };
  const first = await commit('harmful.txt', 'unsafe change from commit A', 'harmful change');
  const finish = await commit('harmless.txt', 'benign comment from commit B', 'benign followup');
  await writeJson(f.managementPath, { ...f.management, finish: { revision: finish } });
  const opts = { ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'] };
  await assert.rejects(requestReview({ ...opts, baseRevision: first }), { code: 'TOPOLOGY_REVIEWER_RANGE' });
  const request = await requestReview(opts);
  assert.equal(request.base_revision, f.revision);
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /unsafe change from commit A/); assert.match(patch, /benign comment from commit B/);
  const review = await collectReview({ ...opts, output: async () => `AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}` });
  assert.equal(review.base_revision, f.revision); assert.equal(review.patch_sha256, request.patch_sha256);
  const probes = { alive: async () => true, responsive: async () => true };
  assert.equal((await reviewEligibility({ ...opts, probes })).eligible, true);
  await writeJson(f.managementPath, { ...f.management, base_revision: first, finish: { revision: finish } });
  assert.equal((await reviewEligibility({ ...opts, probes })).eligible, false, 'changing the admitted range invalidates an old approval');
  await assert.rejects(collectReview({ ...opts, output: async () => `AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}` }), { code: 'TOPOLOGY_REVIEWER_RANGE' });
});

test('reviewer prompt inputs are inside its explicit repo-scoped read-only grants', async t => {
  const { reviewerInboxRoot, reviewerProtocolPrompt, buildReviewerArgv, requestReview } = await import('../../topology/lib/reviewer.mjs');
  const f = await fixture(t);
  const { agent } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const inboxRoot = await reviewerInboxRoot(f.consumer, f.env, f.home);
  const prompt = reviewerProtocolPrompt(agent, f.consumer, inboxRoot);
  const adapter = { id: 'claude', command: 'claude', args: [], model_args: [], system_prompt_args: ['--append-system-prompt', '{{system_prompt}}'], add_dir_args: ['--add-dir', '{{dir}}'] };
  const argv = buildReviewerArgv(adapter, agent, { system_prompt: prompt }, { consumer: f.consumer, inboxRoot });
  const grants = argv.flatMap((arg, i) => arg === '--add-dir' ? [argv[i + 1]] : []);
  assert.deepEqual(grants, [f.consumer, inboxRoot]);
  assert.ok(prompt.includes(join(inboxRoot, 'probes'))); assert.ok(prompt.includes(join(inboxRoot, 'requests')));
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'] });
  assert.ok(request.path.startsWith(inboxRoot + '/')); assert.ok(request.patch_path.startsWith(inboxRoot + '/'));
  const sibling = join(f.home, 'other-repo'); await mkdir(sibling, { recursive: true });
  const siblingRoot = await reviewerInboxRoot(sibling, f.env, f.home);
  assert.notEqual(siblingRoot, inboxRoot); assert.ok(!grants.some(path => siblingRoot.startsWith(path + '/')));
});

// ── TM-187: the reviewer's half of the zero-width late-ack window ────────────
// The lead and the reviewer each computed the probe's `expires_at` and their own wait deadline from
// one number. For the reviewer the loop ran `while (Date.now() <= probe.expires_at)`, so the
// `expired` test in its `finally` was true BY CONSTRUCTION on every timeout and deleted the probe —
// while the comment above it said "Only a probe that was ANSWERED, or one nobody can answer any
// more, is removed here". A reviewer that was mid-review when the ring landed answered at its next
// boundary into a file that no longer existed. Rule 3 of verification-that-can-fail.md: a guard
// present in one verb and absent in its sibling is worse than no guard.
//
// The measurement is WHICH files survive the wait, and whether the ack the reviewer then runs is
// accepted — not merely that the probe returned false.
test('a reviewer probe outlives its own wait, so a mid-review reviewer can still answer', async t => {
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', pane: '%1', binding }) } });
  const { readdir } = await import('node:fs/promises');

  // Nobody answers inside the wait: this is the busy reviewer, not an absent one.
  let minted = null;
  const began = Date.now();
  const ready = await reviewerProbeReady({ ...f, record, alive: async () => true, timeoutMs: 300, output: async () => '', wake: async () => {}, onProbe: async p => { minted = p; } });
  assert.equal(ready, false, 'no ack arrived inside the wait');
  assert.ok(Date.now() - began >= 300, 'and the wait actually elapsed');

  const dir = join(await (await import('../../topology/lib/reviewer.mjs')).reviewerInboxRoot(f.consumer, f.env, f.home), 'probes');
  const left = (await readdir(dir)).filter(n => n.startsWith(minted.nonce));
  assert.deepEqual(left, [`${minted.nonce}.json`], `the probe must survive the wait; found ${JSON.stringify(left)}`);

  // The reviewer answers at its next boundary, through the real ack verb with its own expiry check.
  await reviewerNonceAck({ ...f, alive: async () => true, nonce: minted.nonce, env: { ...f.env, AO_AGENT_ID: record.agent_id } });
  assert.equal(await reviewerProbeReady({ ...f, record, alive: async () => true, timeoutMs: 0, output: async () => '', wake: async () => {} }), true,
    'and the late answer counts on the next check');
});


test('same-name reviewer recovery rejects old and legacy readiness acknowledgements', async t => {
  const f = await fixture(t);
  const {record} = await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',pane:binding.paneId,binding})}});
  let probe;
  assert.equal(await reviewerProbeReady({...f,record,alive:async()=>true,timeoutMs:0,output:async()=>'',wake:async()=>{},onProbe:async p=>{probe=p;}}),false);
  await reviewerNonceAck({...f,nonce:probe.nonce,env:{...f.env,AO_AGENT_ID:record.agent_id},alive:async()=>true});
  const replacement={...record,binding:{...binding,panePid:binding.panePid+1}};
  await writeJson((await reviewerPaths(f.consumer,f.env,f.home)).recordPath,replacement);
  await assert.rejects(reviewerNonceAck({...f,nonce:probe.nonce,env:{...f.env,AO_AGENT_ID:record.agent_id},alive:async()=>true}),{code:'TOPOLOGY_REVIEWER_ACK_OWNER'});
  assert.equal(await reviewerProbeReady({...f,record:replacement,alive:async()=>true,timeoutMs:0,output:async()=>'',wake:async()=>{}}),false);
  const dir=join(await reviewerInboxRoot(f.consumer,f.env,f.home),'probes');
  const legacy={...probe,expires_at:Date.now()+10000}; delete legacy.binding;
  await writeJson(join(dir,`${probe.nonce}.json`),legacy);
  await writeJson(join(dir,`${probe.nonce}.ack.json`),legacy);
  assert.equal(await reviewerProbeReady({...f,record:replacement,alive:async()=>true,timeoutMs:0,output:async()=>'',wake:async()=>{}}),false);
});

test('reviewer readiness does not cache output when the observed incarnation ends', async t => {
  const f = await fixture(t);
  const {record}=await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',binding})}});
  let isAlive=true,nonce;
  assert.equal(await reviewerProbeReady({...f,record,alive:async()=>isAlive,timeoutMs:50,wake:async()=>{},onProbe:async p=>{nonce=p.nonce;},output:async()=>{isAlive=false;return `AO_REVIEWER_READY ${nonce}`;}}),false);
  assert.equal(await reviewerProbeReady({...f,record,alive:async()=>true,timeoutMs:0,wake:async()=>{},output:async()=>''}),false);
});

test('assignment observes binding before the default liveness probe and leaves external owners stopped', async t => {
  const f=await fixture(t);
  const socket=join(f.home,'reviewer-test.sock');
  await mkdir(f.home,{recursive:true});
  await run('tmux',['-S',socket,'new-session','-d','-s','review','sleep 60']);
  try {
    const {listServerPanes}=await import('../../topology/lib/tmux.mjs');
    const observed=(await listServerPanes({tmuxServer:socket}))[0];
    const {agent}=await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',pane:observed.paneId,binding:observed})}});
    await writeJson(join(agent._dir,'session.json'),{session:'review',binding:observed});
    const assigned=await assignReviewer({...f,agentRef:agent.id,session:'review',probes:{responsive:async record=>{
      assert.equal(record.provider,'codex');assert.equal(record.consumer,f.consumer);assert.equal(record.binding.panePid,observed.panePid);return true;
    }}});
    assert.equal(assigned.record.managed,false);
    await run('tmux',['-S',socket,'split-window','-d','-t','review','sleep 60']);
    await assert.rejects(assignReviewer({...f,agentRef:agent.id,session:'review',probes:{responsive:async()=>true}}),{code:'TOPOLOGY_REVIEWER_PANE_AMBIGUOUS'});
    await run('tmux',['-S',socket,'kill-server']);
    let opens=0;
    const held=await ensureReviewer({...f,probes:{open:async()=>{opens++;throw new Error('external reviewer must not be restarted');}}});
    assert.equal(held.status,'dead-external');assert.equal(opens,0);
  } finally { await run('tmux',['-S',socket,'kill-server'],{allowFailure:true}); }
});

test('automatic review collection skips retained history and rotates unanswered batches', async t => {
  const f=await fixture(t);
  await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',binding})}});
  const request=await requestReview({...f,task:'TM-1',authorAgentIds:['author'],wake:async()=>({rang:true})});
  const dir=join(await reviewerInboxRoot(f.consumer,f.env,f.home),'requests');
  await Promise.all(Array.from({length:105},(_,i)=>writeJson(join(dir,`000-history-${i}.json`),{collected_at:new Date().toISOString()})));
  const collected=await collectPendingReviews({...f,output:async()=>`AO_REVIEW ${request.nonce} {"verdict":"approve","findings":[]}`});
  assert.equal(collected.length,1);assert.equal(collected[0].state,'collected');
  await Promise.all(Array.from({length:101},(_,i)=>{
    const task=`PENDING-${String(i).padStart(3,'0')}`;
    return writeJson(join(dir,`${task}-${f.revision}.json`),{...request,task,delivery:{rang:true}});
  }));
  const first=await collectPendingReviews({...f,output:async()=>''});
  const second=await collectPendingReviews({...f,output:async()=>''});
  assert.equal(first.length,100);assert.equal(second.length,100);
  assert.ok(second.some(result=>result.task==='PENDING-100'),'later pending requests must be visited despite earlier unanswered requests');
});

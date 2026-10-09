import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { isolatedTmux, killOwnedServer } from '../helpers/isolated-tmux.mjs';
import { submitVerdict } from '../helpers/review-submit.mjs';
import { ensureReviewer, reviewerAvailability, reviewerPaths, reviewerNonceAck, reviewerProbeReady, recordReview, reviewEligibility, requestReview, collectReview, collectPendingReviews, reviewerInboxRoot, reviewsRoot, assignReviewer } from '../../topology/lib/reviewer.mjs';

// TM-427: panePid is this test process, so the real pane-ancestry proof passes for the "reviewer";
// a forged caller is simulated by walking from process.ppid, which does not descend from it.
const binding={serverKey:'/test/socket',serverPid:10,sessionId:'$1',sessionCreated:1,paneId:'%1',panePid:process.pid};
const forgedCaller={pid:process.ppid};

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-reviewer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  await mkdir(consumer); await run('git', ['init', '-q', consumer]);
  await run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'base']);
  const revision = (await run('git', ['-C', consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'codex', instructions: 'Review independently.' } }, management: { reviewer_providers: ['codex', 'claude'] } });
  // TM-471: pin the file transport here rather than inherit it from the suite preload. Without it
  // a bare `node --test` (or a host AO_TRANSPORT=nats) sends probes over the live NATS server, so
  // no probe file is ever minted and the late-ack tests fail on the operator's machine.
  const env = { ...process.env, AO_TRANSPORT: 'file', XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
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
    await assert.rejects(reviewerNonceAck({ ...f, alive: async () => true, nonce: p.nonce, env: { ...f.env, AO_AGENT_ID: 'author' }, callerProc: forgedCaller }), { code: 'TOPOLOGY_REVIEWER_ACK_OWNER' });
    // TM-427: naming the reviewer from outside its pane is refused too; AO_AGENT_ID proves nothing.
    await assert.rejects(reviewerNonceAck({ ...f, alive: async () => true, nonce: p.nonce, env: { ...f.env, AO_AGENT_ID: record.agent_id }, callerProc: forgedCaller }), { code: 'TOPOLOGY_REVIEWER_ACK_OWNER', message: /not an ancestor/ });
    await reviewerNonceAck({ ...f, alive: async () => true, nonce: p.nonce, env: f.env });
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
  await submitVerdict(f, request); await collectReview(args);
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
  await assert.rejects(collectReview({ ...f, task: 'TM-1' }), { code: 'TOPOLOGY_REVIEWER_NO_VERDICT' }, 'no verdict submitted yet');
  await assert.rejects(submitVerdict(f, { nonce: 'forged' }), { code: 'TOPOLOGY_REVIEWER_NONCE' });
  await assert.rejects(submitVerdict(f, request, 'approve', [], { env: { ...f.env, AO_AGENT_ID: 'author' }, callerProc: forgedCaller }), { code: 'TOPOLOGY_REVIEWER_IDENTITY' }, 'only the designated reviewer submits');
  await assert.rejects(submitVerdict(f, request, 'approve', [], { alive: async () => false }), { code: 'TOPOLOGY_REVIEWER_IDENTITY' }, 'a dead reviewer pane cannot submit');
  await submitVerdict(f, request);
  const review = await collectReview({ ...f, task: 'TM-1' });
  assert.equal(review.reviewer_id, record.agent_id); assert.equal(review.verified_commit, f.revision);
  assert.equal((await independentReviewStatus({...f,task:'TM-1'})).status,'approved');
  assert.equal((await collectReview({...f,task:'TM-1'})).request_nonce,request.nonce);
  await assert.rejects(submitVerdict(f, request, 'blocked'), { code: 'TOPOLOGY_REVIEWER_RESPONSE' }, 'a collected verdict cannot change');
  assert.throws(() => buildReviewerArgv({ id: 'claude' }, { args: ['--dangerously-skip-permissions'] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
  assert.throws(() => buildReviewerArgv({ id: 'codex' }, { args: [], env: {}, mcp: [] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
  const adapter = { id: 'claude', command: 'claude', args: [], model_args: [], system_prompt_args: [], add_dir_args: ['--add-dir', '{{dir}}'] };
  const argv = buildReviewerArgv(adapter, { args: [], env: {}, mcp: [] }, {}, { consumer: f.consumer });
  assert.ok(argv.includes('--restricted')); assert.ok(argv.includes('--strict-mcp-config')); assert.ok(!argv.includes('--dangerously-skip-permissions'));
});

test('TM-427: a forged AO_AGENT_ID and a hand-written verdict file cannot approve a task', async t => {
  const { requestReview, collectReview, independentReviewStatus, submitReviewVerdict } = await import('../../topology/lib/reviewer.mjs');
  const f = await fixture(t);
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'] });
  // The worker's attack: name the reviewer, pane alive, but run from its own process tree.
  await assert.rejects(submitVerdict(f, request, 'approve', [], { env: { ...f.env, AO_AGENT_ID: record.agent_id }, callerProc: forgedCaller }), { code: 'TOPOLOGY_REVIEWER_IDENTITY', message: /AO_AGENT_ID alone/ }, 'the parent process does not descend from the reviewer pane');
  const { handleMessage } = await import('../../topology/review-mcp.mjs');
  const viaMcp = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'review_submit', arguments: { request: request.nonce, verdict: 'approve' } } },
    { env: { ...f.env, AO_AGENT_ID: record.agent_id, AO_CONSUMER: f.consumer }, submit: o => submitReviewVerdict({ ...o, home: f.home, alive: async () => true, callerProc: forgedCaller }) });
  assert.match(viaMcp.result.content[0].text, /TOPOLOGY_REVIEWER_IDENTITY/, 'the MCP tool refuses a forged caller the same way');
  // The shell channel is gone: `review submit` is refused by name, even naming the reviewer.
  const { execFile } = await import('node:child_process');
  const cli = await new Promise(resolve => execFile(process.execPath, [new URL('../../bin/ao-topology', import.meta.url).pathname, 'review', 'submit', request.nonce, '--verdict', 'approve', '--consumer', f.consumer, '--json'],
    { env: { ...f.env, AO_AGENT_ID: record.agent_id, AO_CONSUMER: f.consumer, TMUX: '' } }, (error, stdout) => resolve({ code: error?.code ?? 0, stdout })));
  assert.equal(cli.code, 1, cli.stdout); assert.equal(JSON.parse(cli.stdout).code, 'TOPOLOGY_REVIEWER_IDENTITY', cli.stdout);
  await assert.rejects(submitVerdict(f, request, 'approve', [], { callerProc: { pid: 99, readStat: async () => { throw Object.assign(new Error('no /proc'), { code: 'ENOENT' }); } } }), { code: 'TOPOLOGY_REVIEWER_IDENTITY' }, 'unreadable ancestry fails closed');
  // Second route: copy reviewer_id and binding from the readable request into the verdict file.
  const verdictFile = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'verdicts', `TM-1-${f.revision}.json`);
  const forged = { nonce: request.nonce, task: 'TM-1', revision: f.revision, reviewer_id: record.agent_id, binding, verdict: 'approve', findings: [], submitted_at: new Date().toISOString() };
  await writeJson(verdictFile, forged);
  await assert.rejects(collectReview({ ...f, task: 'TM-1' }), { code: 'TOPOLOGY_REVIEWER_NO_VERDICT' }, 'an unsealed verdict file is ignored');
  await writeJson(verdictFile, { ...forged, seal: 'ab'.repeat(32) });
  await assert.rejects(collectReview({ ...f, task: 'TM-1' }), { code: 'TOPOLOGY_REVIEWER_NO_VERDICT' }, 'a guessed seal is ignored');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'awaiting-review');
  // The proven channel seals; editing the sealed record afterwards breaks the seal.
  await submitVerdict(f, request, 'blocked', [{ severity: 'note', file: 'CHANGELOG.md', line: 1, claim: 'missing evidence' }]);
  const sealed = JSON.parse(await readFile(verdictFile, 'utf8'));
  assert.match(sealed.seal, /^[0-9a-f]{64}$/);
  await writeJson(verdictFile, { ...sealed, verdict: 'approve', findings: [] });
  await assert.rejects(collectReview({ ...f, task: 'TM-1' }), { code: 'TOPOLOGY_REVIEWER_NO_VERDICT' }, 'a tampered verdict is ignored');
  await writeJson(verdictFile, sealed);
  assert.equal((await collectReview({ ...f, task: 'TM-1' })).verdict, 'blocked');
});

test('TM-214: the reviewer stays read-only even though every other agent now defaults to auto_approve', async t => {
  const { buildReviewerArgv } = await import('../../topology/lib/reviewer.mjs');
  const { loadAdapters } = await import('../../topology/lib/providers.mjs');
  const claude = (await loadAdapters([new URL('../../providers', import.meta.url).pathname])).get('claude');
  assert.ok(claude.auto_approve_args.includes('--dangerously-skip-permissions'), 'the real adapter must carry the flag, or this test proves nothing');
  // The fixture's reviewer template has no auto_approve key — the case TM-214 turned on for everyone else.
  const f = await fixture(t);
  const { agent } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  assert.equal(JSON.parse(await readFile(agent._file, 'utf8')).auto_approve, false, 'the minted reviewer agent.json must store auto_approve false');
  // Even if a stored definition said otherwise, the reviewer argv ignores it.
  const argv = buildReviewerArgv(claude, { args: [], env: {}, mcp: [], auto_approve: true }, {}, { consumer: '/repo' });
  assert.ok(argv.includes('--restricted'), argv.join(' '));
  assert.equal(argv[argv.indexOf('--setting-sources') + 1], '', argv.join(' '));
  assert.ok(!argv.includes('--dangerously-skip-permissions'), argv.join(' '));
});

test('TM-214: createAgent stores auto_approve false for any reviewer, and session open refuses the reviewer role', async t => {
  const { createAgent } = await import('../../topology/lib/agents.mjs');
  const f = await fixture(t);
  const reviewer = await createAgent(f.consumer, { role: 'reviewer', cli: 'claude', auto_approve: true }, null, { pluginRoot: f.pluginRoot, home: f.home, env: f.env });
  assert.equal(reviewer.auto_approve, false);
  const worker = await createAgent(f.consumer, { role: 'worker', cli: 'claude' }, null, { pluginRoot: f.pluginRoot, home: f.home, env: f.env });
  assert.equal(worker.auto_approve, true, 'control: a non-reviewer with no key defaults on');
  const { execFile } = await import('node:child_process');
  const cli = new URL('../../topology/cli.mjs', import.meta.url).pathname;
  // TMUX blank and a private TMUX_TMPDIR: the refusal must come before any tmux call, but if it ever
  // did not, nothing may reach the operator's server.
  const env = { ...f.env, TMUX: '', TMUX_TMPDIR: f.home };
  const result = await new Promise(resolve => execFile(process.execPath, [cli, 'session', 'open', reviewer.id, '--consumer', f.consumer, '--home', f.home, '--json'], { env, timeout: 15000 },
    (error, stdout, stderr) => resolve({ code: error?.code ?? 0, output: stdout + stderr })));
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.output, /TOPOLOGY_REVIEWER_READ_ONLY/, result.output);
});

test('concurrent review collectors record one response and replaced reviewer bindings require a fresh nonce',async t=>{
  const {requestReview,collectReview,independentReviewStatus}=await import('../../topology/lib/reviewer.mjs');
  const f=await fixture(t);
  const {record}=await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',binding})}});
  const options={...f,task:'TM-1',authorAgentIds:['author'],wake:async()=>({rang:false,reason:'test'})};
  const request=await requestReview(options);
  await submitVerdict(f,request);
  const reviews=await Promise.all([collectReview(options),collectReview(options)]);
  assert.equal(reviews[0].request_nonce,reviews[1].request_nonce);
  assert.equal((await readdir(join(await reviewsRoot(f.consumer,f.env,f.home),'TM-1','history'))).length,1,'one review is recorded');
  const paths=await reviewerPaths(f.consumer,f.env,f.home);
  await writeJson(paths.recordPath,{...record,binding:{...binding,panePid:binding.panePid+1}});
  assert.equal((await independentReviewStatus(options)).status,'invalid');
  const fresh=await requestReview(options);
  assert.notEqual(fresh.nonce,request.nonce);
  await assert.rejects(collectReview(options),{code:'TOPOLOGY_REVIEWER_NO_VERDICT'},'the old nonce\'s verdict does not answer the fresh request');
});

test('linked worktrees share reviewer identity and exact review evidence', async t => {
  const f = await fixture(t); const linked = join(f.home, 'linked'); await mkdir(f.home, { recursive: true });
  await run('git', ['-C', f.consumer, 'worktree', 'add', '--detach', linked]);
  const probes = { alive: async () => true, responsive: async () => true, open: async () => ({ session: 'review', binding }) };
  const { record } = await ensureReviewer({ ...f, probes });
  const second = await ensureReviewer({ ...f, consumer: linked, probes });
  assert.equal(second.record.agent_id, record.agent_id);
  const request = await requestReview({ ...f, task: 'TM-1', authorAgentIds: ['author'], wake: async () => ({rang:false}) });
  await submitVerdict({ ...f, consumer: linked }, request);
  await collectReview({ ...f, consumer: linked, task: 'TM-1' });
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
  await submitVerdict(f, request);
  const review = await collectReview(opts);
  assert.equal(review.base_revision, f.revision); assert.equal(review.patch_sha256, request.patch_sha256);
  const probes = { alive: async () => true, responsive: async () => true };
  assert.equal((await reviewEligibility({ ...opts, probes })).eligible, true);
  await writeJson(f.managementPath, { ...f.management, base_revision: first, finish: { revision: finish } });
  assert.equal((await reviewEligibility({ ...opts, probes })).eligible, false, 'changing the admitted range invalidates an old approval');
  await assert.rejects(collectReview(opts), { code: 'TOPOLOGY_REVIEWER_RANGE' });
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
  const iso=isolatedTmux(t),socket=iso.socket;
  await iso.tmux(['new-session','-d','-s','review','sleep 60']);
  {
    const {listServerPanes}=await import('../../topology/lib/tmux.mjs');
    const observed=(await listServerPanes({tmuxServer:socket}))[0];
    const {agent}=await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',pane:observed.paneId,binding:observed})}});
    await writeJson(join(agent._dir,'session.json'),{session:'review',binding:observed});
    // TM-214: an adopted agent may carry auto_approve true from its old role; assignment must clear it.
    await writeJson(agent._file,{...JSON.parse(await readFile(agent._file,'utf8')),auto_approve:true});
    const assigned=await assignReviewer({...f,agentRef:agent.id,session:'review',probes:{responsive:async record=>{
      assert.equal(record.provider,'codex');assert.equal(record.consumer,f.consumer);assert.equal(record.binding.panePid,observed.panePid);return true;
    }}});
    assert.equal(assigned.record.managed,false);
    assert.equal(JSON.parse(await readFile(agent._file,'utf8')).auto_approve,false,'an assigned reviewer must be stored with auto_approve false');
    await iso.tmux(['split-window','-d','-t','review','sleep 60']);
    await assert.rejects(assignReviewer({...f,agentRef:agent.id,session:'review',probes:{responsive:async()=>true}}),{code:'TOPOLOGY_REVIEWER_PANE_AMBIGUOUS'});
    await killOwnedServer(iso.env,socket); // the reviewer's pane dies outside ao's control
    let opens=0;
    const held=await ensureReviewer({...f,probes:{open:async()=>{opens++;throw new Error('external reviewer must not be restarted');}}});
    assert.equal(held.status,'dead-external');assert.equal(opens,0);
  }
});

test('automatic review collection skips retained history and rotates unanswered batches', async t => {
  const f=await fixture(t);
  await ensureReviewer({...f,probes:{alive:async()=>false,open:async()=>({session:'review',binding})}});
  const request=await requestReview({...f,task:'TM-1',authorAgentIds:['author'],wake:async()=>({rang:true})});
  const dir=join(await reviewerInboxRoot(f.consumer,f.env,f.home),'requests');
  await Promise.all(Array.from({length:105},(_,i)=>writeJson(join(dir,`000-history-${i}.json`),{collected_at:new Date().toISOString()})));
  await submitVerdict(f,request);
  const collected=await collectPendingReviews(f);
  assert.equal(collected.length,1);assert.equal(collected[0].state,'collected');
  await Promise.all(Array.from({length:101},(_,i)=>{
    const task=`PENDING-${String(i).padStart(3,'0')}`;
    return writeJson(join(dir,`${task}-${f.revision}.json`),{...request,task,delivery:{rang:true}});
  }));
  const first=await collectPendingReviews(f);
  const second=await collectPendingReviews(f);
  assert.equal(first.length,100);assert.equal(second.length,100);
  assert.ok(second.some(result=>result.task==='PENDING-100'),'later pending requests must be visited despite earlier unanswered requests');
});

test('TM-241: a range over 8 MiB of binary files produces a request with a size manifest, not a generic refusal', async t => {
  const f = await fixture(t);
  const { writeFile: write } = await import('node:fs/promises');
  const pngPath = join(f.consumer, 'evidence.png');
  const { randomBytes } = await import('node:crypto');
  const bytes = randomBytes(9 * 1024 * 1024); // 9 MiB of real (NUL-containing) bytes git detects as binary, well past the old 8 MiB default buffer
  await write(pngPath, bytes);
  await run('git', ['-C', f.consumer, 'add', 'evidence.png']);
  await run('git', ['-C', f.consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'add evidence']);
  const finish = (await run('git', ['-C', f.consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(f.managementPath, { ...f.management, finish: { revision: finish } });
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const request = await requestReview({ ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) });
  assert.equal(request.state, 'published');
  const patch = await readFile(request.patch_path, 'utf8');
  assert.ok(patch.includes('Binary files'), 'text diff still names the binary change');
  assert.ok(patch.includes('evidence.png'));
  assert.match(patch, /new sha256=[0-9a-f]{64} size=9437184/, 'manifest carries the real blob sha256 and size, not the bytes');
});

test('TM-241: a forced git diff failure is reported with git\'s own exit code and stderr, not the generic sentence', async t => {
  const f = await fixture(t);
  const { chmod, writeFile: write } = await import('node:fs/promises');
  await write(join(f.consumer, 'f.txt'), 'hello');
  await run('git', ['-C', f.consumer, 'add', 'f.txt']);
  await run('git', ['-C', f.consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'add f']);
  const finish = (await run('git', ['-C', f.consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  const blob = (await run('git', ['-C', f.consumer, 'rev-parse', `${finish}:f.txt`])).stdout.trim();
  await writeJson(f.managementPath, { ...f.management, finish: { revision: finish } });
  // Corrupt the blob's loose object so `git diff` fails to read it while `merge-base --is-ancestor`
  // (which only walks commit parents, not blob content) still succeeds — isolating the diff failure.
  const objectPath = join(f.consumer, '.git', 'objects', blob.slice(0, 2), blob.slice(2));
  await chmod(objectPath, 0o644);
  await write(objectPath, 'corrupted');
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  await assert.rejects(
    requestReview({ ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) }),
    error => {
      assert.equal(error.code, 'TOPOLOGY_REVIEWER_RANGE');
      // TM-260: content classification reads the blob first, so git cat-file is the command that fails.
      assert.match(error.message, /Cannot read file f\.txt \(unknown bytes, blob [0-9a-f]{40}\): git exited 128/);
      assert.match(error.message, /unable to unpack/);
      return true;
    }
  );
});

async function commitFile(f, name, bytes) {
  await writeFile(join(f.consumer, name), bytes);
  await run('git', ['-C', f.consumer, 'add', name]);
  await run('git', ['-C', f.consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', `add ${name}`]);
  const finish = (await run('git', ['-C', f.consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(f.managementPath, { ...f.management, finish: { revision: finish } });
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  return finish;
}

test('TM-241: a text-only range hashes exactly as the pre-TM-241 --binary diff did', async t => {
  const f = await fixture(t);
  const finish = await commitFile(f, 'notes.txt', 'line one\nline two\n');
  const request = await requestReview({ ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) });
  const legacy = await run('git', ['-C', f.consumer, 'diff', '--no-ext-diff', '--no-textconv', '--binary', f.revision, finish, '--']);
  const { createHash } = await import('node:crypto');
  assert.equal(request.patch_sha256, createHash('sha256').update(legacy.stdout).digest('hex'));
});

test('TM-241: a missing revision is named, not reported as a failed ancestor check', async t => {
  const f = await fixture(t);
  const missing = 'f'.repeat(40);
  await writeJson(f.managementPath, { ...f.management, finish: { revision: missing } });
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  await assert.rejects(
    requestReview({ ...f, task: 'TM-1', revision: missing, authorAgentIds: ['author'], wake: async () => ({ rang: false }) }),
    error => {
      assert.equal(error.code, 'TOPOLOGY_REVIEWER_RANGE');
      assert.match(error.message, new RegExp(`finished revision ${missing} is not a commit`));
      return true;
    }
  );
});

test('TM-241: an unreadable binary blob refuses with its path and size instead of reporting it absent', async t => {
  const f = await fixture(t);
  const finish = await commitFile(f, 'shot.png', Buffer.from([0, 1, 2, 0, 255, 0, 7]));
  // A git shim that fails only `cat-file blob`, after diff and size lookup succeeded.
  const realGit = (await run('sh', ['-c', 'command -v git'])).stdout.trim();
  const shimDir = join(f.consumer, '..', 'shim');
  await mkdir(shimDir);
  await writeFile(join(shimDir, 'git'), `#!/bin/sh\n[ "$3" = cat-file ] && [ "$4" = blob ] && { echo "fatal: simulated unreadable blob" >&2; exit 128; }\nexec ${realGit} "$@"\n`, { mode: 0o755 });
  const path = process.env.PATH;
  process.env.PATH = `${shimDir}:${path}`;
  t.after(() => { process.env.PATH = path; });
  await assert.rejects(
    requestReview({ ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) }),
    error => {
      assert.equal(error.code, 'TOPOLOGY_REVIEWER_RANGE');
      assert.match(error.message, /Cannot read file shot\.png \(7 bytes, blob [0-9a-f]{40}\): git exited 128 — fatal: simulated unreadable blob/);
      return true;
    }
  );
});

// TM-257: a task branch that merged the default branch is reviewed over its own changes only. The
// default branch is the SERVER's; `fakeServer` stands in for GitHub's compare API, holding the
// default branch as a JS value so no local ref can move it, and no test touches the network.
function fakeServer(main) {
  const server = { main, calls: 0, compare: async (dir, from, to) => {
    server.calls++;
    const a = from ?? server.main, b = to ?? server.main;
    const mb = (await run('git', ['-C', dir, 'merge-base', a, b])).stdout.trim();
    return { status: a === b ? 'identical' : mb === a ? 'ahead' : mb === b ? 'behind' : 'diverged', merge_base: mb };
  } };
  return server;
}

async function mergedMainFixture(t) {
  const f = await fixture(t);
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  const git = async args => (await run('git', ['-C', f.consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args])).stdout.trim();
  const commit = async (path, content) => { await writeFile(join(f.consumer, path), content); await git(['add', path]); await git(['commit', '-q', '-m', path]); return git(['rev-parse', 'HEAD']); };
  await git(['branch', '-M', 'main']);
  const admit = async (revision, base = f.revision) => writeJson(f.managementPath, { ...f.management, base_revision: base, finish: { revision } });
  const opts = { ...f, task: 'TM-1', authorAgentIds: ['author'] };
  return { f, git, commit, admit, opts };
}

// task: own.txt; main: sibling.txt; task merges main (-> merged) and optionally commits late.txt.
async function mergedBranch(t, { late = false } = {}) {
  const m = await mergedMainFixture(t);
  await m.git(['checkout', '-q', '-b', 'task']); const own = await m.commit('own.txt', 'early task change');
  await m.git(['checkout', '-q', 'main']); const sibling = await m.commit('sibling.txt', 'landed sibling task');
  await m.git(['checkout', '-q', 'task']); await m.git(['merge', '-q', '--no-edit', '--no-ff', 'main']);
  const merged = await m.git(['rev-parse', 'HEAD']);
  const revision = late ? await m.commit('late.txt', 'late task change') : merged;
  await m.admit(revision);
  const server = fakeServer(sibling);
  // Coverage: the admitted range DOES carry the sibling, so the assertions below can fail.
  assert.match(await m.git(['diff', '--name-only', m.f.revision, revision]), /sibling\.txt/);
  return { ...m, own, sibling, merged, revision, server, o: { ...m.opts, serverCompare: server.compare } };
}

const probesUp = { alive: async () => true, responsive: async () => true };
// TM-259: drop the host's recorded verified bases, so the next derivation asks the server again.
const forgetBases = f => rm(f.managementPath.replace(/\.json$/, '.bases.json'), { force: true });

test('TM-257 (a,f) a branch that merged main is reviewed over its own changes, before and after landing', async t => {
  const { f, git, sibling, revision, server, o } = await mergedBranch(t);
  await assert.rejects(requestReview({ ...o, revision, baseRevision: sibling }), { code: 'TOPOLOGY_REVIEWER_RANGE' }, 'a caller cannot supply the effective base');
  const request = await requestReview({ ...o, revision });
  assert.equal(request.admitted_base, f.revision); assert.equal(request.effective_base, sibling); assert.equal(request.base_revision, sibling);
  assert.match(request.range_note, /excludes code already on the default branch/);
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /early task change/); assert.doesNotMatch(patch, /landed sibling task/);
  const review = await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  assert.equal(review.admitted_base, f.revision); assert.equal(review.effective_base, sibling); assert.equal(review.patch_sha256, request.patch_sha256);
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, []);
  // (f) Landing: the server's default branch now contains the revision; the recorded base stands.
  await git(['checkout', '-q', 'main']); await git(['merge', '-q', '--ff-only', revision]); server.main = revision;
  let calls = server.calls;
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, []);
  assert.equal(server.calls, calls, 'TM-259: the verified base is recorded, so landing asks the server nothing');
  await forgetBases(f); calls = server.calls;
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, []);
  assert.ok(server.calls > calls, 'with no recorded base, the landed check asks the server');
  // (f) refused: the server says the recorded base is not on its default branch.
  await forgetBases(f);
  const offDefault = async (dir, from) => from === null ? { status: 'behind', merge_base: revision } : { status: 'diverged', merge_base: f.revision };
  const refused = (await reviewEligibility({ ...o, serverCompare: offDefault, revision, probes: probesUp })).reasons;
  assert.ok(refused.some(reason => /not on the server default branch/.test(reason)), refused.join('\n'));
});

// TM-325: the sibling lands on the task's integration branch, which admission recorded in the producer-owned
// record. The task file names a different branch (`main`): a later task-file edit must not move the range.
async function mergedIntegrationBranch(t, integration) {
  const m = await mergedMainFixture(t);
  await mkdir(join(m.f.consumer, '.bytedesk/task-management/tasks'), { recursive: true });
  await writeFile(join(m.f.consumer, '.bytedesk/task-management/tasks/TM-1-fixture.md'), '---\nid: "TM-1"\nintegrationBranch: "main"\n---\n');
  await m.git(['checkout', '-q', '-b', 'task']); await m.commit('own.txt', 'early task change');
  await m.git(['checkout', '-q', '-b', 'fix/integration', 'main']); const sibling = await m.commit('sibling.txt', 'landed sibling task');
  await m.git(['checkout', '-q', 'task']); await m.git(['merge', '-q', '--no-edit', '--no-ff', 'fix/integration']);
  const revision = await m.commit('late.txt', 'late task change');
  await writeJson(m.f.managementPath, { ...m.f.management, base_revision: m.f.revision, finish: { revision }, branch: 'task', integration_branch: integration });
  const server = fakeServer(m.f.revision), asked = [], pulls = [];
  const compare = async (dir, from, to) => { asked.push([from, to]); return server.compare(dir, from, to); };
  const pullBase = async (dir, head) => { pulls.push(head); return [integration]; };
  assert.match(await m.git(['diff', '--name-only', m.f.revision, revision]), /sibling\.txt/);
  return { ...m, sibling, revision, server, asked, pulls, o: { ...m.opts, serverCompare: compare, serverPullBase: pullBase } };
}

test('TM-325 a branch that merged its integration branch is reviewed over its own changes only', async t => {
  const { f, git, sibling, revision, server, asked, pulls, o } = await mergedIntegrationBranch(t, 'fix/integration');
  const request = await requestReview({ ...o, revision });
  assert.ok(asked.some(([from]) => from === 'fix/integration'), JSON.stringify(asked));
  assert.ok(!asked.some(([from, to]) => from === 'main' || to === 'main'), `the task file's branch was never consulted: ${JSON.stringify(asked)}`);
  assert.ok(pulls.includes('task'), 'the recorded branch was confirmed against the task PR base');
  assert.equal(request.admitted_base, f.revision); assert.equal(request.effective_base, sibling);
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /early task change/); assert.match(patch, /late task change/); assert.doesNotMatch(patch, /landed sibling task/);
  const review = await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  assert.equal(review.effective_base, sibling);
  // Landed on the integration branch: the recorded base is checked against that branch, not main.
  await git(['checkout', '-q', 'fix/integration']); await git(['merge', '-q', '--ff-only', revision]);
  await forgetBases(f); asked.length = 0;
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, []);
  assert.ok(asked.some(([from, to]) => from === sibling && to === 'fix/integration'), JSON.stringify(asked));
  assert.equal(server.main, f.revision, 'main never moved');
});

test('TM-325 a task PR whose base disagrees with the admitted integration branch is refused', async t => {
  const { revision, o } = await mergedIntegrationBranch(t, 'fix/integration');
  await assert.rejects(requestReview({ ...o, revision, serverPullBase: async () => ['main'] }), /task PR targets main, but the task was admitted against the integration branch fix\/integration/);
});

test('TM-325 a landed task whose integration branch was merged and deleted keeps its recorded effective base', async t => {
  const { f, git, sibling, revision, asked, o } = await mergedIntegrationBranch(t, 'fix/integration');
  const request = await requestReview({ ...o, revision });
  await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  await git(['checkout', '-q', 'fix/integration']); await git(['merge', '-q', '--ff-only', revision]);
  await git(['checkout', '-q', 'main']); await git(['merge', '-q', '--ff-only', 'fix/integration']); await git(['branch', '-q', '-D', 'fix/integration']);
  await forgetBases(f); asked.length = 0;
  const gone = async (dir, from, to) => { asked.push([from, to]); if (from === 'fix/integration' || to === 'fix/integration') throw new Error('gh compare failed: HTTP 404'); return o.serverCompare(dir, from, to); };
  assert.deepEqual((await reviewEligibility({ ...o, serverCompare: gone, revision, probes: probesUp })).reasons, []);
  const { reviewRangeBase } = await import('../../topology/lib/reviewer.mjs');
  const range = await reviewRangeBase({ ...o, serverCompare: gone, revision, admittedBase: f.revision });
  assert.equal(range.effective_base, sibling); assert.match(range.range_note, /recorded on the review request/);
});

test('TM-325 an integration branch the server cannot answer for, or a malformed one, keeps the admitted range', async t => {
  const { f, revision, o } = await mergedIntegrationBranch(t, 'fix/integration');
  const down = await requestReview({ ...o, revision, serverCompare: async () => { throw new Error('gh: HTTP 404'); } });
  assert.equal(down.effective_base, f.revision);
  assert.match(down.range_note, /integration branch fix\/integration could not be read from the server \(gh: HTTP 404\)/);
  const { effectiveBase } = await import('../../topology/lib/reviewer.mjs');
  let called = false;
  const bad = await effectiveBase(f.consumer, f.revision, revision, { branch: 'main...x', serverCompare: async () => { called = true; return { status: 'ahead', merge_base: revision }; } });
  assert.equal(bad.base, f.revision); assert.match(bad.note, /not a plain branch name/); assert.equal(called, false);
});

test('TM-259 a server outage on a revision with a recorded verified base keeps the approved review valid', async t => {
  const { f, sibling, revision, o } = await mergedBranch(t);
  const { reviewRangeBase } = await import('../../topology/lib/reviewer.mjs');
  const down = async () => { throw new Error('gh: HTTP 403 rate limit exceeded'); };
  // First derivation with the server down still fails closed to the admitted base, and is not recorded.
  const fallback = await reviewRangeBase({ ...o, serverCompare: down, revision, admittedBase: f.revision });
  assert.equal(fallback.effective_base, f.revision); assert.match(fallback.range_note, /rate limit/);
  await assert.rejects(readFile(f.managementPath.replace(/\.json$/, '.bases.json'), 'utf8'), { code: 'ENOENT' });
  const request = await requestReview({ ...o, revision });
  assert.equal(request.effective_base, sibling);
  await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  assert.deepEqual((await reviewEligibility({ ...o, serverCompare: down, revision, probes: probesUp })).reasons, [], 'a blip after approval does not flip it');
  // Coverage: without the record, the same blip is exactly the flip TM-259 reports.
  await forgetBases(f);
  const flipped = (await reviewEligibility({ ...o, serverCompare: down, revision, probes: probesUp })).reasons;
  assert.ok(flipped.includes('review does not cover the complete admitted task range'), flipped.join('\n'));
});

test('TM-259 sweeps make no GitHub call for a revision whose base is recorded; a tampered record is not trusted', async t => {
  const { f, git, commit, sibling, revision, asked, pulls, o } = await mergedIntegrationBranch(t, 'fix/integration');
  const { reviewRangeBase } = await import('../../topology/lib/reviewer.mjs');
  const request = await requestReview({ ...o, revision });
  await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  assert.ok(asked.length > 0 && pulls.length > 0, 'the first derivation asked the server');
  asked.length = 0; pulls.length = 0;
  for (let tick = 0; tick < 3; tick++) assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, []);
  assert.equal((await reviewRangeBase({ ...o, revision, admittedBase: f.revision })).effective_base, sibling);
  assert.deepEqual([asked.length, pulls.length], [0, 0], 'no compare and no PR lookup for a recorded revision');
  // A recorded base outside admitted..revision is ignored and the server is asked again.
  const path = f.managementPath.replace(/\.json$/, '.bases.json');
  const recorded = JSON.parse(await readFile(path, 'utf8'));
  await git(['checkout', '-q', '-b', 'side', f.revision]); const outside = await commit('side.txt', 'not in the task range'); await git(['checkout', '-q', 'task']);
  await writeJson(path, { [revision]: { ...recorded[revision], base: outside } });
  assert.notEqual(outside, sibling);
  assert.equal((await reviewRangeBase({ ...o, revision, admittedBase: f.revision })).effective_base, sibling);
  assert.ok(asked.length > 0, 'the tampered record sent the derivation back to the server');
});

test('TM-257 (b) a branch that never merged main keeps the admitted range', async t => {
  const { f, git, commit, admit, opts } = await mergedMainFixture(t);
  const { effectiveBase } = await import('../../topology/lib/reviewer.mjs');
  await git(['checkout', '-q', '-b', 'task']); const revision = await commit('own.txt', 'task change');
  await git(['checkout', '-q', 'main']); const tip = await commit('sibling.txt', 'landed sibling task');
  await admit(revision);
  const server = fakeServer(tip), o = { ...opts, serverCompare: server.compare };
  assert.deepEqual(await effectiveBase(f.consumer, f.revision, revision, { serverCompare: server.compare }), { base: f.revision, note: null });
  const request = await requestReview({ ...o, revision });
  assert.ok(server.calls > 0, 'the server was consulted');
  assert.equal(request.base_revision, f.revision); assert.equal(request.effective_base, f.revision); assert.equal(request.admitted_base, f.revision);
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /task change/);
  assert.equal(patch, (await run('git', ['-C', f.consumer, 'diff', '--no-ext-diff', '--no-textconv', '--binary', f.revision, revision, '--'])).stdout);
});

test('TM-257 (c) moving local main and origin/main to a mid-task commit does not shrink the range', async t => {
  const { git, sibling, merged, revision, o } = await mergedBranch(t, { late: true });
  // The attack: every local default-branch ref points at the task's own merge commit.
  await git(['update-ref', 'refs/remotes/origin/main', merged]); await git(['update-ref', 'refs/heads/main', merged]);
  // Coverage: a base at the moved ref WOULD hide the early task change.
  assert.doesNotMatch(await git(['diff', merged, revision]), /early task change/);
  const request = await requestReview({ ...o, revision });
  assert.equal(request.effective_base, sibling);
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /early task change/); assert.match(patch, /late task change/); assert.doesNotMatch(patch, /landed sibling task/);
});

test('TM-257 (d) a server merge-base outside admitted..revision is refused', async t => {
  const { git, commit, revision, o } = await mergedBranch(t);
  await git(['checkout', '-q', 'main']); const later = await commit('later.txt', 'main moved on');
  const answer = merge_base => ({ ...o, serverCompare: async () => ({ status: 'diverged', merge_base }) });
  await assert.rejects(requestReview({ ...answer(later), revision }), { code: 'TOPOLOGY_REVIEWER_RANGE', message: /not between the admitted task base and the revision/ });
  await assert.rejects(requestReview({ ...answer('f'.repeat(40)), revision }), { code: 'TOPOLOGY_REVIEWER_RANGE', message: /not a commit in this repository/ });
});

test('TM-257 (d) a server merge-base that is not a descendant of the admitted base is refused', async t => {
  const { git, commit, admit, opts } = await mergedMainFixture(t);
  await git(['checkout', '-q', '-b', 'side']); const offMain = await commit('side.txt', 'never on main');
  await git(['checkout', '-q', '-b', 'task']); await commit('own.txt', 'task change');
  await git(['checkout', '-q', 'main']); const sibling = await commit('sibling.txt', 'landed sibling task');
  await git(['checkout', '-q', 'task']); await git(['merge', '-q', '--no-edit', '--no-ff', 'main']);
  const revision = await git(['rev-parse', 'HEAD']); await admit(revision, offMain);
  const server = fakeServer(sibling);
  await assert.rejects(requestReview({ ...opts, serverCompare: server.compare, revision }), { code: 'TOPOLOGY_REVIEWER_RANGE', message: /not between the admitted task base/ });
  assert.ok(server.calls > 0);
});

test('TM-257 (e) an unavailable or malformed server fails closed to the admitted base with a note', async t => {
  const { f, revision, o } = await mergedBranch(t);
  const down = await requestReview({ ...o, revision, serverCompare: async () => { throw new Error('gh: HTTP 404'); } });
  assert.equal(down.effective_base, f.revision);
  assert.match(down.range_note, /could not be read from the server \(gh: HTTP 404\)/);
  assert.match(await readFile(down.patch_path, 'utf8'), /landed sibling task/, 'the wider admitted range, never a narrower one');
  const { effectiveBase } = await import('../../topology/lib/reviewer.mjs');
  const malformed = await effectiveBase(f.consumer, f.revision, revision, { serverCompare: async () => ({ status: 'ahead' }) });
  assert.equal(malformed.base, f.revision); assert.match(malformed.note, /malformed/);
});

test('TM-257 (h) a pre-TM-257 request after landing verifies the stored review base, or asks for a re-review', async t => {
  const { f, git, own, sibling, revision, server, o } = await mergedBranch(t);
  const request = await requestReview({ ...o, revision });
  await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  await git(['checkout', '-q', 'main']); await git(['merge', '-q', '--ff-only', revision]); server.main = revision;
  // Rewrite the request in the pre-TM-257 format: no admitted_base or effective_base.
  assert.equal(request.effective_base, sibling);
  const stored = JSON.parse(await readFile(request.path, 'utf8'));
  delete stored.admitted_base; delete stored.effective_base; delete stored.range_note;
  await writeJson(request.path, stored);
  await forgetBases(f);
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, [], 'the stored review base reproduces the reviewed patch');
  // A stored base that does not reproduce the reviewed patch is not used; a re-review is asked for.
  const { reviewsRoot } = await import('../../topology/lib/reviewer.mjs');
  const reviewPath = join(await reviewsRoot(f.consumer, f.env, f.home), 'TM-1', `${revision}.json`);
  await writeJson(reviewPath, { ...(JSON.parse(await readFile(reviewPath, 'utf8'))), base_revision: own });
  await forgetBases(f);
  const reasons = (await reviewEligibility({ ...o, revision, probes: probesUp })).reasons;
  assert.ok(reasons.some(reason => /predates TM-257.*re-review is required/.test(reason)), reasons.join('\n'));
});

test('TM-366 the review reads the worker worktree: a change only there is reviewed, not the main checkout', async t => {
  const f = await fixture(t);
  await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', binding }) } });
  // The worker's worktree is on its own branch; the main checkout stays on the base.
  const tree = join(f.consumer, '.bytedesk', 'worktrees', 'TM-1');
  await run('git', ['-C', f.consumer, 'worktree', 'add', '-q', '-b', 'tm/TM-1', tree]);
  await mkdir(join(tree, 'src'), { recursive: true });
  await writeFile(join(tree, 'src', 'only-in-worktree.js'), 'export const reviewed = "worker change";\n');
  const git = args => run('git', ['-C', tree, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args]);
  await git(['add', '.']); await git(['commit', '-q', '-m', 'worker change']);
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(f.managementPath, { ...f.management, worktree: tree, branch: 'tm/TM-1', finish: { revision } });
  const opts = { ...f, task: 'TM-1', revision, authorAgentIds: ['author'], wake: async () => ({ rang: true }) };
  const request = await requestReview(opts);
  assert.equal(request.worktree, tree, 'the request names the worktree the reviewer reads');
  assert.match(await readFile(request.patch_path, 'utf8'), /worker change/);
  assert.equal(await readFile(join(request.worktree, 'src', 'only-in-worktree.js'), 'utf8'), 'export const reviewed = "worker change";\n');
  await assert.rejects(readFile(join(f.consumer, 'src', 'only-in-worktree.js')), { code: 'ENOENT' }, 'the main checkout does not have the change');
  // A finding about the worktree-only file is accepted, because the files come from the worktree.
  await submitVerdict(f, request, 'changes_requested', [{ severity: 'major', file: 'src/only-in-worktree.js', line: 1, claim: 'c', evidence: 'e', fix: 'x' }]);
  const review = await collectReview(opts);
  assert.equal(review.findings[0].file, 'src/only-in-worktree.js');
  // A worktree of another repository is refused, never silently reviewed.
  const other = join(f.home, 'other'); await mkdir(other, { recursive: true }); await run('git', ['init', '-q', other]);
  await writeJson(f.managementPath, { ...f.management, worktree: other, finish: { revision } });
  await assert.rejects(requestReview(opts), { code: 'TOPOLOGY_REVIEWER_RANGE', message: /not a worktree of this repository/ });
});

// TM-364: agent-browser 2026-10-05 asked for a Codex reviewer and got three Claude ones.
async function providerFixture(t) {
  const f = await fixture(t);
  // The configured provider is claude; the reviewer the repository already has is codex.
  await writeJson(join(f.pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'claude', instructions: 'Review.' } }, management: { reviewer_providers: ['codex', 'claude'] } });
  const { agentDirs, createAgent, listAgents } = await import('../../topology/lib/agents.mjs');
  const reviewers = async () => (await listAgents(agentDirs(f))).filter(a => a.role === 'reviewer');
  const codex = await createAgent(f.consumer, { role: 'reviewer', cli: 'codex' }, null, { pluginRoot: f.pluginRoot, home: f.home, env: f.env });
  const opened = [];
  const probes = (liveSessions) => ({
    alive: async (session) => liveSessions.has(session),
    open: async ({ agent, provider }) => { opened.push({ agent: agent.id, provider }); liveSessions.add(`review-${agent.id}`); return { session: `review-${agent.id}`, pane: '%9', binding: { ...binding, paneId: '%9', sessionId: `$${agent.id}` } }; },
  });
  return { ...f, codex, reviewers, opened, probes };
}

test('TM-364 ensure --provider codex reuses the registered codex reviewer and never mints another', async t => {
  const f = await providerFixture(t);
  const live = new Set();
  const first = await ensureReviewer({ ...f, provider: 'codex', probes: f.probes(live) });
  assert.equal(first.record.agent_id, f.codex.id, 'the library codex reviewer is used, not a new one');
  assert.equal(first.record.provider, 'codex'); assert.equal(first.created, false);
  assert.deepEqual(f.opened, [{ agent: f.codex.id, provider: 'codex' }]);
  const again = await ensureReviewer({ ...f, provider: 'codex', probes: f.probes(live) });
  assert.equal(again.record.agent_id, f.codex.id); assert.equal(again.reattached, true);
  assert.equal(f.opened.length, 1, 'a live registered reviewer is reattached, not reopened');
  // Plain ensure (config says claude) and ensure --provider claude refuse instead of minting.
  await assert.rejects(ensureReviewer({ ...f, probes: f.probes(live) }), { code: 'TOPOLOGY_REVIEWER_PROVIDER', message: /--provider codex/ });
  await assert.rejects(ensureReviewer({ ...f, provider: 'claude', probes: f.probes(live) }), { code: 'TOPOLOGY_REVIEWER_PROVIDER', message: /never creates a second reviewer/ });
  await assert.rejects(ensureReviewer({ ...f, provider: 'grok', probes: f.probes(live) }), { code: 'TOPOLOGY_REVIEWER_PROVIDER' });
  assert.deepEqual((await f.reviewers()).map(a => a.id), [f.codex.id], 'still exactly one reviewer');
});

test('TM-364 with no registration, a live library reviewer is reattached on its provider and blocks any other', async t => {
  const f = await providerFixture(t);
  await writeJson(join(f.codex._dir, 'session.json'), { agent_id: f.codex.id, session: 'codex-review', binding: { ...binding, paneId: '%7' } });
  const live = new Set(['codex-review']);
  // Configured claude while a codex reviewer is live: refused, and nothing is created.
  await assert.rejects(ensureReviewer({ ...f, probes: f.probes(live) }), { code: 'TOPOLOGY_REVIEWER_LIVE', message: /--provider codex/ });
  await assert.rejects(ensureReviewer({ ...f, provider: 'claude', probes: f.probes(live) }), { code: 'TOPOLOGY_REVIEWER_LIVE' });
  assert.deepEqual((await f.reviewers()).map(a => a.id), [f.codex.id]);
  const reattached = await ensureReviewer({ ...f, provider: 'codex', probes: f.probes(live) });
  assert.equal(reattached.record.agent_id, f.codex.id); assert.equal(reattached.reattached, true);
  assert.equal(reattached.record.session, 'codex-review'); assert.equal(reattached.record.binding.paneId, '%7');
  assert.deepEqual(f.opened, [], 'nothing was launched');
  // Only with no reviewer of that provider at all is one minted.
  const g = await providerFixture(t);
  const minted = await ensureReviewer({ ...g, probes: g.probes(new Set()) });
  assert.equal(minted.created, true); assert.equal(minted.record.provider, 'claude');
  assert.equal((await g.reviewers()).length, 2, 'the stopped codex reviewer stays; one claude reviewer is added');
});

// TM-216: the review packet, the per-repo checklist and revision-bound check evidence.
const taskDoc = async () => ({ title: 'Packet fixture', body: 'Do the thing.', acceptance: [{ text: 'AC one is met', done: false }], touches: ['notes.txt'] });
async function packetFixture(t, required = null) {
  const f = await fixture(t);
  const finish = await commitFile(f, 'notes.txt', 'line one\nline two\n');
  if (required) await writeJson(join(f.consumer, '.bytedesk/agent-orchestration/config.json'), { management: { required_checks: required.map(name => ({ name, argv: ['true'] })) } });
  const o = { ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], taskDoc, wake: async () => ({ rang: true }) };
  return { f, finish, o };
}

test('TM-216 the packet is written beside the patch and hashed; a changed packet refuses collection', async t => {
  const { packetDigest } = await import('../../topology/lib/reviewer.mjs');
  const { f, finish, o } = await packetFixture(t);
  const request = await requestReview(o);
  const p = name => readFile(join(request.packet_path, name), 'utf8');
  assert.match(await p('files.txt'), /^A\tnotes\.txt$/m);
  assert.equal(await p('files/notes.txt'), 'line one\nline two\n');
  assert.match(await p('task.md'), /AC one is met/); assert.match(await p('task.md'), /- notes\.txt/);
  assert.deepEqual(JSON.parse(await p('checks.json')), { revision: finish, required: [], checks: [], unsatisfied: [] });
  assert.match(await p('checklist.md'), /none configured/);
  assert.equal(request.packet_sha256, await packetDigest(request.packet_path));
  assert.equal((await requestReview(o)).nonce, request.nonce, 'an unchanged packet keeps the request');
  await submitVerdict(f, request);
  await writeFile(join(request.packet_path, 'files', 'notes.txt'), 'line one\nedited after the request\n');
  await assert.rejects(collectReview(o), { code: 'TOPOLOGY_REVIEWER_RESPONSE', message: /Review packet changed after the request/ });
});

test('TM-216 the repository checklist is injected; missing check evidence can only be reviewed as blocked', async t => {
  const { reviewerProtocolPrompt } = await import('../../topology/lib/reviewer.mjs');
  const { f, o } = await packetFixture(t, ['unit']);
  await writeFile(join(f.consumer, '.bytedesk/agent-orchestration/review-checklist.md'), '- Run gofmt on every changed Go file.\n');
  const request = await requestReview(o);
  const checklist = await readFile(join(request.packet_path, 'checklist.md'), 'utf8');
  assert.match(checklist, /Run gofmt on every changed Go file/);
  assert.match(checklist, /- unit: UNSATISFIED \(unit: no evidence\)/);
  assert.deepEqual(request.checks_unsatisfied, ['unit: no evidence']);
  assert.match(reviewerProtocolPrompt({ id: 'r', role: 'reviewer', _dir: '/x' }, f.consumer, '/inbox'), /checklist\.md.*unsatisfied required checks you cannot approve/);
  await assert.rejects(submitVerdict(f, request, 'approve'), { code: 'TOPOLOGY_REVIEWER_VERDICT', message: /lacks passing evidence for required checks \(unit: no evidence\)/ });
  await submitVerdict(f, request, 'blocked');
  assert.equal((await collectReview(o)).verdict, 'blocked');
  // With evidence at this revision, exit 0, the same reviewer may approve.
  const passing = await requestReview({ ...o, checkEvidence: [{ name: 'unit', command: ['npm', 'test'], exit_code: 0, revision: o.revision, log_tail: 'ok' }] });
  assert.notEqual(passing.nonce, request.nonce); assert.deepEqual(passing.checks_unsatisfied, []);
  await submitVerdict(f, passing, 'approve');
  assert.equal((await collectReview(o)).verdict, 'approve');
  await assert.rejects(requestReview({ ...o, checkEvidence: [{ name: 'unit', exit_code: 0, revision: 'abc' }] }), { code: 'TOPOLOGY_REVIEWER_CHECKS' });
});

test('TM-216 eligibility refuses check evidence recorded at another revision or with a nonzero exit', async t => {
  const { f, o } = await packetFixture(t);
  const checks = [{ name: 'unit', command: 'npm test', exit_code: 1, revision: o.revision, log_tail: '1 failing' }, { name: 'lint', command: 'npm run lint', exit_code: 0, revision: f.revision }];
  const request = await requestReview({ ...o, checkEvidence: checks });
  await submitVerdict(f, request); await collectReview(o);
  assert.deepEqual((await reviewEligibility({ ...o, probes: probesUp })).reasons, [], 'nothing required yet');
  await writeJson(join(f.consumer, '.bytedesk/agent-orchestration/config.json'), { management: { required_checks: [{ name: 'unit', argv: ['true'] }, { name: 'lint', argv: ['true'] }, { name: 'build', argv: ['true'] }] } });
  const reasons = (await reviewEligibility({ ...o, probes: probesUp })).reasons;
  assert.deepEqual(reasons, [`required check unit: exited 1 at ${o.revision}`, `required check lint: evidence recorded at ${f.revision}, not ${o.revision}`, 'required check build: no evidence']);
});

// TM-418: an automatic request (here the supervisor review sweep, with the real requestReview) carries
// the worker's finish-report check runs; prose and runs at another commit never count as evidence.
test('TM-418 the review sweep files the finish report check runs, so the reviewer can approve', async t => {
  const { reviewSweepTick } = await import('../../topology/lib/review-sweep.mjs');
  const { f, finish, o } = await packetFixture(t, ['unit', 'lint']);
  const sweep = () => reviewSweepTick({ consumer: f.consumer, env: f.env, home: f.home, minIntervalMs: 0, tmBin: '/fake/tm',
    runFn: async () => ({ code: 0, stdout: JSON.stringify({ findings: [{ key: `no-review:TM-1:${Math.random()}`, kind: 'no-review', id: 'TM-1', governed: true, detail: 'TM-1', fresh: true }] }) }),
    lead: async () => null, deliver: async () => ({ status: 'delivered' }),
    // The real requestReview; only the pane wake is stubbed so no tmux is touched.
    requestReview: async opts => { requests.push(await requestReview({ ...opts, taskDoc, wake: async () => ({ rang: false }) })); } });
  const requests = [], filed = async () => requests.at(-1);
  const finishWith = checks => writeJson(f.managementPath, { ...f.management, finish: { revision: finish, checks } });

  // A prose claim and a run at another commit are not evidence: the reviewer can only block.
  await finishWith(['unit passed', { name: 'unit', command: 'npm test', exit_code: 0, revision: f.revision }, { name: 'lint', command: 'npm run lint', exit_code: 0, revision: finish }]);
  assert.equal((await sweep()).delivered[0].action, 'review-requested');
  const blocked = await filed();
  assert.deepEqual(blocked.checks_unsatisfied, [`unit: evidence recorded at ${f.revision}, not ${finish}`]);
  await assert.rejects(submitVerdict(f, blocked, 'approve'), { code: 'TOPOLOGY_REVIEWER_VERDICT' });

  // The worker's real runs at the finish commit: the same automatic path now permits approval.
  await finishWith([{ name: 'unit', command: ['npm', 'test'], exit_code: 0, revision: finish, log_tail: 'ok' }, { name: 'lint', command: 'npm run lint', exit_code: 0, revision: finish }]);
  await sweep();
  const passing = await filed();
  assert.notEqual(passing.nonce, blocked.nonce);
  assert.deepEqual(passing.checks_unsatisfied, []);
  assert.deepEqual(JSON.parse(await readFile(join(passing.packet_path, 'checks.json'), 'utf8')).checks.map(c => [c.name, c.command, c.revision]), [['unit', '[claimed by the worker; not run by the host] npm test', finish], ['lint', '[claimed by the worker; not run by the host] npm run lint', finish]], 'TM-430: the packet labels them as claims');
  await submitVerdict(f, passing, 'approve');
  assert.equal((await collectReview(o)).verdict, 'approve');
});

// TM-260: TM-241 follow-ups.
const manifestRows = patch => patch.split('--- Binary files (bytes omitted; path, old and new blob sha256 and size) ---\n')[1]?.split('\n').filter(Boolean) ?? [];

test('TM-260 a diff over the size cap is refused, and the message reports real bytes', async t => {
  const f = await fixture(t);
  const finish = await commitFile(f, 'wide.txt', 'é'.repeat(4000));
  const env = { ...f.env, AO_REVIEW_PATCH_MAX_BYTES: '1000' };
  await assert.rejects(requestReview({ ...f, env, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) }), error => {
    assert.equal(error.code, 'TOPOLOGY_REVIEWER_RANGE');
    const bytes = Number(error.message.match(/exceeds the 1000 byte cap \(at least (\d+) bytes read/)?.[1]);
    assert.ok(bytes > 1000, `two-byte characters past the cap are counted as bytes, not UTF-16 units: ${error.message}`);
    return true;
  });
});

test('TM-260 a range that marks its source binary in .gitattributes is still reviewed as a text diff', async t => {
  const f = await fixture(t);
  await commitFile(f, '.gitattributes', '*.mjs binary\n*.js -diff\n');
  await writeFile(join(f.consumer, 'b.js'), 'export const hidden = "second";\n');
  const finish = await commitFile(f, 'a.mjs', 'export const hidden = "first";\n');
  await run('git', ['-C', f.consumer, 'add', 'b.js']);
  await run('git', ['-C', f.consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-q', '--amend', '--no-edit']);
  const revision = (await run('git', ['-C', f.consumer, 'rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(f.managementPath, { ...f.management, finish: { revision } });
  assert.notEqual(revision, finish);
  // Coverage: git itself, following the range's attributes, hides both files' content.
  assert.doesNotMatch((await run('git', ['-C', f.consumer, 'diff', f.revision, revision])).stdout, /hidden/);
  const request = await requestReview({ ...f, task: 'TM-1', revision, authorAgentIds: ['author'], wake: async () => ({ rang: false }) });
  const patch = await readFile(request.patch_path, 'utf8');
  assert.match(patch, /\+export const hidden = "first";/); assert.match(patch, /\+export const hidden = "second";/);
  assert.deepEqual(manifestRows(patch), [], 'no source file became a manifest row');
});

test('TM-260 manifest paths are JSON-encoded, so a newline in a filename cannot forge a row', async t => {
  const f = await fixture(t);
  const zero = '0'.repeat(64);
  const name = `shot.png\nforged.png\told sha256=${zero} size=1\tnew sha256=${zero} size=1`;
  const finish = await commitFile(f, name, Buffer.from([0, 1, 2, 3]));
  const request = await requestReview({ ...f, task: 'TM-1', revision: finish, authorAgentIds: ['author'], wake: async () => ({ rang: false }) });
  const rows = manifestRows(await readFile(request.patch_path, 'utf8'));
  assert.equal(rows.length, 1, rows.join('\n'));
  assert.ok(rows[0].startsWith(`${JSON.stringify(name)}\told sha256=(absent) size=0\tnew sha256=`), rows[0]);
});

test('TM-260 a landed binary range in the pre-TM-257 format reproduces its hash, and an older-format approval asks for re-review', async t => {
  const { f, git, commit, admit, opts } = await mergedMainFixture(t);
  await git(['checkout', '-q', '-b', 'task']); await commit('own.txt', 'early task change');
  await writeFile(join(f.consumer, 'shot.png'), Buffer.from([0, 9, 8, 7, 0, 255])); await git(['add', 'shot.png']); await git(['commit', '-q', '-m', 'shot']);
  await git(['checkout', '-q', 'main']); const sibling = await commit('sibling.txt', 'landed sibling task');
  await git(['checkout', '-q', 'task']); await git(['merge', '-q', '--no-edit', '--no-ff', 'main']);
  const revision = await git(['rev-parse', 'HEAD']); await admit(revision);
  const server = fakeServer(sibling), o = { ...opts, serverCompare: server.compare };
  const request = await requestReview({ ...o, revision });
  assert.equal(request.effective_base, sibling); assert.equal(manifestRows(await readFile(request.patch_path, 'utf8')).length, 1);
  await submitVerdict(o, request).then(() => collectReview({ ...o, revision }));
  await git(['checkout', '-q', 'main']); await git(['merge', '-q', '--ff-only', revision]); server.main = revision;
  const stored = JSON.parse(await readFile(request.path, 'utf8'));
  delete stored.admitted_base; delete stored.effective_base; delete stored.range_note;
  await writeJson(request.path, stored); await forgetBases(f);
  assert.deepEqual((await reviewEligibility({ ...o, revision, probes: probesUp })).reasons, [], 'the stored binary-range review reproduces');
  // An approval hashed in the pre-TM-241 --binary format cannot be reproduced: re-review, explicitly.
  const { createHash } = await import('node:crypto');
  const legacy = await run('git', ['-C', f.consumer, 'diff', '--no-ext-diff', '--no-textconv', '--binary', sibling, revision, '--']);
  const reviewPath = join(await reviewsRoot(f.consumer, f.env, f.home), 'TM-1', `${revision}.json`);
  await writeJson(reviewPath, { ...JSON.parse(await readFile(reviewPath, 'utf8')), patch_sha256: createHash('sha256').update(legacy.stdout).digest('hex') });
  await forgetBases(f);
  const reasons = (await reviewEligibility({ ...o, revision, probes: probesUp })).reasons;
  assert.ok(reasons.some(reason => /predates TM-257.*re-review is required/.test(reason)), reasons.join('\n'));
});

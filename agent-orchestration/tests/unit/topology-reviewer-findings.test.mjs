// TM-215: structured reviewer findings and the request/collect fixes. One test per change.
// TM-365: verdicts are submitted through submitReviewVerdict (the review_submit tool) and collected
// from that record; the pane-parsing tests this file used to hold went with the pane parser.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { loadConfig } from '../../topology/lib/config.mjs';
import { composePrompt } from '../../topology/lib/prompts.mjs';
import { sealVerdict } from '../../topology/lib/reviewer.mjs';
import { buildReviewerArgv, collectPendingReviews, collectReview, currentReviewStatus, ensureReviewer, independentReviewStatus, latestReview,
  recordReview, requestReview, reviewEligibility, reviewerInboxRoot, reviewsRoot, submitReviewVerdict, validateFindings } from '../../topology/lib/reviewer.mjs';
import { submitVerdict } from '../helpers/review-submit.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// TM-427: panePid is this process, so the real pane-ancestry proof passes for the fixture reviewer.
const binding = { serverKey: '/test/socket', serverPid: 10, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: process.pid };
const finding = (extra = {}) => ({ severity: 'minor', file: 'src/a.js', line: 2, claim: 'Name is unclear.', evidence: 'Line 2 adds `x`.', fix: 'Rename it.', ...extra });
const requestPath = async f => join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
const verdictFile = async f => join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'verdicts', `TM-1-${f.revision}.json`);

// A task whose admitted range changes src/a.js, so findings have a real file to point at.
async function fixture(t, reviewerBinding = binding, changed = ['src/a.js'], cli = 'codex') {
  const root = await mkdtemp(join(tmpdir(), 'ao-findings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  const git = args => run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args]);
  await mkdir(join(consumer, 'src'), { recursive: true }); await run('git', ['init', '-q', consumer]);
  await git(['commit', '--allow-empty', '-q', '-m', 'base']);
  const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  for (const path of changed) {
    await mkdir(dirname(join(consumer, path)), { recursive: true });
    await writeFile(join(consumer, path), Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
  }
  await git(['add', '.']); await git(['commit', '-q', '-m', 'change']);
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli, instructions: 'Review.' } }, management: { reviewer_providers: ['codex', 'claude'] } });
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config'), AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state') };
  const { canonicalRepoId, repoKey } = await import('../../topology/lib/repoid.mjs');
  const identity = await canonicalRepoId(consumer);
  const managementPath = join(env.AGENT_ORCHESTRATION_STATE_HOME, 'management', repoKey(identity.id), 'TM-1.json');
  await writeJson(managementPath, { started: true, task: 'TM-1', owner: 'author', repo_id: identity.id, base_revision: base, finish: { revision } });
  const f = { consumer, pluginRoot, home, env, revision, base, root };
  const { record } = await ensureReviewer({ ...f, probes: { alive: async () => false, open: async () => ({ session: 'review', pane: reviewerBinding.paneId, binding: reviewerBinding }) } });
  const args = { ...f, task: 'TM-1', reviewerId: record.agent_id, authorAgentIds: ['author'], env: { ...env, AO_AGENT_ID: record.agent_id } };
  return { ...f, record, args };
}

test('findings must be structured and name a file in the reviewed diff', async t => {
  const { args } = await fixture(t);
  const refuse = findings => assert.rejects(recordReview({ ...args, verdict: 'changes_requested', findings }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await refuse(['fix the bug']);
  await refuse([finding({ severity: 'critical' })]);
  await refuse([finding({ line: 0 })]);
  await refuse([finding({ line: '2' })]);
  await refuse([finding({ evidence: '' })]);
  await refuse([{ severity: 'major', file: 'src/a.js', line: 2, claim: 'x', evidence: 'y' }]);
  await refuse([finding({ severity: 'major', file: 'src/elsewhere.js' })]);
  const review = await recordReview({ ...args, verdict: 'changes_requested', findings: [finding({ severity: 'major', file: './src/a.js', extra: 'dropped' })] });
  assert.deepEqual(review.findings, [{ severity: 'major', file: 'src/a.js', line: 2, claim: 'Name is unclear.', evidence: 'Line 2 adds `x`.', fix: 'Rename it.' }]);
});

test('approve stands with minor and nit findings; blocker and major findings block it', async t => {
  const f = await fixture(t);
  for (const severity of ['blocker', 'major']) {
    await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [finding({ severity })] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  }
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const findings = [finding(), finding({ severity: 'nit', line: 1 })];
  await submitVerdict(f, request, 'approve', findings);
  await collectReview(f.args);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'approved');
  assert.equal((await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } })).eligible, true);
});

test('changes_requested is its own review state, and needs at least one finding', async t => {
  const f = await fixture(t);
  await assert.rejects(recordReview({ ...f.args, verdict: 'changes_requested', findings: [] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  await submitVerdict(f, request, 'changes_requested', [finding({ severity: 'major' })]);
  await collectReview(f.args);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'changes_requested');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'changes-requested');
  const gate = await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } });
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasons.some(reason => reason.includes('"changes_requested"')));
  await recordReview({ ...f.args, verdict: 'blocked', findings: [] });
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'blocked');
});

test('a re-review keeps the earlier record in history and the current one resolvable', async t => {
  const f = await fixture(t);
  await recordReview({ ...f.args, verdict: 'changes_requested', findings: [finding({ severity: 'major' })] });
  await new Promise(resolve => setTimeout(resolve, 5));
  await recordReview({ ...f.args, verdict: 'approve', findings: [] });
  const dir = join(await reviewsRoot(f.consumer, f.env, f.home), 'TM-1');
  const history = await Promise.all((await readdir(join(dir, 'history'))).sort().map(async name => JSON.parse(await readFile(join(dir, 'history', name), 'utf8'))));
  assert.deepEqual(history.map(r => r.verdict), ['changes_requested', 'approve']);
  assert.equal(JSON.parse(await readFile(join(dir, `${f.revision}.json`), 'utf8')).verdict, 'approve');
  assert.equal((await latestReview(f.consumer, 'TM-1', f.env, f.home)).verdict, 'approve');
});

test('a note is informational: it may omit evidence and fix, never blocks approve, and still needs a file and line in the diff', async t => {
  const f = await fixture(t);
  const note = { severity: 'note', file: 'src/a.js', line: 1, claim: 'The live test is still unrun.' };
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [{ ...note, claim: undefined }] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [{ ...note, line: undefined }] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [{ ...note, file: 'src/other.js' }] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [{ ...note, fix: '' }] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [finding({ severity: 'minor', fix: undefined })] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' }, 'only a note may omit fix');
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  await submitVerdict(f, request, 'approve', [note, { ...note, line: 2, fix: 'None required.' }]);
  const review = await collectReview(f.args);
  assert.deepEqual(review.findings, [note, { ...note, line: 2, fix: 'None required.' }]);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } })).eligible, true);
});

test('after the last failed wake a request is marked failed, the lead is told once, and a new request replaces it', async t => {
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: false, reason: 'composer-busy' }) });
  const path = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
  const sent = [];
  const options = { ...f, lead: async () => ({ record: { agent_id: 'the-lead' } }), deliver: async message => { sent.push(message); return { status: 'delivered', envelope: { id: message.id } }; } };
  await writeJson(path, { ...JSON.parse(await readFile(path, 'utf8')), delivery: { rang: false, reason: 'composer-busy', attempts: 5, at: new Date().toISOString() } });
  const [result] = await collectPendingReviews(options);
  assert.equal(result.state, 'failed');
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.state, 'failed'); assert.equal(stored.escalation.status, 'delivered');
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'the-lead'); assert.match(sent[0].body, /REVIEW REQUEST FAILED: TM-1/);
  assert.deepEqual(await collectPendingReviews(options), [], 'a failed request is not retried');
  assert.equal(sent.length, 1);
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'failed');
  const fresh = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  assert.notEqual(fresh.nonce, request.nonce);
});

test('changes_requested needs a blocker or major finding', async t => {
  const f = await fixture(t);
  for (const severity of ['minor', 'nit', 'note']) {
    await assert.rejects(recordReview({ ...f.args, verdict: 'changes_requested', findings: [finding({ severity })] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' }, severity);
  }
  for (const severity of ['blocker', 'major']) {
    assert.equal((await recordReview({ ...f.args, verdict: 'changes_requested', findings: [finding(), finding({ severity })] })).verdict, 'changes_requested');
  }
});

test('the reviewer gets a common prompt without reply files or commands; other roles keep the shared one', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ao-common-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, XDG_CONFIG_HOME: join(root, 'config') };
  const loaded = await loadConfig({ consumer: root, home: root, pluginRoot: PLUGIN, env });
  const agent = { id: 'abc12345', full_name: 'Rae Vance', first_name: 'Rae', last_name: 'Vance', title: 'Reviewer', instructions: '' };
  const reviewer = await composePrompt({ agent: { ...agent, role: 'reviewer' }, consumer: root, dir: root, loaded, templateName: 'reviewer-default' });
  const lead = await composePrompt({ agent: { ...agent, role: 'lead' }, consumer: root, dir: root, loaded, templateName: 'lead-default' });
  assert.equal(reviewer.ok, true); assert.equal(lead.ok, true);
  assert.ok(reviewer.sources.find(s => s.layer === 'defaults common').path.endsWith('common-reviewer.md'));
  assert.doesNotMatch(reviewer.text, /outbox path|prompt ack` command|mailbox inbox/);
  assert.match(reviewer.text, /cannot run commands or write files/);
  assert.match(lead.text, /outbox path/);
});

test('the reviewer prompt asks for evidence from the request instead of checks it cannot run', async () => {
  const text = await readFile(join(PLUGIN, 'prompts', 'reviewer.md'), 'utf8');
  assert.doesNotMatch(text, /say what you verified/);
  assert.match(text, /do not approve on the strength of that check/);
  for (const field of ['severity', 'file', 'line', 'claim', 'evidence', 'fix']) assert.match(text, new RegExp('`' + field + '`'));
});

test('reviewer argv stays restricted and never auto-approves', () => {
  const adapter = { id: 'claude', command: 'claude', args: [], model_args: [], system_prompt_args: [], add_dir_args: ['--add-dir', '{{dir}}'], auto_approve_args: ['--dangerously-skip-permissions'] };
  const argv = buildReviewerArgv(adapter, { args: [], env: {}, mcp: [], auto_approve: true }, {}, { consumer: '/repo' });
  assert.ok(argv.includes('--restricted')); assert.ok(argv.includes('--setting-sources'));
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
  assert.throws(() => buildReviewerArgv(adapter, { args: ['--dangerously-skip-permissions'] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
});

test('review publish carries the whole response, findings included, and refuses a malformed one', async t => {
  const { createFileTransport } = await import('../../topology/lib/orch-transport.mjs');
  const { publishReviewerVerdict, awaitReviewerVerdict } = await import('../../topology/lib/reviewer.mjs');
  const transport = createFileTransport();
  t.after(() => transport.close());
  const response = { verdict: 'changes_requested', findings: [quoting] };
  const b64 = value => `b64:${Buffer.from(JSON.stringify(value)).toString('base64')}`;
  for (const sent of [b64(response), JSON.stringify(response)]) {
    const wait = await awaitReviewerVerdict({ repo: 'r', nonce: 'n1', transport });
    await publishReviewerVerdict({ repo: 'r', nonce: 'n1', response: sent, transport });
    assert.deepEqual(JSON.parse((await wait.received).body), response);
  }
  for (const [sent, code] of [[undefined, 'TOPOLOGY_REVIEWER_RESPONSE'], ['b64:!!', 'TOPOLOGY_REVIEWER_RESPONSE'], [b64({ verdict: 'approve' }), 'TOPOLOGY_REVIEWER_FINDINGS']]) {
    await assert.rejects(publishReviewerVerdict({ repo: 'r', nonce: 'n2', response: sent, transport }), { code });
  }
});

const quoting = finding({ severity: 'major', evidence: 'It runs rm -f "$GW_TMPDIR_LINK" before the ln, and sets GOMAXPROCS="${GOMAXPROCS:-1}".', fix: 'Quote it: "x" — then a TeamCity build cancelled  twice.' });

test('TM-365 a verdict travels as JSON: quotes, backslashes and double spaces arrive intact', async t => {
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const findings = [quoting, finding({ severity: 'note', line: 3, claim: 'A literal \\u{2014} and {"enabled": true} survive.' })];
  const submitted = await submitVerdict(f, request, 'changes_requested', findings);
  assert.equal(submitted.ok, true); assert.equal(submitted.findings, 2);
  const review = await collectReview(f.args);
  assert.equal(review.verdict, 'changes_requested');
  assert.equal(review.findings[0].evidence, quoting.evidence);
  assert.equal(review.findings[0].fix, quoting.fix, 'a double space and an em dash survive');
  assert.equal(review.findings[1].claim, findings[1].claim);
});

test('TM-365 a refused submission tells the reviewer why and leaves the request open; a corrected one records', async t => {
  const f = await fixture(t);
  const mail = { lead: async () => null, deliver: async () => assert.fail('a refused submission is not escalated') };
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  await assert.rejects(submitVerdict(f, request, 'approve', [finding({ severity: 'major' })]), { code: 'TOPOLOGY_REVIEWER_FINDINGS', message: /minor, nit or note/ });
  await assert.rejects(submitVerdict(f, request, 'lgtm', []), { code: 'TOPOLOGY_REVIEWER_VERDICT' });
  await assert.rejects(submitVerdict(f, request, 'approve', [finding({ file: 'src/elsewhere.js' })]), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  await assert.rejects(collectReview({ ...f.args, ...mail }), { code: 'TOPOLOGY_REVIEWER_NO_VERDICT' });
  assert.notEqual(JSON.parse(await readFile(await requestPath(f), 'utf8')).state, 'failed', 'nothing was submitted, so nothing failed');
  // Resubmitting before collection replaces the earlier verdict.
  await submitVerdict(f, request, 'blocked', []);
  await submitVerdict(f, request, 'approve', [finding()]);
  const review = await collectReview({ ...f.args, ...mail });
  assert.equal(review.verdict, 'approve'); assert.equal(review.request_nonce, request.nonce);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
});

test('TM-365 the pending queue waits for a submission, then collects it on the next tick', async t => {
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const [waiting] = await collectPendingReviews(f);
  assert.equal(waiting.state, 'awaiting-review'); assert.equal(waiting.code, 'TOPOLOGY_REVIEWER_NO_VERDICT');
  await submitVerdict(f, request, 'approve', []);
  const [done] = await collectPendingReviews(f);
  assert.equal(done.state, 'collected'); assert.equal(done.verdict, 'approve');
});

test('TM-365 a submitted verdict is mirrored to the ORCH_REVIEWS object store when NATS is live', async t => {
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const objects = new Map(), published = [];
  const transport = { kind: 'nats',
    putReview: async ({ bytes }) => { const name = `obj-${objects.size}`; objects.set(name, String(bytes)); return { via: 'nats', bucket: 'ORCH_REVIEWS', name }; },
    publishVerdict: async ({ repo, nonce, body }) => { published.push({ nonce, body }); return { subject: `orch.${repo}.review.${nonce}` }; } };
  const result = await submitVerdict(f, request, 'approve', [finding()], { transport });
  assert.deepEqual(result.mirror, { bucket: 'ORCH_REVIEWS', name: 'obj-0' });
  assert.equal(JSON.parse(objects.get('obj-0')).nonce, request.nonce);
  assert.equal(published[0].nonce, request.nonce);
  assert.equal(JSON.parse(await readFile(await verdictFile(f), 'utf8')).mirror.name, 'obj-0', 'the durable record names its mirror');
  // A NATS failure never loses the verdict: the file is the record.
  const broken = { kind: 'nats', putReview: async () => { throw new Error('NATS down'); } };
  assert.equal((await submitVerdict(f, request, 'approve', [], { transport: broken })).mirror, null);
  assert.equal((await collectReview(f.args)).verdict, 'approve');
});

test('TM-365 a verdict file that fails the schema at collection fails its request once and tells the lead', async t => {
  const f = await fixture(t);
  const sent = [];
  const mail = { lead: async () => ({ record: { agent_id: 'the-lead' } }), deliver: async message => { sent.push(message); return { status: 'delivered', envelope: { id: message.id } }; } };
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  // Sealed but written past submitReviewVerdict's schema check, as an older release's record would be.
  // (An unsealed, hand-edited record is ignored outright: topology-reviewer.test.mjs, TM-427.)
  await writeJson(await verdictFile(f), await sealVerdict({ nonce: request.nonce, task: 'TM-1', revision: f.revision, reviewer_id: f.record.agent_id, binding, verdict: 'approve', findings: [finding({ severity: 'major' })] }, f.env, f.home));
  await assert.rejects(collectReview({ ...f.args, ...mail }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  const stored = JSON.parse(await readFile(await requestPath(f), 'utf8'));
  assert.equal(stored.state, 'failed'); assert.equal(stored.failure.code, 'TOPOLOGY_REVIEWER_FINDINGS');
  assert.equal(sent.length, 1); assert.match(sent[0].body, /verdict was refused/);
  await assert.rejects(collectReview({ ...f.args, ...mail }), { code: 'TOPOLOGY_REVIEWER_REQUEST_FAILED' });
  await assert.rejects(submitVerdict(f, request, 'approve', []), { code: 'TOPOLOGY_REVIEWER_REQUEST_FAILED' });
  assert.equal(sent.length, 1, 'the lead was told once');
  assert.equal(await latestReview(f.consumer, 'TM-1', f.env, f.home), null, 'no verdict recorded under the failed nonce');
  const fresh = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  assert.notEqual(fresh.nonce, request.nonce);
  await submitVerdict(f, fresh, 'approve', [finding()]);
  assert.equal((await collectReview({ ...f.args, ...mail })).request_nonce, fresh.nonce, 'the stale verdict file does not answer the fresh nonce');
});

test('TM-365 no code path reads a verdict off the reviewer pane', async () => {
  const reviewer = await import('../../topology/lib/reviewer.mjs');
  for (const gone of ['parseReviewResponse', 'reviewResponsesOnScreen', 'REVIEW_INCOMPLETE_BOUND_MS']) assert.equal(reviewer[gone], undefined, gone);
  const source = await readFile(join(PLUGIN, 'topology', 'lib', 'reviewer.mjs'), 'utf8');
  const collect = source.slice(source.indexOf('export async function collectReview'), source.indexOf('/** A repository tick collects'));
  assert.ok(collect.length > 500, 'found collectReview');
  assert.doesNotMatch(collect, /output\(|capture-pane|reviewerOutput/);
});

test('TM-365 the review_submit MCP tool lists one tool and submits through the same check', async t => {
  const { handleMessage } = await import('../../topology/review-mcp.mjs');
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  assert.equal(init.result.serverInfo.name, 'ao-review');
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const listed = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(listed.result.tools.map(tool => tool.name), ['review_submit']);
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const env = { ...f.env, AO_AGENT_ID: f.record.agent_id, AO_CONSUMER: f.consumer };
  const submit = options => submitReviewVerdict({ ...options, home: f.home, alive: async () => true });
  const refused = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'review_submit', arguments: { request: request.nonce, verdict: 'approve', findings: [finding({ severity: 'blocker' })] } } }, { env, submit });
  assert.equal(refused.result.isError, true); assert.match(refused.result.content[0].text, /TOPOLOGY_REVIEWER_FINDINGS/);
  const ok = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'review_submit', arguments: { request: request.nonce, verdict: 'approve', findings: [] } } }, { env, submit });
  assert.equal(ok.result.isError, undefined); assert.match(ok.result.content[0].text, /approve submitted for TM-1/);
  assert.equal((await collectReview(f.args)).verdict, 'approve');
});

test('TM-365 the reviewer argv grants the review_submit server and its one tool, and nothing else', async () => {
  const adapter = { id: 'claude', command: 'claude', args: [], model_args: [], system_prompt_args: [], add_dir_args: ['--add-dir', '{{dir}}'] };
  const argv = buildReviewerArgv(adapter, { id: 'rev1', args: [], env: {}, mcp: [] }, {}, { consumer: '/repo' });
  const config = JSON.parse(argv[argv.indexOf('--mcp-config') + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ['ao-review']);
  assert.match(config.mcpServers['ao-review'].args[0], /topology\/review-mcp\.mjs$/);
  const serverEnv = config.mcpServers['ao-review'].env;
  assert.equal(serverEnv.AO_AGENT_ID, 'rev1'); assert.equal(serverEnv.AO_CONSUMER, '/repo');
  const { reviewSubmitMcpConfig } = await import('../../topology/lib/reviewer.mjs');
  const pinned = JSON.parse(reviewSubmitMcpConfig({ agentId: 'rev1', env: { AGENT_ORCHESTRATION_STATE_HOME: '/state', AO_NATS_URL: 'nats://user:secret@host', AO_ORCH_CREDS: '/creds' } })).mcpServers['ao-review'].env;
  assert.deepEqual(pinned, { AGENT_ORCHESTRATION_STATE_HOME: '/state', AO_AGENT_ID: 'rev1' }, 'state root pinned; no NATS URL or credentials in the launcher');
  assert.equal(argv[argv.indexOf('--allowed-tools') + 1], 'mcp__ao-review__review_submit');
  assert.ok(argv.includes('--strict-mcp-config') && argv.includes('--restricted') && argv[argv.indexOf('--setting-sources') + 1] === '');
});

test('TM-365 the reviewer is told to submit through the tool, never to print the verdict', async () => {
  const text = await readFile(join(PLUGIN, 'prompts', 'reviewer.md'), 'utf8');
  assert.match(text, /review_submit/); assert.doesNotMatch(text, /AO_REVIEW <nonce>|b64:/);
  const { reviewerProtocolPrompt } = await import('../../topology/lib/reviewer.mjs');
  const protocol = reviewerProtocolPrompt({ id: 'rev1', full_name: 'Rae Vance', role: 'reviewer', _dir: '/agents/rev1' }, '/repo', '/inbox');
  assert.match(protocol, /mcp__ao-review__review_submit/); assert.doesNotMatch(protocol, /b64:/);
});

test('TM-367 every finding carries a severity; minor and nit ride an approval; a CHANGELOG.md finding is accepted', async t => {
  const f = await fixture(t);
  // No severity, or one outside the four plus note, is refused.
  await assert.rejects(submitVerdict(f, await requestReview({ ...f.args, wake: async () => ({ rang: true }) }), 'approve', [finding({ severity: undefined })]), { code: 'TOPOLOGY_REVIEWER_FINDINGS', message: /severity must be one of blocker, major, minor, nit/ });
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  // CHANGELOG.md is not in this diff (only src/a.js is), at the root or in a plugin directory.
  const changelog = [finding({ file: 'CHANGELOG.md', line: 3, claim: 'No entry for this change.' }), finding({ severity: 'nit', file: 'agent-orchestration/CHANGELOG.md', line: 1 })];
  await submitVerdict(f, request, 'approve', [finding({ severity: 'nit' }), ...changelog]);
  const review = await collectReview(f.args);
  assert.equal(review.verdict, 'approve');
  assert.deepEqual(review.findings.map(x => [x.severity, x.file]), [['nit', 'src/a.js'], ['minor', 'CHANGELOG.md'], ['nit', 'agent-orchestration/CHANGELOG.md']]);
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'approved');
  assert.equal((await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } })).eligible, true);
  // A major CHANGELOG finding requests changes; other files outside the diff are still refused.
  assert.equal((await recordReview({ ...f.args, verdict: 'changes_requested', findings: [finding({ severity: 'major', file: 'CHANGELOG.md' })] })).verdict, 'changes_requested');
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [finding({ file: 'README.md' })] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS', message: /README\.md, which is not in the reviewed diff/ });
  await assert.rejects(recordReview({ ...f.args, verdict: 'approve', findings: [finding({ file: 'CHANGELOG.md.bak' })] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
});

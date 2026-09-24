// TM-215: structured reviewer findings and the request/collect fixes. One test per change.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { loadConfig } from '../../topology/lib/config.mjs';
import { composePrompt } from '../../topology/lib/prompts.mjs';
import { buildReviewerArgv, collectPendingReviews, collectReview, currentReviewStatus, ensureReviewer, independentReviewStatus, latestReview,
  parseReviewResponse, recordReview, requestReview, reviewEligibility, reviewerInboxRoot, reviewsRoot } from '../../topology/lib/reviewer.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const binding = { serverKey: '/test/socket', serverPid: 10, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 20 };
const finding = (extra = {}) => ({ severity: 'minor', file: 'src/a.js', line: 2, claim: 'Name is unclear.', evidence: 'Line 2 adds `x`.', fix: 'Rename it.', ...extra });
const say = (nonce, response) => `AO_REVIEW ${nonce} ${JSON.stringify(response)}`;

// A task whose admitted range changes src/a.js, so findings have a real file to point at.
async function fixture(t, reviewerBinding = binding) {
  const root = await mkdtemp(join(tmpdir(), 'ao-findings-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo'), pluginRoot = join(root, 'plugin'), home = join(root, 'home');
  const git = args => run('git', ['-C', consumer, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args]);
  await mkdir(join(consumer, 'src'), { recursive: true }); await run('git', ['init', '-q', consumer]);
  await git(['commit', '--allow-empty', '-q', '-m', 'base']);
  const base = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeFile(join(consumer, 'src', 'a.js'), 'export const a = 1;\nexport const x = 2;\n');
  await git(['add', '.']); await git(['commit', '-q', '-m', 'change']);
  const revision = (await git(['rev-parse', 'HEAD'])).stdout.trim();
  await writeJson(join(pluginRoot, 'config.defaults.json'), { reviewer: { template: 'r' }, templates: { r: { role: 'reviewer', cli: 'codex', instructions: 'Review.' } }, management: { reviewer_providers: ['codex', 'claude'] } });
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
  await collectReview({ ...f.args, output: async () => say(request.nonce, { verdict: 'approve', findings }) });
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'approved');
  assert.equal((await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } })).eligible, true);
});

test('changes_requested is its own review state, and needs at least one finding', async t => {
  const f = await fixture(t);
  await assert.rejects(recordReview({ ...f.args, verdict: 'changes_requested', findings: [] }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  await collectReview({ ...f.args, output: async () => say(request.nonce, { verdict: 'changes_requested', findings: [finding({ severity: 'major' })] }) });
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

test('repeated identical verdicts and output after the verdict are accepted; disagreeing copies are not', () => {
  const nonce = '11111111-2222-3333-4444-555555555555';
  const response = { verdict: 'approve', findings: [] };
  const screen = [`● ${say(nonce, response)}`, 'some later text', `● ${say(nonce, response)}`, '', '> '].join('\n');
  assert.deepEqual(parseReviewResponse(screen, nonce), response);
  assert.throws(() => parseReviewResponse(`${say(nonce, response)}\n${say(nonce, { verdict: 'blocked', findings: [] })}`, nonce), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  assert.throws(() => parseReviewResponse(say('other', response), nonce), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  assert.throws(() => parseReviewResponse(`AO_REVIEW ${nonce} {"verdict":`, nonce), { message: /must be JSON/ });
});

// Wrap `text` the way Claude Code's renderer (wrap-ansi, hard) does: a "● " bullet, continuations
// indented two spaces, word wrap at a space (the space is dropped), and a word too long for any row
// started on the current row and cut mid-token at the full width.
function claudeWrap(text, width) {
  const w = width - 2, rows = [''];
  for (const word of text.split(' ')) {
    const row = rows.at(-1), sep = row ? ' ' : '';
    if (row.length + sep.length + word.length <= w) { rows[rows.length - 1] = row + sep + word; continue; }
    if (word.length > w && row.length + sep.length < w) rows[rows.length - 1] = row + sep; else rows.push('');
    let rest = word;
    while (rows.at(-1).length + rest.length > w) {
      const take = w - rows.at(-1).length;
      rows[rows.length - 1] += rest.slice(0, take); rest = rest.slice(take); rows.push('');
    }
    rows[rows.length - 1] += rest;
  }
  return rows.map((row, i) => (i ? '  ' : '● ') + row);
}

test('a verdict Claude Code hard-wrapped across indented pane lines is rejoined', () => {
  const nonce = 'a6a2f0a4-3c1e-4f55-9d0b-0c3b7e6f1d22';
  // As seen live: the first line ends mid-JSON after "findings":, and continuations start with two spaces.
  const observed = [
    '● Reviewed the complete patch against the admission base.',
    '',
    `● AO_REVIEW ${nonce} {"verdict":"changes_requested","findings":`,
    '  [{"severity":"major","file":"src/a.js","line":2,"claim":"Approval is',
    '  refused for any finding.","evidence":"Line 2 checks','  length.","fix":"Allow minor findings."}]}',
    '',
    '> ',
  ].join('\n');
  assert.deepEqual(parseReviewResponse(observed, nonce), { verdict: 'changes_requested', findings: [
    { severity: 'major', file: 'src/a.js', line: 2, claim: 'Approval is refused for any finding.', evidence: 'Line 2 checks length.', fix: 'Allow minor findings.' }] });
  // Generated at several widths: a long path and compact JSON are cut mid-token, prose is word-wrapped.
  const response = { verdict: 'changes_requested', findings: [
    { severity: 'major', file: 'agent-orchestration/topology/lib/some/deeply/nested/directory/reviewer-collection.mjs', line: 651,
      claim: 'Approval is refused for any finding, including a nit, so a clean review with advice cannot pass.',
      evidence: 'Line 651 compares findings.length to zero before the verdict is considered.', fix: 'Allow minor and nit findings on approve.' },
    finding({ severity: 'nit', line: 1 })] };
  for (const width of [60, 80, 100, 133]) {
    const screen = ['● Done.', ...claudeWrap(say(nonce, response), width), '', '> '].join('\n');
    assert.ok(screen.split('\n').length > 4, `width ${width} actually wraps`);
    assert.deepEqual(parseReviewResponse(screen, nonce), response, `width ${width}`);
  }
});

test('collection reads a verdict that has scrolled far above the bottom of the pane', async t => {
  const socket = join(await mkdtemp(join(tmpdir(), 'ao-tmux-')), 's');
  t.after(() => run('tmux', ['-S', socket, 'kill-server'], { allowFailure: true }));
  const signal = join(dirname(socket), 'verdict.txt');
  await run('tmux', ['-S', socket, 'new-session', '-d', '-x', '200', '-y', '40', '-s', 'review', `sh -c 'while [ ! -f ${signal} ]; do sleep 0.1; done; cat ${signal}; seq 1 400; echo DONE; sleep 60'`]);
  const { listServerPanes } = await import('../../topology/lib/tmux.mjs');
  const observed = (await listServerPanes({ tmuxServer: socket }))[0];
  const f = await fixture(t, observed);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  await writeFile(signal, `● ${say(request.nonce, { verdict: 'approve', findings: [] })}\n`);
  for (let i = 0; i < 100; i++) {
    const shown = (await run('tmux', ['-S', socket, 'capture-pane', '-p', '-t', observed.paneId])).stdout;
    if (shown.includes('DONE')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  const review = await collectReview(f.args);
  assert.equal(review.verdict, 'approve');
});

test('after the last failed wake a request is marked failed, the lead is told once, and a new request replaces it', async t => {
  const f = await fixture(t);
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: false, reason: 'composer-busy' }) });
  const path = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
  const sent = [];
  const options = { ...f, output: async () => '', lead: async () => ({ record: { agent_id: 'the-lead' } }), deliver: async message => { sent.push(message); return { status: 'delivered', envelope: { id: message.id } }; } };
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
  assert.ok(argv.includes('--restricted')); assert.ok(argv.includes('--safe-mode'));
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
  assert.throws(() => buildReviewerArgv(adapter, { args: ['--dangerously-skip-permissions'] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
});

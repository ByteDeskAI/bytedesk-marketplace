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
  parseReviewResponse, recordReview, requestReview, reviewEligibility, reviewerInboxRoot, reviewsRoot, validateFindings } from '../../topology/lib/reviewer.mjs';

const PLUGIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const binding = { serverKey: '/test/socket', serverPid: 10, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 20 };
const finding = (extra = {}) => ({ severity: 'minor', file: 'src/a.js', line: 2, claim: 'Name is unclear.', evidence: 'Line 2 adds `x`.', fix: 'Rename it.', ...extra });
const say = (nonce, response) => `AO_REVIEW ${nonce} ${JSON.stringify(response)}`;

// Captured read-only from the live reviewer pane %289 (TM-214 round 3) with
// `tmux capture-pane -p -J -S -3000`, kept verbatim: the first verdict row fills the 2000-column pane
// and ends with the space it wrapped at; the continuation is indented two spaces.
const LIVE_WRAPPED_VERDICT = [
  "",
  "● AO_REVIEW 9168d438-f7ab-4b16-9b94-46328896f3c6 {\"verdict\":\"approve\",\"revision\":\"8965c3a55f4e620b66dbea1b6d426315f2af998f\",\"base_revision\":\"7f15ac95745d8028bc2b2553367eeb03b393526c\",\"task\":\"TM-214\",\"findings\":[{\"id\":1,\"severity\":\"note\",\"file\":\"agent-orchestration/tests/live/two-projects.sh:146\",\"summary\":\"The edited live tmux assertion is still unrun. Its expected text 'auto_approve is on for boss' matches the warning in launch.mjs.\",\"resolve\":\"Run it before merge, or record in the gate that it was not run.\"},{\"id\":2,\"severity\":\"note\",\"file\":\"agent-orchestration/topology/lib/spec.mjs:347\",\"summary\":\"Behaviour change: a spec that references the stored reviewer with an agent entry is now refused with TOPOLOGY_REVIEWER_READ_ONLY. Before, it launched a prompting pane. No shipped workflow uses an agent entry. agentAddress also goes through expandAgentRefs, so it fails early with the same code. The CHANGELOG covers this.\",\"resolve\":\"None required.\"}],\"previous_findings\":{\"reviewed_revision\":\"6c93e69fee0e82d78e86784bcbba7d471912b7ff\",\"1_spec_reference_to_reviewer\":\"resolved: expandAgentRefs refuses any stored agent with role reviewer before the inline merge, so an inline auto_approve true cannot override the stored false (spec.mjs:344-349, invariant is imported at line 7). The new test covers an id reference with inline auto_approve true and a full-name reference, plus a worker control case. The existing library-reference test is moved to a worker role, and its assertions still hold.\",\"2_live_test\":\"still open, see finding 1\"},\"verified\":[\"Reviewed the whole base..revision patch, 19 files, all under agent-orchestration/. The only change from 6c93e69 is the spec.mjs reviewer-reference refusal, its test, the adjusted library test and the CHANGELOG line.\",\"AC1: a missing key is on and explicit false opts out, in validateSpec and createAgent. A library agent's stored false wins when the entry omits the key.\",\"AC2: the consent gate is removed, --allow-auto-approve is a no-op  ",
  "  and the TM-090 tests are rewritten. The dead error-code check is removed.\",\"AC3: buildReviewerArgv is unchanged (--restricted --safe-mode, empty auto_approve_args). The reviewer is stored with auto_approve false when created and when assigned. session open refuses it, and so does a spec agent reference. Tests assert each of these.\",\"AC4: CHANGELOG, README, topology.md, ADR 0001 supersession note, EP-018-DEMO, claude.json notes and the workflow text are updated. The dist createAgent and assignReviewer match source.\",\"Limit: I did not run any tests, by read-only policy. I relied on the author's reported checks and read the worktree assuming its HEAD is 8965c3a.\"]}",
  "",
  "✻ Baked for 20s · done 1:39 PM",
  "",
  "❯",
  "",
].join('\n');

// A task whose admitted range changes src/a.js, so findings have a real file to point at.
async function fixture(t, reviewerBinding = binding, changed = ['src/a.js']) {
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

test('a live verdict wrapped by Claude Code in a 2000-column pane parses (TM-214 round 3, pane %289)', async () => {
  const screen = LIVE_WRAPPED_VERDICT;
  const response = parseReviewResponse(screen, '9168d438-f7ab-4b16-9b94-46328896f3c6');
  assert.equal(response.verdict, 'approve');
  assert.deepEqual(response.findings.map(f => f.severity), ['note', 'note']);
  assert.ok(response.verified.some(line => line.includes('--allow-auto-approve is a no-op and the TM-090 tests are rewritten')));
  // That reviewer predates the structured schema: `file:line` in one field, summary/resolve instead
  // of claim/fix. It is refused rather than guessed at; the updated prompt asks for the new shape.
  assert.throws(() => validateFindings(response.findings, new Set(['agent-orchestration/tests/live/two-projects.sh', 'agent-orchestration/topology/lib/spec.mjs'])), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
});

test('the live TM-214 round-3 verdict (approve, two notes) records as satisfied once its findings use the schema fields', async t => {
  const nonce = '9168d438-f7ab-4b16-9b94-46328896f3c6';
  const live = parseReviewResponse(LIVE_WRAPPED_VERDICT, nonce);
  const paths = live.findings.map(finding => finding.file.replace(/:\d+$/, ''));
  const f = await fixture(t, binding, paths);
  // The live notes carry `file:line`, summary and resolve. The same notes in the schema's fields:
  const findings = live.findings.map(({ severity, file, summary, resolve }) => ({ severity, file: file.replace(/:\d+$/, ''), line: Number(file.split(':').at(-1)), claim: summary, fix: resolve }));
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const screen = LIVE_WRAPPED_VERDICT
    .replace(nonce, request.nonce).replace(JSON.stringify(live.findings), JSON.stringify(findings));
  const review = await collectReview({ ...f.args, output: async () => screen });
  assert.equal(review.verdict, 'approve');
  assert.deepEqual(review.findings.map(x => [x.severity, x.file, x.line]), [['note', paths[0], 146], ['note', paths[1], 347]]);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'approved');
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
  const review = await collectReview({ ...f.args, output: async () => say(request.nonce, { verdict: 'approve', findings: [note, { ...note, line: 2, fix: 'None required.' }] }) });
  assert.deepEqual(review.findings, [note, { ...note, line: 2, fix: 'None required.' }]);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await reviewEligibility({ ...f.args, probes: { alive: async () => true, responsive: async () => true } })).eligible, true);
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

test('a refused verdict fails its request once; a corrected verdict on the fresh request records', async t => {
  const f = await fixture(t);
  const sent = [];
  const mail = { lead: async () => ({ record: { agent_id: 'the-lead' } }), deliver: async message => { sent.push(message); return { status: 'delivered', envelope: { id: message.id } }; } };
  const first = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const refused = say(first.nonce, { verdict: 'approve', findings: [finding({ severity: 'major' })] });
  await assert.rejects(collectReview({ ...f.args, ...mail, output: async () => refused }), { code: 'TOPOLOGY_REVIEWER_FINDINGS' });
  const path = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.state, 'failed'); assert.equal(stored.failure.code, 'TOPOLOGY_REVIEWER_FINDINGS');
  assert.equal(sent.length, 1); assert.equal(sent[0].to, 'the-lead'); assert.match(sent[0].body, /response was refused/);
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'failed');
  const [pending] = await collectPendingReviews({ ...f, ...mail, output: async () => refused });
  assert.equal(pending, undefined, 'a failed request is not collected again');
  assert.equal(sent.length, 1, 'and the lead is told once');
  const second = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  assert.notEqual(second.nonce, first.nonce);
  // The refused copy is still on screen above the corrected one; it carries the old nonce.
  const screen = [refused, say(second.nonce, { verdict: 'approve', findings: [finding()] })].join('\n');
  const review = await collectReview({ ...f.args, ...mail, output: async () => screen });
  assert.equal(review.request_nonce, second.nonce);
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  assert.equal((await independentReviewStatus({ ...f, task: 'TM-1' })).status, 'approved');
});

test('unparseable and disagreeing responses are refusals too; no response yet is not', async t => {
  const f = await fixture(t);
  const mail = { lead: async () => null, deliver: async () => assert.fail('no lead registered') };
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const path = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
  await assert.rejects(collectReview({ ...f.args, ...mail, output: async () => 'still reading the patch' }), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  assert.notEqual(JSON.parse(await readFile(path, 'utf8')).state, 'failed', 'waiting for an answer is not a refusal');
  const twice = [say(request.nonce, { verdict: 'blocked', findings: [] }), say(request.nonce, { verdict: 'approve', findings: [] })].join('\n');
  await assert.rejects(collectReview({ ...f.args, ...mail, output: async () => twice }), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  const stored = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(stored.state, 'failed'); assert.equal(stored.escalation.status, 'skipped');
});

test('a verdict captured while it is still printing waits for a later capture instead of failing', async t => {
  const f = await fixture(t);
  const mail = { lead: async () => ({ record: { agent_id: 'the-lead' } }), deliver: async () => assert.fail('an incomplete answer is not escalated') };
  const request = await requestReview({ ...f.args, wake: async () => ({ rang: true }) });
  const path = join(await reviewerInboxRoot(f.consumer, f.env, f.home), 'requests', `TM-1-${f.revision}.json`);
  const full = say(request.nonce, { verdict: 'approve', findings: [finding()] });
  for (const partial of [full.slice(0, full.indexOf('"claim"')), `${full.slice(0, 120)}\n> `]) {
    await assert.rejects(collectReview({ ...f.args, ...mail, output: async () => partial }), { code: 'TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE' });
    assert.notEqual(JSON.parse(await readFile(path, 'utf8')).state, 'failed');
  }
  const [tick] = await collectPendingReviews({ ...f, ...mail, output: async () => full.slice(0, 150) });
  assert.equal(tick.state, 'awaiting-review'); assert.equal(tick.code, 'TOPOLOGY_REVIEWER_RESPONSE_INCOMPLETE');
  const [done] = await collectPendingReviews({ ...f, ...mail, output: async () => full });
  assert.equal(done.state, 'collected');
  assert.equal((await currentReviewStatus(f.consumer, 'TM-1', f.revision, f.env, f.home)).state, 'satisfied');
  // Closed but invalid is still a refusal.
  const other = await fixture(t);
  const second = await requestReview({ ...other.args, wake: async () => ({ rang: true }) });
  await assert.rejects(collectReview({ ...other.args, lead: async () => null, output: async () => `AO_REVIEW ${second.nonce} {"verdict":approve}` }), { code: 'TOPOLOGY_REVIEWER_RESPONSE' });
  assert.equal(JSON.parse(await readFile(join(await reviewerInboxRoot(other.consumer, other.env, other.home), 'requests', `TM-1-${other.revision}.json`), 'utf8')).state, 'failed');
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
  assert.ok(argv.includes('--restricted')); assert.ok(argv.includes('--safe-mode'));
  assert.ok(!argv.includes('--dangerously-skip-permissions'));
  assert.throws(() => buildReviewerArgv(adapter, { args: ['--dangerously-skip-permissions'] }, {}, {}), { code: 'TOPOLOGY_REVIEWER_READ_ONLY' });
});

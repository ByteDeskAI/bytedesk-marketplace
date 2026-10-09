// TM-520: doctor and role status compare each live role's MCP children with what the role expects.
// The process table is a fixture: one stale reviewer on the pre-TM-365 argv, one healthy lead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { doctor, verifyRoleMcp } from '../../topology/lib/doctor.mjs';
import { leadRegistryDir } from '../../topology/lib/lead.mjs';
import { canonicalRepoId, repoKey } from '../../topology/lib/repoid.mjs';
import { reviewerInboxRoot, reviewSubmitMcpConfig, reviewersRoot, REVIEW_MCP_SCRIPT } from '../../topology/lib/reviewer.mjs';
import { roleStatus } from '../../topology/lib/roles.mjs';

const exec = promisify(execFile);
const STALE_REVIEWER = ['claude', '--restricted', '--safe-mode', '--strict-mcp-config', '--disallowed-tools', 'Write,Edit', '--append-system-prompt', 'You are a reviewer'];
const HEALTHY_LEAD = ['claude', '--strict-mcp-config', '--append-system-prompt', 'You are the lead'];
const healthyReviewer = () => ['claude', '--restricted', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', reviewSubmitMcpConfig({ agentId: 'rev2' })];

async function fixture(t, table) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ao-role-mcp-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repo = join(root, 'repo'), home = join(root, 'home');
  await mkdir(home, { recursive: true });
  await exec('git', ['init', '-q', repo]);
  const env = { ...process.env, HOME: home, AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), TMUX: '' };
  const key = repoKey((await canonicalRepoId(repo)).id);
  for (const [dir, record] of [[leadRegistryDir(env, home), { agent_id: 'lead1', binding: { panePid: 101 } }], [reviewersRoot(env, home), { agent_id: 'rev1', binding: { panePid: 202 } }]]) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${key}.json`), JSON.stringify(record));
  }
  return { repo, env, home, procs: async (pid) => table[pid] ?? null };
}

test('TM-520: doctor names the live reviewer that lacks review_submit and passes the healthy lead', async (t) => {
  const f = await fixture(t, { 101: { argv: HEALTHY_LEAD, children: [] }, 202: { argv: STALE_REVIEWER, children: [] } });
  const report = await doctor({ adapters: new Map(), workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [], consumer: f.repo, env: f.env, home: f.home, procs: f.procs });
  assert.equal(report.role_mcp.length, 2, 'both roles were checked; an empty report would mean the check never ran');
  const [lead, reviewer] = report.role_mcp;
  assert.equal(lead.role, 'lead');
  assert.equal(lead.expected, 'none');
  assert.equal(lead.ok, true);
  assert.equal(reviewer.ok, false);
  assert.deepEqual(reviewer.missing.map((m) => m.name), ['ao-review']);
  assert.match(reviewer.missing[0].reason, /--safe-mode/);
  assert.match(reviewer.fix.command, /^ao-topology agent restart rev1 --mode handoff/);
  const problems = report.problems.filter((p) => p.code === 'ROLE_MCP_MISSING');
  assert.equal(problems.length, 1);
  assert.match(problems[0].message, /reviewer rev1 \(pid 202\) lacks MCP server\(s\) ao-review/);
});

test('TM-520: role status carries the same verdict, and "expected none" is explicit', async (t) => {
  const f = await fixture(t, { 101: { argv: HEALTHY_LEAD, children: [] }, 202: { argv: STALE_REVIEWER, children: [] } });
  const probes = { alive: async () => true, open: async () => { throw new Error('must not open'); } };
  const reviewer = await roleStatus({ role: 'reviewer', consumer: f.repo, env: f.env, home: f.home, probes, procs: f.procs });
  assert.equal(reviewer.mcp.ok, false);
  assert.equal(reviewer.mcp.missing[0].name, 'ao-review');
  assert.equal(verifyRoleMcp({ role: 'lead', pid: 101, argv: HEALTHY_LEAD, children: [] }).expected, 'none');
});

test('TM-520: a relaunched reviewer whose ao-review child runs is healthy; one whose child died is not', () => {
  const healthy = verifyRoleMcp({ role: 'reviewer', agentId: 'rev2', pid: 9, argv: healthyReviewer(), children: [`${process.execPath} ${REVIEW_MCP_SCRIPT}`] });
  assert.deepEqual(healthy.present, ['ao-review']);
  assert.equal(healthy.ok, true);
  const dead = verifyRoleMcp({ role: 'reviewer', agentId: 'rev2', pid: 9, argv: healthyReviewer(), children: [] });
  assert.equal(dead.ok, false);
  assert.match(dead.missing[0].reason, /no child process runs it/);
});

test('TM-525: with a request pending, doctor names the withdraw, restart, re-request sequence', async (t) => {
  const f = await fixture(t, { 101: { argv: HEALTHY_LEAD, children: [] }, 202: { argv: STALE_REVIEWER, children: [] } });
  const binding = { serverKey: '/s', serverPid: 1, sessionId: '$1', sessionCreated: 1, paneId: '%1', panePid: 202 };
  const key = repoKey((await canonicalRepoId(f.repo)).id);
  await writeFile(join(reviewersRoot(f.env, f.home), `${key}.json`), JSON.stringify({ agent_id: 'rev1', binding }));
  const dir = join(await reviewerInboxRoot(f.repo, f.env, f.home), 'requests');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'TM-16-abc.json'), JSON.stringify({ task: 'TM-16', revision: 'abc', nonce: 'n1', reviewer_id: 'rev1', binding, state: 'published' }));
  const report = await doctor({ adapters: new Map(), workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [], consumer: f.repo, env: f.env, home: f.home, procs: f.procs });
  const reviewer = report.role_mcp.find((r) => r.role === 'reviewer');
  assert.deepEqual(reviewer.fix.pending, [{ task: 'TM-16', revision: 'abc', nonce: 'n1' }]);
  assert.equal(reviewer.fix.sequence.length, 3);
  assert.match(reviewer.fix.sequence[0], /^ao-topology reviewer withdraw --task TM-16 --revision abc --reason /);
  assert.equal(reviewer.fix.sequence[1], reviewer.fix.command);
  assert.match(reviewer.fix.sequence[2], /^ao-topology reviewer request --task TM-16 --revision abc /);
  assert.match(reviewer.fix.note, /withdraws them, restarts, then requests/);
});

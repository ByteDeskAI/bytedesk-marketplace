// TM-361: the supervisor delivers each fresh review-sweep finding once — a review request for a
// governed task with a finish revision, otherwise a standing-mail notice to the lead.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { run, writeJson } from '../../topology/lib/util.mjs';
import { canonicalRepoId, repoKey, stateRoot } from '../../topology/lib/repoid.mjs';
import { reviewSweepTick } from '../../topology/lib/review-sweep.mjs';

const REV = 'a'.repeat(40);

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ao-sweep-')); t.after(() => rm(root, { recursive: true, force: true }));
  const consumer = join(root, 'repo');
  await run('git', ['init', '-q', consumer]);
  const env = { AGENT_ORCHESTRATION_STATE_HOME: join(root, 'state'), XDG_CONFIG_HOME: join(root, 'config') };
  const home = join(root, 'home');
  const key = repoKey((await canonicalRepoId(consumer)).id);
  await writeJson(join(stateRoot(env, home), 'management', key, 'TM-7.json'), { task: 'TM-7', owner: 'author-1', finish: { revision: REV } });
  const calls = { tm: [], reviews: [], mail: [] };
  let findings = [];
  const base = { consumer, env, home, minIntervalMs: 0, tmBin: '/fake/tm',
    runFn: async (bin, args) => { calls.tm.push([bin, ...args]); return { code: 0, stdout: JSON.stringify({ findings, coverage: { tasks: 3 } }) }; },
    lead: async () => ({ record: { agent_id: 'lead-1' } }),
    requestReview: async opts => { calls.reviews.push(opts); if (opts.task === 'TM-8') throw Object.assign(new Error('no designated reviewer'), { code: 'TOPOLOGY_REVIEWER_UNAVAILABLE' }); return { ok: true }; },
    deliver: async msg => { calls.mail.push(msg); return { status: 'delivered' }; } };
  return { base, calls, setFindings: f => { findings = f; } };
}

test('fresh findings become one review request or one lead notice each; seen findings send nothing', async t => {
  const { base, calls, setFindings } = await fixture(t);
  setFindings([
    { key: 'no-review:TM-7', kind: 'no-review', id: 'TM-7', governed: true, detail: 'TM-7 is done with commits and no reviewer verdict', fresh: true },
    { key: 'idle-pr:41:t', kind: 'idle-pr', id: 'TM-9', number: 41, pr: 'https://x/pull/41', detail: 'PR #41 has had no activity for 48h', fresh: true },
    { key: 'no-review:TM-1', kind: 'no-review', id: 'TM-1', detail: 'old', fresh: false, notified: true },
  ]);
  const out = await reviewSweepTick(base);
  assert.deepEqual(calls.tm, [['/fake/tm', 'review-sweep', '--apply', '--json']]);
  assert.deepEqual(calls.reviews.map(r => [r.task, r.revision, r.authorAgentIds]), [['TM-7', REV, ['author-1']]]);
  assert.deepEqual(calls.mail.map(m => [m.to, m.subject]), [['lead-1', 'review sweep: TM-9']], 'only the idle PR mails the lead; the seen finding sends nothing');
  assert.match(calls.mail[0].body, /PR #41/);
  assert.deepEqual(out.delivered.map(d => d.action), ['review-requested', 'lead-notice']);

  // Same finding, retried: the derived id is stable, so the mailbox dedupes a resend.
  const firstId = calls.mail[0].id;
  await reviewSweepTick(base);
  assert.equal(calls.mail[1].id, firstId);
});

test('a refused review request falls back to a lead notice that carries the refusal', async t => {
  const { base, calls, setFindings } = await fixture(t);
  setFindings([{ key: 'no-review:TM-8', kind: 'no-review', id: 'TM-8', governed: true, detail: 'TM-8 is ready for review with commits and no reviewer verdict', fresh: true }]);
  await writeJson(join(stateRoot(base.env, base.home), 'management', repoKey((await canonicalRepoId(base.consumer)).id), 'TM-8.json'), { task: 'TM-8', owner: 'a', finish: { revision: REV } });
  const out = await reviewSweepTick(base);
  assert.equal(calls.reviews.length, 1);
  assert.equal(out.delivered[0].action, 'lead-notice');
  assert.match(calls.mail[0].body, /TOPOLOGY_REVIEWER_UNAVAILABLE: no designated reviewer/);
});

test('a clean sweep sends nothing, and an absent task-management skips the tick', async t => {
  const { base, calls } = await fixture(t);
  const clean = await reviewSweepTick(base);
  assert.deepEqual([clean.findings, clean.delivered.length, clean.coverage.tasks], [0, 0, 3]);
  assert.equal(calls.mail.length + calls.reviews.length, 0);
  assert.equal(await reviewSweepTick({ ...base, tmBin: null }), null, 'no tm launcher in the consumer: nothing to sweep');
});

// TM-361: the supervisor's review sweep. Finished work nobody reviewed and open PRs nobody is moving
// reach a reviewer or the lead, exactly once each.
//
// task-management owns the finding and its marker: `tm review-sweep --apply --json` returns every
// finding and marks the fresh ones fired. This tick only delivers the fresh ones:
//   - a governed task with a finish revision → `requestReview` to the registered reviewer;
//   - anything else, or a review request that refuses → one standing-mail notice to the lead.
// The notice id derives from the finding key, so a retried send or a restarted supervisor never
// mails twice, and a held notice is retried by resumeStandingMessages like any other.
//
// task-management is reached only through its CLI, after checking it is installed; with tm absent
// the tick returns null and supervision carries on.
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { canonicalRepoId, repoKey, stateRoot } from './repoid.mjs';
import { readLeadRegistration } from './lead.mjs';
import { finishCheckEvidence, requestReview as fileReview } from './reviewer.mjs';
import { sendStandingMessage } from './standing-mailbox.mjs';
import { SUPERVISOR_SENDER } from './nats-outage.mjs';
import { exists, readJson, run } from './util.mjs';

/** ponytail: gh is a network call, so the sweep runs at most this often per process. */
export const REVIEW_SWEEP_MIN_MS = 10 * 60_000;
const lastSweep = new Map();

const noticeId = (key, findingKey) => createHash('sha256').update(`review-sweep:v1:${key}:${findingKey}`).digest('hex').slice(0, 32);

/** The repository's own tm launcher, or null when task-management is not installed there. Shared with the combined doctor (TM-379). */
export async function tmLauncher(consumer) {
  const bin = join(consumer, '.bytedesk/task-management/bin/tm');
  return (await exists(bin)) ? bin : null;
}

export async function reviewSweepTick({ consumer, env = process.env, home = homedir(), now = Date.now,
  minIntervalMs = Number(env.AO_REVIEW_SWEEP_MS ?? REVIEW_SWEEP_MIN_MS), tmBin = null, runFn = run,
  deliver = sendStandingMessage, lead = readLeadRegistration, requestReview = fileReview }) {
  if (now() - (lastSweep.get(consumer) ?? -Infinity) < minIntervalMs) return null;
  const bin = tmBin ?? await tmLauncher(consumer);
  if (!bin) return null;
  lastSweep.set(consumer, now());
  const res = await runFn(bin, ['review-sweep', '--apply', '--json'], { cwd: consumer, allowFailure: true,
    env: { ...env, TM_ROOT: consumer, CLAUDE_PROJECT_DIR: consumer } });
  let sweep;
  try { sweep = JSON.parse(res.stdout); } catch { return { status: 'failed', reason: `tm review-sweep exited ${res.code}: ${String(res.stderr || '').trim().split('\n')[0]}` }; }
  const fresh = (sweep.findings || []).filter(f => f.fresh);
  const out = { findings: sweep.findings?.length ?? 0, coverage: sweep.coverage ?? null, delivered: [] };
  if (!fresh.length) return out;
  const identity = await canonicalRepoId(consumer), key = repoKey(identity.id);
  const leadId = (await lead({ consumer, env, home }).catch(() => null))?.record?.agent_id ?? null;
  for (const f of fresh) {
    let refused = null;
    if (f.kind === 'no-review' && f.governed) {
      const record = await readJson(join(stateRoot(env, home), 'management', key, `${f.id}.json`)).catch(() => null);
      const revision = record?.finish?.revision;
      if (revision && record.owner) {
        try {
          await requestReview({ consumer, task: f.id, revision, authorAgentIds: [record.owner], checkEvidence: finishCheckEvidence(record.finish), env, home });
          out.delivered.push({ key: f.key, action: 'review-requested', task: f.id, revision });
          continue;
        } catch (error) { refused = `${error.code ?? 'error'}: ${error.message}`; }
      } else refused = 'no finish revision or owner in the management record';
    }
    if (!leadId) { out.delivered.push({ key: f.key, action: 'skipped', reason: 'no lead is registered for this repository' }); continue; }
    const id = noticeId(key, f.key);
    const body = [
      `REVIEW SWEEP: ${f.detail}${f.pr ? ` (${f.pr})` : ''}.`,
      f.kind === 'idle-pr' ? 'Move it: review, merge, or close it with a reason.' : 'It needs an independent review or a recorded decision.',
      ...(refused ? [`A review request was not filed: ${refused}`] : []),
    ].join('\n');
    const sent = await deliver({ id, consumer, fromProject: consumer, from: SUPERVISOR_SENDER, to: leadId,
      subject: `review sweep: ${f.id ?? `PR #${f.number}`}`, body, provenance: { source: 'ao-topology supervise' } }, { env, home })
      .catch(error => ({ status: 'failed', reason: error?.code ?? String(error) }));
    out.delivered.push({ key: f.key, action: 'lead-notice', to: leadId, message_id: id, status: sent?.status ?? 'failed', ...(sent?.reason ? { reason: sent.reason } : {}) });
  }
  return out;
}

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { composePrompt, readPromptState, promptStatePath } from './prompts.mjs';
import { invariant, readJson, writeJson, writeText, sleep } from './util.mjs';
import { withLock } from './lockfile.mjs';
import { incarnationOf, sameIncarnation } from './incarnation.mjs';
import { canonicalRepoId } from './repoid.mjs';

// A staged file is not an applied prompt. No provider currently declares native replacement.
export async function refreshPrompt({ agent, consumer, session = null, pluginRoot, home, env = process.env, live = false, safeBoundary = false, binding = null }) {
  return withLock(join(agent._dir, '.prompt.lock'), async () => {
    const prior = await readPromptState(agent._dir) || {};
    const loaded = await loadConfig({ consumer, pluginRoot, home, env });
    const composed = await composePrompt({ agent, consumer, dir: agent._dir, loaded, templateName: agent.template });
    if (!composed.ok) {
      const state = { ...prior, errors: composed.errors, status: 'invalid-config' };
      await writeJson(promptStatePath(agent._dir), state);
      return state;
    }
    const exact = incarnationOf(binding);
    const repoId = (await canonicalRepoId(consumer)).id;
    if (live && prior.status === 'awaiting-ack' && prior.desired_revision === composed.revision && sameIncarnation(prior.desired_binding, exact)) return prior;
    if (live && prior.applied_revision === composed.revision && sameIncarnation(prior.applied_binding, exact)) {
      const state = {...prior, errors:[], status:'current'};
      await writeJson(promptStatePath(agent._dir),state);
      return state;
    }
    if (live) {
      const state = { ...prior, desired_revision: composed.revision, desired_binding: exact, desired_session: session, repo_id: repoId, sources: composed.sources,
        errors: [], status: safeBoundary ? 'restart-required' : 'queued', replacement: 'restart-required' };
      await writeText(join(agent._dir, 'prompt.pending.md'), composed.text);
      await writeJson(promptStatePath(agent._dir), state);
      return state;
    }
    const nonce = randomUUID();
    await writeText(join(agent._dir, 'prompt.md'), composed.text);
    const state = { ...prior, desired_revision: composed.revision, desired_binding: exact, desired_session: session, repo_id: repoId, sources: composed.sources,
      errors: [], status: 'awaiting-ack', nonce, replacement: 'cold-start' };
    delete state.applied_revision;
    delete state.acknowledged_at;
    await writeJson(promptStatePath(agent._dir), state);
    return state;
  });
}

export async function acknowledgePrompt({ agent, revision, nonce, binding = null, consumer, session, env = process.env }) {
  return withLock(join(agent._dir, '.prompt.lock'), async () => {
    const state = await readJson(promptStatePath(agent._dir));
    const expectedRepo = (await canonicalRepoId(consumer)).id;
    const actualRepo = env.AO_CONSUMER ? (await canonicalRepoId(env.AO_CONSUMER)).id : null;
    const reason = env.AO_AGENT_ID !== agent.id ? 'agent-mismatch'
      : !session || env.AO_SESSION !== session || state.desired_session !== session ? 'session-mismatch'
      : !actualRepo || actualRepo !== expectedRepo || state.repo_id !== expectedRepo ? 'repository-mismatch'
      : state.status !== 'awaiting-ack' ? 'state-not-awaiting-ack'
      : state.nonce !== nonce ? 'nonce-mismatch'
      : state.desired_revision !== revision ? 'revision-mismatch'
      : !sameIncarnation(state.desired_binding, binding) ? 'incarnation-mismatch' : null;
    invariant(!reason, 'TOPOLOGY_PROMPT_ACK_INVALID', 'Only the exact started process can acknowledge its current staged prompt.', { reason });
    const next = { ...state, applied_revision: revision, applied_binding: incarnationOf(binding), status: 'current', acknowledged_at: new Date().toISOString() };
    delete next.nonce;
    await writeJson(promptStatePath(agent._dir), next);
    return next;
  });
}

/** Promote a pending live change only after a controlled restart has produced its new binding. */
export async function promotePromptForIncarnation({ agent, binding, consumer, session }) {
  return withLock(join(agent._dir, '.prompt.lock'), async () => {
    const state = await readJson(promptStatePath(agent._dir));
    const exact = incarnationOf(binding);
    invariant(exact, 'TOPOLOGY_PROMPT_INCARNATION', 'A complete live process incarnation is required before staging its prompt.');
    if (state.status === 'queued' || state.status === 'restart-required') {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(join(agent._dir, 'prompt.pending.md'), 'utf8');
      await writeText(join(agent._dir, 'prompt.md'), text);
    }
    const nonce = randomUUID();
    const next = { ...state, desired_binding: exact, desired_session: session, repo_id: (await canonicalRepoId(consumer)).id, status: 'awaiting-ack', nonce, replacement: 'controlled-restart' };
    delete next.applied_revision;
    delete next.applied_binding;
    delete next.acknowledged_at;
    await writeJson(promptStatePath(agent._dir), next);
    return next;
  });
}

// Polling re-reads config plus every referenced file; rename-based editor saves cannot lose a watch.
export async function watchPrompts(options, { signal, intervalMs = 1000, onChange = () => {} } = {}) {
  let last;
  while (!signal?.aborted) {
    const state = await refreshPrompt({ ...options, live: true });
    const key = JSON.stringify(state);
    if (key !== last) { await onChange(state); last = key; }
    await sleep(intervalMs);
  }
}

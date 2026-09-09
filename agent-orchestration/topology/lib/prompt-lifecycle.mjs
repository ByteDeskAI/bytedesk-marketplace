import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { composePrompt, readPromptState, promptStatePath } from './prompts.mjs';
import { invariant, readJson, writeJson, writeText, sleep } from './util.mjs';
import { withLock } from './lockfile.mjs';

// A staged file is not an applied prompt. No provider currently declares native replacement.
export async function refreshPrompt({ agent, consumer, pluginRoot, home, env = process.env, live = false, safeBoundary = false }) {
  return withLock(join(agent._dir, '.prompt.lock'), async () => {
    const prior = await readPromptState(agent._dir) || {};
    const loaded = await loadConfig({ consumer, pluginRoot, home, env });
    const composed = await composePrompt({ agent, consumer, dir: agent._dir, loaded, templateName: agent.template });
    if (!composed.ok) {
      const state = { ...prior, errors: composed.errors, status: 'invalid-config' };
      await writeJson(promptStatePath(agent._dir), state);
      return state;
    }
    if (live && prior.status === 'awaiting-ack' && prior.desired_revision === composed.revision) return prior;
    if (live && prior.applied_revision === composed.revision) {
      const state = {...prior, errors:[], status:'current'};
      await writeJson(promptStatePath(agent._dir),state);
      return state;
    }
    if (live) {
      const state = { ...prior, desired_revision: composed.revision, sources: composed.sources,
        errors: [], status: safeBoundary ? 'restart-required' : 'queued', replacement: 'restart-required' };
      await writeText(join(agent._dir, 'prompt.pending.md'), composed.text);
      await writeJson(promptStatePath(agent._dir), state);
      return state;
    }
    const nonce = randomUUID();
    await writeText(join(agent._dir, 'prompt.md'), composed.text);
    const state = { ...prior, desired_revision: composed.revision, sources: composed.sources,
      errors: [], status: 'awaiting-ack', nonce, replacement: 'cold-start' };
    delete state.applied_revision;
    delete state.acknowledged_at;
    await writeJson(promptStatePath(agent._dir), state);
    return state;
  });
}

export async function acknowledgePrompt({ agent, revision, nonce, env = process.env }) {
  return withLock(join(agent._dir, '.prompt.lock'), async () => {
    const state = await readJson(promptStatePath(agent._dir));
    invariant(env.AO_AGENT_ID === agent.id && state.status === 'awaiting-ack' && state.nonce === nonce && state.desired_revision === revision,
      'TOPOLOGY_PROMPT_ACK_INVALID', 'Only the started agent can acknowledge its current staged prompt.');
    const next = { ...state, applied_revision: revision, status: 'current', acknowledged_at: new Date().toISOString() };
    delete next.nonce;
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

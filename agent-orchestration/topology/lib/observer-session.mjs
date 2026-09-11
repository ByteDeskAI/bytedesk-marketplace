// Activation gate for a standing observer. This module may mutate only the observer's own
// managed role-session and prompt files; the observed repository/run remains read-only.
import { dirname, join } from 'node:path';
import { requireAgent } from './agents.mjs';
import { sameIncarnation } from './incarnation.mjs';
import { deliverPointer, openRoleSession, roleSessionName, roleSessionPath } from './launch.mjs';
import { adapterFor, buildArgv, loadAdapters, providerDirs } from './providers.mjs';
import { refreshPrompt } from './prompt-lifecycle.mjs';
import { readPromptState } from './prompts.mjs';
import { stateRoot } from './repoid.mjs';
import * as defaultTmux from './tmux.mjs';
import { invariant, parseDuration, readJson, sleep } from './util.mjs';

export function observerAckTimeout({ ackTimeout, legacyTimeout, env = process.env } = {}) {
  if (ackTimeout !== undefined && ackTimeout !== true) return parseDuration(String(ackTimeout));
  const configured = Number(env.AO_OBSERVER_ACK_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured > 0) return configured;
  if (legacyTimeout !== undefined && legacyTimeout !== true) return parseDuration(String(legacyTimeout));
  return 30_000;
}

async function exactLiveBinding(tmux, binding) {
  if (!binding) return null;
  const panes = await tmux.listServerPanes({ tmuxServer: binding.serverKey });
  const matches = panes.filter(pane => pane.alive !== false && sameIncarnation(pane, binding));
  return matches.length === 1 ? matches[0] : null;
}

export async function waitForObserverPrompt({ agent, session, binding, timeoutMs = 30_000, pollMs = 250,
  readState = readPromptState, now = Date.now, sleepFn = sleep } = {}) {
  invariant(Number.isFinite(timeoutMs) && timeoutMs > 0, 'TOPOLOGY_OBSERVER_TIMEOUT', 'Observer readiness timeout must be positive.');
  const deadline = now() + timeoutMs;
  for (;;) {
    const state = await readState(agent._dir);
    if (state?.status === 'current' && state.applied_revision === state.desired_revision &&
        state.desired_session === session && sameIncarnation(state.applied_binding, binding)) return state;
    if (now() >= deadline) {
      invariant(false, 'TOPOLOGY_PROMPT_ACK_TIMEOUT', 'Observer did not acknowledge the current prompt from its exact managed process before the readiness timeout. The session is preserved and no attachment was created.');
    }
    await sleepFn(Math.min(pollMs, Math.max(1, deadline - now())));
  }
}

/** Start or reattach the observer and return proof suitable for the attachment commit point. */
export async function prepareObserverSession({ consumer, observerId, agentDirs = [], providerDirs: configuredProviderDirs,
  pluginRoot, home, env = process.env, timeoutMs = 30_000, tmux = defaultTmux, log = () => {}, lifecycle = {} } = {}) {
  const resolveAgent = lifecycle.requireAgent ?? requireAgent;
  const agent = await resolveAgent(observerId, agentDirs);
  invariant(agent.role === 'observer' && agent.coordinates_only === true,
    'TOPOLOGY_OBSERVER_AGENT', 'Observer start requires a coordinates-only observer identity in this repository library.');
  const session = roleSessionName(agent.id);
  const recordPath = roleSessionPath(dirname(agent._dir), agent.id);
  const wasLive = await tmux.hasSession(session);
  const priorRecord = await readJson(recordPath).catch(() => null);
  let priorBinding = null;
  if (wasLive) {
    invariant(priorRecord?.agent_id === agent.id, 'TOPOLOGY_SESSION_OWNERSHIP', 'The live observer session has no matching managed record.');
    priorBinding = await exactLiveBinding(tmux, priorRecord.binding);
    invariant(priorBinding, 'TOPOLOGY_SESSION_OWNERSHIP', 'The observer session record does not match one exact live process incarnation.');
  }

  const refresh = lifecycle.refreshPrompt ?? refreshPrompt;
  const staged = await refresh({ agent, consumer, session, pluginRoot, home, env, live: wasLive,
    safeBoundary: true, binding: priorBinding });
  invariant(staged.status !== 'invalid-config', 'TOPOLOGY_PROMPT_INVALID', 'Observer prompt configuration is invalid; the existing session is preserved.');
  const current = wasLive && staged.status === 'current' && sameIncarnation(staged.applied_binding, priorBinding);

  const adapters = await (lifecycle.loadAdapters ?? loadAdapters)(configuredProviderDirs ?? providerDirs({ pluginRoot, consumer, home }));
  const adapter = (lifecycle.adapterFor ?? adapterFor)(agent, adapters);
  const vars = { session, agent_id: agent.id, agent_role: agent.role, bootstrap_file: join(agent._dir, 'prompt.md'),
    system_prompt: `You are the standing orchestration observer ${agent.id} for ${consumer}. Read ${join(agent._dir, 'prompt.md')} and follow it.` };
  const argv = (lifecycle.buildArgv ?? buildArgv)(adapter, { ...agent, add_dirs: [stateRoot(env, home)] }, vars);
  const opened = await (lifecycle.openRoleSession ?? openRoleSession)({ agentsDir: dirname(agent._dir), agentId: agent.id,
    adapter, argv, env: { AO_AGENT_ID: agent.id, AO_AGENT_ROLE: agent.role, AO_SESSION: session, AO_CONSUMER: consumer, ...agent.env },
    role: agent.role, coordinatesOnly: true, controlledRestart: wasLive && !current, log });
  invariant(opened.binding, 'TOPOLOGY_OBSERVER_IDENTITY_CHANGED', 'Observer session started without an exact process binding.');

  const prompt = await waitForObserverPrompt({ agent, session, binding: opened.binding, timeoutMs,
    readState: lifecycle.readPromptState ?? readPromptState, sleepFn: lifecycle.sleep ?? sleep, now: lifecycle.now ?? Date.now });
  const record = await readJson(recordPath).catch(() => opened.record ?? null);
  const observed = await exactLiveBinding(tmux, record?.binding);
  invariant(observed && sameIncarnation(observed, opened.binding) && sameIncarnation(prompt.applied_binding, observed),
    'TOPOLOGY_OBSERVER_IDENTITY_CHANGED', 'Observer process incarnation changed during prompt activation; no attachment was created.');
  return { agent, session, pane: opened.pane, binding: observed, adapter, prompt_revision: prompt.applied_revision,
    prompt_acknowledged_at: prompt.acknowledged_at ?? null, created: opened.created === true,
    reattached: opened.reattached === true, restarted: opened.restarted === true };
}

export async function deliverObserverActivation(activation, text) {
  invariant(activation?.pane && activation?.adapter, 'TOPOLOGY_OBSERVER_ACTIVATION', 'Observer activation needs its verified pane and provider adapter.');
  return deliverPointer(activation.pane, activation.adapter, text);
}

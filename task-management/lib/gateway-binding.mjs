/** Terminal identity is presentation provenance, never permission to mutate a task. */
import { execFileSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { sessionId } from './actor.mjs';

export function validGatewayBinding(value) {
  if (!value || typeof value !== 'object' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.tabId || '') ||
      typeof value.sessionName !== 'string' || !value.sessionName || value.sessionName.length > 200 || /[\x00-\x1f\x7f]/.test(value.sessionName)) return false;
  const t = value.tmux;
  return !!t && typeof t.serverKey === 'string' && isAbsolute(t.serverKey) && t.serverKey.length <= 4096 && !/[\x00-\x1f\x7f]/.test(t.serverKey) &&
    ['serverPid', 'sessionId', 'sessionCreated', 'paneId', 'panePid'].every(k => typeof t[k] === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(t[k])) &&
    ['serverPid', 'sessionCreated', 'panePid'].every(k => t[k] !== '0');
}

export function captureGatewayBinding(session, { env = process.env, run = execFileSync } = {}) {
  if (!session || session !== sessionId(env)) return null;
  const tabId = env.BYTEDESK_EMOTE_GATEWAY_TAB_ID;
  const expected = env.BYTEDESK_EMOTE_GATEWAY_TAB_SESSION;
  const pane = env.TMUX_PANE;
  if (!tabId || !expected || !/^%[0-9]+$/.test(pane || '') || !env.TMUX) return null;
  // TMUX ends in ,server-pid,session-id; retain commas within socket paths.
  const socket = env.TMUX.replace(/,[0-9]+,[0-9]+$/, '');
  if (socket === env.TMUX || !isAbsolute(socket)) return null;
  try {
    const line = run('tmux', ['-S', socket, 'display-message', '-p', '-t', pane,
      '#{session_name}\t#{socket_path}\t#{pid}\t#{session_id}\t#{session_created}\t#{pane_id}\t#{pane_pid}'],
      { encoding: 'utf8', timeout: 750, maxBuffer: 8192, stdio: ['ignore', 'pipe', 'ignore'], env }).trim();
    const f = line.split('\t');
    if (f.length !== 7 || f[0] !== expected || f[1] !== socket || f[5] !== pane || !/^\$[0-9]+$/.test(f[3])) return null;
    const binding = { tabId, sessionName: f[0], tmux: { serverKey: f[1], serverPid: f[2], sessionId: f[3].slice(1), sessionCreated: f[4], paneId: f[5].slice(1), panePid: f[6] } };
    return validGatewayBinding(binding) ? binding : null;
  } catch { return null; }
}

export function gatewayActiveTasks(claims, tasks, isExpired) {
  const active = new Set(tasks.filter(t => t.status === 'in_progress').map(t => t.id));
  const groups = new Map();
  for (const [id, claim] of Object.entries(claims || {})) {
    if (!/^TM-[0-9]+$/.test(id) || !active.has(id) || !claim.session || isExpired(claim) || !validGatewayBinding(claim.gateway)) continue;
    const b = claim.gateway;
    const key = JSON.stringify([b.tabId, b.sessionName, b.tmux.serverKey, b.tmux.serverPid, b.tmux.sessionId, b.tmux.sessionCreated, b.tmux.paneId, b.tmux.panePid]);
    const group = groups.get(key) || { ...b, activeTaskIds: [] };
    group.activeTaskIds.push(id);
    groups.set(key, group);
  }
  for (const group of groups.values()) group.activeTaskIds.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return { version: 1, bindings: [...groups.values()] };
}

// TM-368: page the operator through ntfy when an autonomous landing or release stops.
// agent-orchestration's own notifier, so it works with task-management absent. It never throws:
// a page that fails is reported in the result, it never turns into a second failure.
// The token comes from the environment only (AO_NTFY_TOKEN, else tm's TM_NTFY_TOKEN).
export const DEFAULT_NTFY_SERVER = 'https://ntfy.prod.bytedesk.ai';

export function ntfyTarget({ config = {}, env = process.env } = {}) {
  return {
    server: (env.AO_NTFY_SERVER || env.TM_NTFY_SERVER || config.server || DEFAULT_NTFY_SERVER).replace(/\/+$/, ''),
    topic: env.AO_NTFY_TOPIC || env.TM_NTFY_TOPIC || config.topic || null,
    token: env.AO_NTFY_TOKEN || env.TM_NTFY_TOKEN || null,
  };
}

export async function page({ title, body, config = {}, env = process.env, fetchImpl = fetch, timeoutMs = 5000 }) {
  const { server, topic, token } = ntfyTarget({ config, env });
  if (!topic) return { sent: false, reason: 'no ntfy topic: set management.ntfy.topic or AO_NTFY_TOPIC' };
  try {
    const res = await fetchImpl(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST', body,
      headers: { Title: String(title).replace(/[^\x20-\x7e]/g, '?'), Priority: 'high', Tags: 'rotating_light', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok ? { sent: true } : { sent: false, reason: `ntfy answered ${res.status}` };
  } catch (error) {
    return { sent: false, reason: error.message };
  }
}

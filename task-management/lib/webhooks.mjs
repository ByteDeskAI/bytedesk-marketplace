/**
 * Machine-consumable fan-out: every logged event is POSTed to each configured
 * webhook as the exact JSONL row that landed in events.jsonl.
 *
 * The same three rules as ntfy, plus one of its own:
 *   1. It never throws, and it never blocks the caller past dispatch. Delivery
 *      is awaited only by the detached child (bin/tm-webhook) — a hook process
 *      exits in milliseconds and would kill an in-flight fetch.
 *   2. Nothing fires unless a webhook is configured; an empty `webhooks` list
 *      costs one config read and no process.
 *   3. Loopback only by default. The event stream carries task titles and
 *      bodies, so a webhook URL must be http://127.0.0.1, http://localhost or
 *      http://*.local unless the project deliberately sets
 *      `webhooksAllowRemote: true`. Refusing is the default because writing a
 *      URL into config.json is easy and reading what then leaves the machine
 *      is not.
 *
 * TM_WEBHOOKS_DEBUG=1 turns the swallowed failures into stderr notes.
 */
import { config } from "./store.mjs";
import { paths } from "./paths.mjs";

const TIMEOUT_MS = 5000;

const debug = (msg) => {
  if (process.env.TM_WEBHOOKS_DEBUG) process.stderr.write(`tm-webhook: ${msg}\n`);
};

/** Store config for webhooks: the endpoint list plus the remote escape hatch. */
export function webhooksConfig(p = paths()) {
  const cfg = config(p);
  const list = Array.isArray(cfg.webhooks) ? cfg.webhooks : [];
  return {
    webhooks: list.filter((w) => w && typeof w.url === "string"),
    allowRemote: cfg.webhooksAllowRemote === true,
  };
}

/**
 * Loopback/private-only unless allowRemote. Without the flag the scheme must be
 * plain http: and the host 127.0.0.1, localhost or a *.local name; with it,
 * https: is admitted too — the project has said out loud where its stream goes.
 */
export function isAllowedUrl(raw, allowRemote = false) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (allowRemote) return u.protocol === "http:" || u.protocol === "https:";
  if (u.protocol !== "http:") return false;
  const h = u.hostname;
  return h === "127.0.0.1" || h === "localhost" || h.endsWith(".local");
}

/**
 * The configured webhooks that want this event and are allowed to receive it.
 * `kinds` filters on the event name — the same vocabulary as the ntfy CATALOG;
 * omitted (or empty) means every event. Unknown kinds simply never match.
 */
export function webhookTargets(eventRow, p = paths()) {
  try {
    const { webhooks, allowRemote } = webhooksConfig(p);
    return webhooks.filter((w) => {
      if (!isAllowedUrl(w.url, allowRemote)) {
        debug(`refused ${w.url} — loopback only unless webhooksAllowRemote is true`);
        return false;
      }
      if (Array.isArray(w.kinds) && w.kinds.length && !w.kinds.includes(eventRow.event)) return false;
      return true;
    });
  } catch {
    return []; // a malformed config must not cost the event its other fans
  }
}

/** One POST, bounded by TIMEOUT_MS, resolved to silence — never a throw. */
async function deliver(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) debug(`${url} → HTTP ${res.status}`);
  } catch (err) {
    debug(`${url} → ${err.message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispatch the row to every matching webhook. Fire-and-forget: returns as soon
 * as the fetches are dispatched (connection setup at most), delivery settles on
 * its own. The caller that cares about delivery — bin/tm-webhook — stays alive
 * on the pending fetch handles; hooks spawn it and leave.
 */
export function fanoutWebhook(eventRow, p = paths()) {
  try {
    const targets = webhookTargets(eventRow, p);
    if (!targets.length) return { sent: 0 };
    const body = JSON.stringify(eventRow);
    for (const w of targets) {
      // deliver() swallows its own failures; the catch here guards the dispatch itself.
      deliver(w.url, body).catch((err) => debug(`${w.url} → ${err.message}`));
    }
    return { sent: targets.length };
  } catch (err) {
    debug(`fanout failed: ${err.message}`);
    return { sent: 0 };
  }
}

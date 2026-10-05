/**
 * The bridge between `logEvent` and the ntfy sender.
 *
 * Kept in its own module so lib/store.mjs doesn't grow a dependency on child
 * processes, and so the gating logic stays unit-testable without spawning
 * anything. The spawn is detached and unref'd: a hook process exits in
 * milliseconds and would otherwise kill the request mid-flight.
 */
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ntfyConfig, shouldPublish } from "./ntfy.mjs";
import { webhookTargets } from "./webhooks.mjs";
import { paths } from "./paths.mjs";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin");
const NOTIFIER = join(BIN, "tm-notify");
const WEBHOOKER = join(BIN, "tm-webhook");

/** Rate-limit state for this process. Short-lived by nature — hooks are one-shot. */
const seen = new Map();

export function notifyEvent(event, p = paths()) {
  // Webhooks ride the same detached chain as ntfy: gated (configured, kind-matched,
  // loopback-allowed) and spawned here, delivered by the child — so a slow endpoint
  // cannot stall a hook, and an unconfigured board pays only one config read.
  // Independent of TM_NTFY_OFF: that silences the phone, not the event bus.
  try {
    if (webhookTargets(event, p).length) {
      spawn(process.execPath, [WEBHOOKER, JSON.stringify(event)], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      }).unref();
    }
  } catch {
    /* ignore — a notifier must never fail a hook */
  }
  try {
    notifyTicketOrigin(event, p);
  } catch {
    /* ignore — same rule as the webhooks above */
  }
  if (process.env.TM_NTFY_OFF) return { sent: false, reason: "TM_NTFY_OFF" };
  let cfg;
  try {
    cfg = ntfyConfig(p);
  } catch {
    return { sent: false, reason: "config unreadable" };
  }
  const verdict = shouldPublish(event, cfg, { seen });
  if (!verdict.ok) return { sent: false, reason: verdict.reason };

  try {
    spawn(process.execPath, [NOTIFIER, JSON.stringify(event)], {
      detached: true,
      stdio: "ignore",
      env: process.env,
    }).unref();
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: err.message };
  }
}

/** Events that can mean progress on a cross-repo ticket — lib/ticket.mjs `originEventFor` decides. */
const TICKET_EVENTS = new Set(["done", "git_link", "task_result"]);

/**
 * TM-359: a ticket filed by `tm ticket` carries `origin`; its progress goes back to that repo.
 *
 * Every surface that closes a task, records a worker result or links a PR logs the event, so this
 * bridge is the one place that hears all of them. The task file is checked for an `origin:` line
 * directly — no store import, which would be circular — and only then is `tm ticket notify` spawned,
 * detached, to do the cross-repo writes outside this caller's time and locks.
 */
function notifyTicketOrigin(event, p) {
  if (!TICKET_EVENTS.has(event?.event) || !event.id || !p?.tasks) return;
  const file = readdirSync(p.tasks).find((n) => n.startsWith(`${event.id}-`) || n === `${event.id}.md`);
  if (!file || !/^origin: /m.test(readFileSync(join(p.tasks, file), "utf8"))) return;
  spawn(process.execPath, [join(BIN, "tm"), "ticket", "notify", JSON.stringify(event)], {
    detached: true,
    stdio: "ignore",
    cwd: p.root,
    env: { ...process.env, TM_ROOT: p.root },
  }).unref();
}

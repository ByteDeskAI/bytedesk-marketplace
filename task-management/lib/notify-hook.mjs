/**
 * The bridge between `logEvent` and the ntfy sender.
 *
 * Kept in its own module so lib/store.mjs doesn't grow a dependency on child
 * processes, and so the gating logic stays unit-testable without spawning
 * anything. The spawn is detached and unref'd: a hook process exits in
 * milliseconds and would otherwise kill the request mid-flight.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ntfyConfig, shouldPublish } from "./ntfy.mjs";
import { paths } from "./paths.mjs";

const NOTIFIER = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "tm-notify");

/** Rate-limit state for this process. Short-lived by nature — hooks are one-shot. */
const seen = new Map();

export function notifyEvent(event, p = paths()) {
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

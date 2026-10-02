/**
 * TM-300: agent-orchestration's global `prompts.prefix`, for backends that bypass ao's prompt
 * composition. The topology backend launches through ao, which composes the prefix itself; the
 * tmux and manual backends hand the worker tm's handoff verbatim, so without this they would be
 * the one kind of worker the operator's standing instructions never reach.
 *
 * Best effort by contract: no ao, a failed read, or an unreadable prefix file yields a one-line
 * warning and the handoff unchanged. A missing prefix must never be the reason a dispatch fails.
 *
 * The read goes through `ao-topology config get --scope global`, never through the config file
 * directly — ao owns where its global layer lives (XDG_CONFIG_HOME) and what a valid one is.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

/** The backends whose workers never pass through ao composition. */
export const PREFIXED_BACKENDS = new Set(["tmux", "manual"]);

/** `{ text, warning }` — text is the prefix or null; warning is a one-line reason or null. */
export function aoGlobalPrefix({ bin = "ao-topology", spawnImpl = spawnSync, readImpl = readFileSync, env = process.env } = {}) {
  const warn = (why) => ({ text: null, warning: `global prompt prefix not applied: ${why}` });
  let res;
  try {
    res = spawnImpl(bin, ["config", "get", "--scope", "global", "--json"], { shell: false, encoding: "utf8", env, timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
  } catch (err) {
    res = { error: err };
  }
  if (res.error) return warn(res.error.code === "ENOENT" ? "ao-topology is not installed" : `ao-topology failed to start: ${res.error.message}`);
  let layer;
  try {
    layer = JSON.parse(res.stdout);
  } catch {
    layer = null;
  }
  if (res.status !== 0 || !layer?.ok) {
    const why = layer?.message || String(res.stderr || "").trim().split("\n")[0] || `exited ${res.status}`;
    return warn(`ao-topology config get failed: ${why}`);
  }
  const entry = layer.document?.prompts?.prefix;
  if (entry === undefined || entry === null) return { text: null, warning: null };
  if (typeof entry === "object" && typeof entry.text === "string") return { text: entry.text.trim() || null, warning: null };
  const file = typeof entry === "string" ? entry : entry?.file;
  if (typeof file !== "string" || !file.trim()) return warn("prompts.prefix is neither a path, {file} nor {text}");
  // Resolved exactly as ao resolves it: `~` expanded, relative to the config file's directory.
  const expanded = file.startsWith("~/") ? `${env.HOME || homedir()}${file.slice(1)}` : file;
  const path = isAbsolute(expanded) ? expanded : resolve(dirname(layer.path), expanded);
  try {
    return { text: readImpl(path, "utf8").trim() || null, warning: null };
  } catch (err) {
    return warn(`cannot read ${path}: ${err.code || err.message}`);
  }
}

/** The handoff with the prefix in front, separated the way ao joins its layers. */
export function withPrefix(prompt, prefix) {
  return prefix ? `${prefix}\n\n${prompt}` : prompt;
}

import os from "node:os";
import { basename, dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { invariant } from "./errors.mjs";
import { isPathWithin } from "./util.mjs";

export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function stateRoot(env = process.env, platform = process.platform, home = os.homedir()) {
  if (env.AGENT_ORCHESTRATION_STATE_HOME) return env.AGENT_ORCHESTRATION_STATE_HOME;
  const pathApi = platform === "win32" ? win32 : posix;
  if (platform === "win32") {
    const base = env.LOCALAPPDATA || pathApi.join(home, "AppData", "Local");
    return pathApi.join(base, "ByteDesk", "agent-orchestration");
  }
  const base = env.XDG_STATE_HOME || pathApi.join(home, ".local", "state");
  return pathApi.join(base, "bytedesk", "agent-orchestration");
}

export function validateStateRoot(candidate, pluginRoot = PLUGIN_ROOT) {
  invariant(typeof candidate === "string" && isAbsolute(candidate), "AO_STATE_ROOT_NOT_ABSOLUTE", "The orchestration state root must be an absolute path.");
  const canonicalProspectivePath = (value) => {
    let cursor = resolve(value);
    const suffix = [];
    while (!existsSync(cursor)) {
      suffix.unshift(basename(cursor));
      const parent = dirname(cursor);
      if (parent === cursor) break;
      cursor = parent;
    }
    return join(realpathSync(cursor), ...suffix);
  };
  const canonicalCandidate = canonicalProspectivePath(candidate);
  const canonicalPlugin = realpathSync(pluginRoot);
  invariant(
    !isPathWithin(canonicalPlugin, canonicalCandidate) && !isPathWithin(canonicalCandidate, canonicalPlugin),
    "AO_STATE_ROOT_OVERLAPS_PLUGIN",
    "The orchestration state root cannot overlap the plugin installation or source tree.",
  );
  return canonicalCandidate;
}

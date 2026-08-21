import os from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, realpathSync } from "node:fs";
import { invariant } from "./errors.mjs";
import { isPathWithin } from "./util.mjs";

export const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export function stateRoot(env = process.env) {
  if (env.AGENT_ORCHESTRATION_STATE_HOME) return env.AGENT_ORCHESTRATION_STATE_HOME;
  const base = env.XDG_STATE_HOME || join(os.homedir(), ".local", "state");
  return join(base, "bytedesk", "agent-orchestration");
}

export function validateStateRoot(candidate, pluginRoot = PLUGIN_ROOT) {
  invariant(typeof candidate === "string" && isAbsolute(candidate), "AO_STATE_ROOT_NOT_ABSOLUTE", "The orchestration state root must be an absolute path.");
  const canonicalProspectivePath = (value) => {
    let cursor = resolve(value);
    const suffix = [];
    while (!existsSync(cursor)) {
      suffix.unshift(cursor.slice(cursor.lastIndexOf("/") + 1));
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

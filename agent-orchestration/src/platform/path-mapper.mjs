import { isAbsolute } from "node:path";
import { invariant } from "../errors.mjs";
import { runFile } from "../util.mjs";

export class IdentityPathAdapter {
  async toRuntimePath(path) { return path; }
}

/** Adapter for absolute Windows paths supplied to an MCP server hosted in WSL. */
export class WslPathAdapter {
  constructor({ runner = runFile } = {}) {
    this.runner = runner;
  }

  async toRuntimePath(path) {
    const isWindowsHostPath = /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path);
    if (!isWindowsHostPath) return path;
    const { stdout } = await this.runner("/usr/bin/wslpath", ["-a", "-u", path], { timeoutMs: 5_000 });
    invariant(stdout, "AO_WSL_PATH_TRANSLATION_FAILED", "WSL could not translate consumerCwd.", { path });
    return stdout.trim();
  }
}

export function createPathAdapter({ hostPlatform = process.env.AGENT_ORCHESTRATION_HOST_PLATFORM, platform = process.platform } = {}) {
  if (platform === "linux" && hostPlatform === "win32") return new WslPathAdapter();
  return new IdentityPathAdapter();
}

export async function runtimePath(path, options) {
  const mapped = await createPathAdapter(options).toRuntimePath(path);
  invariant(isAbsolute(mapped), "AO_PATH_NOT_ABSOLUTE", "The mapped runtime path must be absolute.", { path, mapped });
  return mapped;
}

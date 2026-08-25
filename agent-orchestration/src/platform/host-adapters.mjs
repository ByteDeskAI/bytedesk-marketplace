import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { access } from "node:fs/promises";
import { AgentOrchestrationError, invariant } from "../errors.mjs";
import { runFile } from "../util.mjs";

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const NATIVE_HELPER = join(PLUGIN_ROOT, "dist", "windows-native", "AgentOrchestration.Windows.dll");

export class DirectHostAdapter {
  constructor({ backend = process.platform === "win32" ? "windows-native" : "linux-native" } = {}) {
    this.id = backend;
  }

  async command(entrypoint) {
    return {
      executable: process.execPath,
      args: [entrypoint],
      env: { ...process.env, AGENT_ORCHESTRATION_RUNTIME_BACKEND: this.id },
    };
  }
}

export class WindowsWslHostAdapter {
  constructor({ distro = process.env.AGENT_ORCHESTRATION_WSL_DISTRO, runner = runFile } = {}) {
    this.id = "windows-wsl2";
    this.distro = distro;
    this.runner = runner;
  }

  baseArgs() {
    return this.distro ? ["--distribution", this.distro] : [];
  }

  async translatePath(path) {
    const { stdout } = await this.runner("wsl.exe", [...this.baseArgs(), "--exec", "wslpath", "-a", "-u", path], { timeoutMs: 10_000 });
    invariant(stdout, "AO_WSL_PATH_TRANSLATION_FAILED", "WSL could not translate the plugin path.", { path });
    return stdout.trim();
  }

  async probe() {
    const commands = ["node", "git", "bwrap", "slirp4netns", "systemd-run", "prlimit"];
    const script = `for command in ${commands.join(" ")}; do command -v "$command" >/dev/null 2>&1 || printf '%s\\n' "$command"; done`;
    try {
      const { stdout } = await this.runner("wsl.exe", [...this.baseArgs(), "--exec", "/bin/sh", "-c", script], { timeoutMs: 15_000 });
      const missing = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
      return { ok: missing.length === 0, kind: "wsl2-linux-runtime", missing, distro: this.distro || "default" };
    } catch (error) {
      return { ok: false, kind: "wsl2-linux-runtime", missing: commands, distro: this.distro || "default", error: error.message };
    }
  }

  async command(entrypoint) {
    const health = await this.probe();
    invariant(health.ok, "AO_WSL_RUNTIME_NOT_READY", "WSL 2 is installed, but the orchestration Linux runtime is incomplete.", health);
    const linuxEntrypoint = await this.translatePath(entrypoint);
    return {
      executable: "wsl.exe",
      args: [
        ...this.baseArgs(), "--exec", "/usr/bin/env",
        "AGENT_ORCHESTRATION_RUNTIME_BACKEND=linux-native",
        "AGENT_ORCHESTRATION_HOST_PLATFORM=win32",
        "node", linuxEntrypoint,
      ],
      env: process.env,
    };
  }
}

/** Factory Method: choose one host transport before the MCP server starts. */
export async function createHostAdapter({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32") return new DirectHostAdapter({ backend: "linux-native" });
  const requested = (env.AGENT_ORCHESTRATION_WINDOWS_BACKEND || "auto").toLowerCase();
  invariant(["auto", "native", "wsl"].includes(requested), "AO_WINDOWS_BACKEND_INVALID", "AGENT_ORCHESTRATION_WINDOWS_BACKEND must be auto, native, or wsl.");
  if (requested === "native") return new DirectHostAdapter({ backend: "windows-native" });
  if (requested === "wsl") return new WindowsWslHostAdapter({ distro: env.AGENT_ORCHESTRATION_WSL_DISTRO });
  const nativeAvailable = await access(NATIVE_HELPER).then(async () => {
    try {
      const { stdout } = await runFile("dotnet", [NATIVE_HELPER, "doctor"], { timeoutMs: 10_000 });
      const health = JSON.parse(stdout);
      return health.appContainer === true && health.jobObjects === true;
    } catch { return false; }
  }, () => false);
  return nativeAvailable
    ? new DirectHostAdapter({ backend: "windows-native" })
    : new WindowsWslHostAdapter({ distro: env.AGENT_ORCHESTRATION_WSL_DISTRO });
}

export async function runHost(entrypoint = join(PLUGIN_ROOT, "dist", "mcp.cjs")) {
  const adapter = await createHostAdapter();
  const command = await adapter.command(entrypoint);
  const child = spawn(command.executable, command.args, {
    cwd: PLUGIN_ROOT,
    env: command.env,
    stdio: "inherit",
    windowsHide: true,
    shell: false,
  });
  child.once("error", (error) => {
    process.stderr.write(`[agent-orchestration-host] ${JSON.stringify({ code: "AO_HOST_LAUNCH_FAILED", backend: adapter.id, message: error.message })}\n`);
  });
  const [code, signal] = await once(child, "exit");
  if (signal) throw new AgentOrchestrationError("AO_HOST_TERMINATED", `The ${adapter.id} host ended with signal ${signal}.`);
  process.exitCode = code ?? 1;
}

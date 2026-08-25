#!/usr/bin/env node
const __aoImportMetaUrl = require('node:url').pathToFileURL(__filename).href;

// src/errors.mjs
var AgentOrchestrationError = class extends Error {
  constructor(code, message, details = void 0) {
    super(message);
    this.name = "AgentOrchestrationError";
    this.code = code;
    this.details = details;
  }
};
function invariant(condition, code, message, details = void 0) {
  if (!condition) {
    throw new AgentOrchestrationError(code, message, details);
  }
}
function serializeError(error) {
  return {
    code: error?.code ?? "AO_INTERNAL",
    message: error instanceof Error ? error.message : String(error),
    ...error?.details === void 0 ? {} : { details: error.details }
  };
}

// src/platform/host-adapters.mjs
var import_node_child_process2 = require("node:child_process");
var import_node_events = require("node:events");
var import_node_path = require("node:path");
var import_node_url = require("node:url");
var import_promises = require("node:fs/promises");

// src/util.mjs
var import_node_child_process = require("node:child_process");
var import_node_util = require("node:util");
var execFile = (0, import_node_util.promisify)(import_node_child_process.execFile);
async function runFile(command, args, options = {}) {
  invariant(Array.isArray(args), "AO_INVALID_ARGUMENT", "Command arguments must be an array.");
  const result = await execFile(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    timeout: options.timeoutMs ?? 3e4,
    windowsHide: true
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

// src/platform/host-adapters.mjs
var PLUGIN_ROOT = (0, import_node_path.dirname)((0, import_node_path.dirname)((0, import_node_url.fileURLToPath)(__aoImportMetaUrl)));
var NATIVE_HELPER = (0, import_node_path.join)(PLUGIN_ROOT, "dist", "windows-native", "AgentOrchestration.Windows.dll");
var DirectHostAdapter = class {
  constructor({ backend = process.platform === "win32" ? "windows-native" : "linux-native" } = {}) {
    this.id = backend;
  }
  async command(entrypoint) {
    return {
      executable: process.execPath,
      args: [entrypoint],
      env: { ...process.env, AGENT_ORCHESTRATION_RUNTIME_BACKEND: this.id }
    };
  }
};
var WindowsWslHostAdapter = class {
  constructor({ distro = process.env.AGENT_ORCHESTRATION_WSL_DISTRO, runner = runFile } = {}) {
    this.id = "windows-wsl2";
    this.distro = distro;
    this.runner = runner;
  }
  baseArgs() {
    return this.distro ? ["--distribution", this.distro] : [];
  }
  async translatePath(path) {
    const { stdout } = await this.runner("wsl.exe", [...this.baseArgs(), "--exec", "wslpath", "-a", "-u", path], { timeoutMs: 1e4 });
    invariant(stdout, "AO_WSL_PATH_TRANSLATION_FAILED", "WSL could not translate the plugin path.", { path });
    return stdout.trim();
  }
  async probe() {
    const commands = ["node", "git", "bwrap", "pasta", "unshare", "systemd-run", "prlimit"];
    const script = `for command in ${commands.join(" ")}; do command -v "$command" >/dev/null 2>&1 || printf '%s\\n' "$command"; done`;
    try {
      const { stdout } = await this.runner("wsl.exe", [...this.baseArgs(), "--exec", "/bin/sh", "-c", script], { timeoutMs: 15e3 });
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
        ...this.baseArgs(),
        "--exec",
        "/usr/bin/env",
        "AGENT_ORCHESTRATION_RUNTIME_BACKEND=linux-native",
        "AGENT_ORCHESTRATION_HOST_PLATFORM=win32",
        "node",
        linuxEntrypoint
      ],
      env: process.env
    };
  }
};
async function createHostAdapter({ platform = process.platform, env = process.env } = {}) {
  if (platform !== "win32") return new DirectHostAdapter({ backend: "linux-native" });
  const requested = (env.AGENT_ORCHESTRATION_WINDOWS_BACKEND || "auto").toLowerCase();
  invariant(["auto", "native", "wsl"].includes(requested), "AO_WINDOWS_BACKEND_INVALID", "AGENT_ORCHESTRATION_WINDOWS_BACKEND must be auto, native, or wsl.");
  if (requested === "native") return new DirectHostAdapter({ backend: "windows-native" });
  if (requested === "wsl") return new WindowsWslHostAdapter({ distro: env.AGENT_ORCHESTRATION_WSL_DISTRO });
  const nativeAvailable = await (0, import_promises.access)(NATIVE_HELPER).then(async () => {
    try {
      const { stdout } = await runFile("dotnet", [NATIVE_HELPER, "doctor"], { timeoutMs: 1e4 });
      const health = JSON.parse(stdout);
      return health.appContainer === true && health.jobObjects === true;
    } catch {
      return false;
    }
  }, () => false);
  return nativeAvailable ? new DirectHostAdapter({ backend: "windows-native" }) : new WindowsWslHostAdapter({ distro: env.AGENT_ORCHESTRATION_WSL_DISTRO });
}
async function runHost(entrypoint = (0, import_node_path.join)(PLUGIN_ROOT, "dist", "mcp.cjs")) {
  const adapter = await createHostAdapter();
  const command = await adapter.command(entrypoint);
  const child = (0, import_node_child_process2.spawn)(command.executable, command.args, {
    cwd: PLUGIN_ROOT,
    env: command.env,
    stdio: "inherit",
    windowsHide: true,
    shell: false
  });
  child.once("error", (error) => {
    process.stderr.write(`[agent-orchestration-host] ${JSON.stringify({ code: "AO_HOST_LAUNCH_FAILED", backend: adapter.id, message: error.message })}
`);
  });
  const [code, signal] = await (0, import_node_events.once)(child, "exit");
  if (signal) throw new AgentOrchestrationError("AO_HOST_TERMINATED", `The ${adapter.id} host ended with signal ${signal}.`);
  process.exitCode = code ?? 1;
}

// src/host-launcher.mjs
runHost().catch((error) => {
  process.stderr.write(`[agent-orchestration-host] ${JSON.stringify(serializeError(error))}
`);
  process.exitCode = 1;
});

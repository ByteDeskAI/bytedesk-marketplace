#!/usr/bin/env node
const __aoImportMetaUrl = require('node:url').pathToFileURL(__filename).href;
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/provider-sandbox.mjs
var provider_sandbox_exports = {};
__export(provider_sandbox_exports, {
  sandboxArguments: () => sandboxArguments,
  startAcpProxy: () => startAcpProxy
});
module.exports = __toCommonJS(provider_sandbox_exports);
var import_node_child_process2 = require("node:child_process");
var import_node_events = require("node:events");
var import_promises = require("node:fs/promises");
var import_node_fs = require("node:fs");
var import_node_path3 = require("node:path");
var import_node_url = require("node:url");
var import_node_os2 = __toESM(require("node:os"), 1);
var import_node_readline = __toESM(require("node:readline"), 1);

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

// src/util.mjs
var import_node_child_process = require("node:child_process");
var import_node_path = require("node:path");
var import_node_util = require("node:util");
var execFile = (0, import_node_util.promisify)(import_node_child_process.execFile);
function isPathWithin(parent, candidate) {
  const rel = (0, import_node_path.relative)((0, import_node_path.resolve)(parent), (0, import_node_path.resolve)(candidate));
  return rel === "" || !rel.startsWith("..") && !(0, import_node_path.isAbsolute)(rel);
}

// src/providers/adapters.mjs
var import_node_os = __toESM(require("node:os"), 1);
var import_node_path2 = require("node:path");
var SYSTEM_EXECUTABLE_ROOTS = Object.freeze(["/usr/bin", "/usr/local/bin"]);
var PROVIDER_ADAPTERS = Object.freeze({
  claude: Object.freeze({
    providerId: "claude",
    agentTarget: "claude",
    executable: "claude",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, (0, import_node_path2.join)(import_node_os.default.homedir(), ".local", "share", "claude")]),
    executableEnv: "CLAUDE_CODE_EXECUTABLE",
    bridgeLauncher: "claude-agent-acp",
    args: Object.freeze([]),
    effortTransport: "config-option",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "CLAUDE_CONFIG_DIR",
      sourceDir: ".claude",
      bootstrapFiles: Object.freeze([".credentials.json"])
    })
  }),
  codex: Object.freeze({
    providerId: "codex",
    agentTarget: "codex",
    executable: "codex",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, (0, import_node_path2.join)(import_node_os.default.homedir(), ".volta", "tools", "image")]),
    candidateResolvers: Object.freeze([
      Object.freeze({ executable: (0, import_node_path2.join)(import_node_os.default.homedir(), ".volta", "bin", "volta"), args: Object.freeze(["which", "codex"]) })
    ]),
    executableEnv: "CODEX_PATH",
    bridgeLauncher: "codex-acp",
    args: Object.freeze([]),
    sandboxHome: Object.freeze({ env: "CODEX_HOME", sourceDir: ".codex", bootstrapFiles: Object.freeze(["auth.json"]) }),
    effortTransport: "model-id-suffix",
    credentialEnv: Object.freeze([])
  }),
  "grok-build": Object.freeze({
    providerId: "grok-build",
    agentTarget: "grok-build",
    executable: "grok",
    executableRoots: Object.freeze([...SYSTEM_EXECUTABLE_ROOTS, (0, import_node_path2.join)(import_node_os.default.homedir(), ".grok", "downloads")]),
    executableEnv: null,
    bridgeLauncher: null,
    args: Object.freeze(["agent", "stdio"]),
    effortTransport: "runtime-probe",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "GROK_HOME",
      sourceDir: ".grok",
      bootstrapFiles: Object.freeze(["auth.json"])
    })
  }),
  kimi: Object.freeze({
    providerId: "kimi",
    agentTarget: "kimi",
    executable: "kimi",
    executableRoots: Object.freeze([
      ...SYSTEM_EXECUTABLE_ROOTS,
      (0, import_node_path2.join)(import_node_os.default.homedir(), ".local", "share", "uv", "tools", "kimi-cli"),
      (0, import_node_path2.join)(import_node_os.default.homedir(), ".local", "share", "pipx", "venvs", "kimi-cli")
    ]),
    executableEnv: null,
    bridgeLauncher: null,
    args: Object.freeze(["acp"]),
    effortTransport: "runtime-probe",
    credentialEnv: Object.freeze([]),
    sandboxHome: Object.freeze({
      env: "KIMI_HOME",
      sourceDir: ".kimi",
      bootstrapFiles: Object.freeze(["auth.json", "credentials.json", "credentials/kimi-code.json"])
    })
  })
});
function getProviderAdapter(providerId) {
  return PROVIDER_ADAPTERS[providerId] ?? null;
}

// src/runtime/bootstrap.mjs
var AUTH_BOOTSTRAP_PROMPT = "Respond with exactly AUTH_READY. Do not call tools, inspect files, or read the workspace.";

// src/provider-sandbox.mjs
var BASE_ENV_KEYS = Object.freeze([
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS"
]);
var SANDBOX_RUNTIME_ROOT = "/agent-orchestration-runtime";
async function pathExists(path) {
  return (0, import_promises.lstat)(path).then(() => true, () => false);
}
async function resolveExecutable(name, env = process.env) {
  for (const directory of (env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const candidate = (0, import_node_path3.join)(directory, name);
    try {
      await (0, import_promises.access)(candidate, import_node_fs.constants.X_OK);
      return candidate;
    } catch {
    }
  }
  invariant(false, "AO_PROVIDER_EXECUTABLE_NOT_FOUND", `Trusted provider executable '${name}' was not found on PATH.`);
}
function nodeInstallationRoot(executable) {
  const marker = `${import_node_path3.sep}lib${import_node_path3.sep}node_modules${import_node_path3.sep}`;
  const markerIndex = executable.indexOf(marker);
  if (markerIndex >= 0) {
    const candidate2 = executable.slice(0, markerIndex);
    return candidate2 !== "/" && !isPathWithin(candidate2, import_node_os2.default.homedir()) ? candidate2 : null;
  }
  const binMarker = `${import_node_path3.sep}bin${import_node_path3.sep}`;
  const binIndex = executable.lastIndexOf(binMarker);
  if (binIndex < 0) return null;
  const candidate = executable.slice(0, binIndex);
  return candidate !== "/" && !isPathWithin(candidate, import_node_os2.default.homedir()) ? candidate : null;
}
function assertSafeInstallationRoot(root, protectedPaths) {
  invariant(root !== "/" && !isPathWithin(root, import_node_os2.default.homedir()), "AO_UNSAFE_INSTALLATION_ROOT", "Refusing to mount an installation root that contains the user home.");
  for (const protectedPath of protectedPaths) {
    invariant(!isPathWithin(root, protectedPath) && !isPathWithin(protectedPath, root), "AO_UNSAFE_INSTALLATION_ROOT", "Provider installation roots must not overlap workspace, Git, state, or broker paths.", { root, protectedPath });
  }
}
async function trustedCommand(providerId, pluginRoot, selectedExecutable) {
  const adapter = getProviderAdapter(providerId);
  invariant(adapter, "AO_PROVIDER_ADAPTER_MISSING", `No trusted sandbox command exists for ${providerId}.`);
  const selected = selectedExecutable || await resolveExecutable(adapter.executable);
  invariant((0, import_node_path3.isAbsolute)(selected), "AO_PROVIDER_EXECUTABLE_NOT_ABSOLUTE", "The broker-selected provider executable must be absolute.");
  await (0, import_promises.access)(selected, import_node_fs.constants.X_OK);
  const providerExecutable = await (0, import_promises.realpath)(selected);
  invariant(!isPathWithin(pluginRoot, providerExecutable), "AO_PROVIDER_EXECUTABLE_UNTRUSTED", "A provider executable cannot come from the plugin installation.");
  invariant(adapter.executableRoots.some((root) => isPathWithin(root, providerExecutable)), "AO_PROVIDER_EXECUTABLE_UNTRUSTED", "The provider executable is outside its declared trusted installation roots.", { providerId, providerExecutable });
  const executable = adapter.bridgeLauncher ? (0, import_node_path3.join)(pluginRoot, "bin", adapter.bridgeLauncher) : providerExecutable;
  return { adapter, providerExecutable, command: [executable, ...adapter.args] };
}
async function prepareProviderHome(adapter, brokerControlDir, tempDir) {
  if (!adapter.sandboxHome) return { environment: {}, bootstrapFiles: [], bootstrapMounts: [], protectedDirectories: [] };
  const sourceHome = (0, import_node_path3.join)(brokerControlDir, "provider-home", adapter.providerId);
  const hostHomeRoot = (0, import_node_path3.join)(tempDir, "provider-home");
  const targetHome = (0, import_node_path3.join)(hostHomeRoot, adapter.providerId);
  const sandboxHomeRoot = (0, import_node_path3.join)(SANDBOX_RUNTIME_ROOT, "provider-home");
  const sandboxHome = (0, import_node_path3.join)(sandboxHomeRoot, adapter.providerId);
  await Promise.all([
    (0, import_promises.mkdir)(sourceHome, { recursive: true, mode: 448 }),
    (0, import_promises.mkdir)(targetHome, { recursive: true, mode: 448 })
  ]);
  const bootstrapFiles = [];
  const bootstrapMounts = [];
  const protectedDirectories = /* @__PURE__ */ new Map([
    [hostHomeRoot, sandboxHomeRoot],
    [targetHome, sandboxHome]
  ]);
  for (const name of adapter.sandboxHome.bootstrapFiles) {
    const source = (0, import_node_path3.join)(import_node_os2.default.homedir(), adapter.sandboxHome.sourceDir, name);
    try {
      await (0, import_promises.access)(source);
    } catch {
      continue;
    }
    const target = (0, import_node_path3.join)(sourceHome, name);
    const sandboxTargetHost = (0, import_node_path3.join)(targetHome, name);
    const sandboxTarget = (0, import_node_path3.join)(sandboxHome, name);
    await (0, import_promises.mkdir)((0, import_node_path3.dirname)(target), { recursive: true, mode: 448 });
    await (0, import_promises.mkdir)((0, import_node_path3.dirname)(sandboxTargetHost), { recursive: true, mode: 448 });
    let protectedHostDirectory = (0, import_node_path3.dirname)(sandboxTargetHost);
    while (isPathWithin(targetHome, protectedHostDirectory)) {
      const suffix = (0, import_node_path3.relative)(targetHome, protectedHostDirectory);
      protectedDirectories.set(protectedHostDirectory, suffix ? (0, import_node_path3.join)(sandboxHome, suffix) : sandboxHome);
      if (protectedHostDirectory === targetHome) break;
      protectedHostDirectory = (0, import_node_path3.dirname)(protectedHostDirectory);
    }
    const present = await pathExists(target);
    if (!present) {
      await (0, import_promises.copyFile)(await (0, import_promises.realpath)(source), target, import_node_fs.constants.COPYFILE_EXCL);
      await (0, import_promises.chmod)(target, 384);
    }
    const sandboxTargetInfo = await (0, import_promises.lstat)(sandboxTargetHost).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    invariant(!sandboxTargetInfo || sandboxTargetInfo.isFile() && !sandboxTargetInfo.isSymbolicLink(), "AO_BOOTSTRAP_TARGET_REPLACED", "Provider bootstrap mount target was replaced between transport sessions.");
    await (0, import_promises.writeFile)(sandboxTargetHost, "", { mode: 384, flag: sandboxTargetInfo ? "w" : "wx" });
    await (0, import_promises.chmod)(sandboxTargetHost, 384);
    bootstrapFiles.push(target);
    bootstrapMounts.push({ source: target, destination: sandboxTarget });
  }
  return {
    environment: { [adapter.sandboxHome.env]: sandboxHome },
    bootstrapFiles,
    bootstrapMounts,
    protectedDirectories: [...protectedDirectories].map(([source, destination]) => ({ source, destination })).sort((a, b) => a.source.length - b.source.length)
  };
}
async function revokeBootstrapFiles(paths) {
  for (const path of paths) {
    const info = await (0, import_promises.lstat)(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) continue;
    invariant(info.isFile() && !info.isSymbolicLink(), "AO_BOOTSTRAP_FILE_REPLACED", "Provider bootstrap material was replaced before revocation.");
    const handle = await (0, import_promises.open)(path, import_node_fs.constants.O_WRONLY | import_node_fs.constants.O_TRUNC | import_node_fs.constants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await (0, import_promises.unlink)(path);
  }
}
function parentDirectoryArgs(path, created) {
  const root = (0, import_node_path3.parse)(path).root;
  const segments = (0, import_node_path3.relative)(root, (0, import_node_path3.dirname)(path)).split(import_node_path3.sep).filter(Boolean);
  const args = [];
  let current = root;
  for (const segment of segments) {
    current = (0, import_node_path3.resolve)(current, segment);
    if (created.has(current)) continue;
    args.push("--dir", current);
    created.add(current);
  }
  return args;
}
async function addReadOnlyMount(args, source, destination, created, mounted) {
  const sourcePath = await (0, import_promises.realpath)(source).catch(() => null);
  if (!sourcePath || mounted.has(destination)) return;
  args.push(...parentDirectoryArgs(destination, created), "--ro-bind", sourcePath, destination);
  mounted.add(destination);
}
function sandboxEnvironment({ adapter, providerExecutable, command, providerHomeEnvironment, tempDir, permissionProfile }) {
  const environment = {
    HOME: import_node_os2.default.homedir(),
    USER: import_node_os2.default.userInfo().username,
    LOGNAME: import_node_os2.default.userInfo().username,
    TMPDIR: tempDir,
    PATH: [.../* @__PURE__ */ new Set(["/usr/local/bin", "/usr/bin", "/bin", (0, import_node_path3.dirname)(process.execPath), (0, import_node_path3.dirname)(providerExecutable), (0, import_node_path3.dirname)(command[0])])].join(":"),
    ...providerHomeEnvironment
  };
  for (const key of BASE_ENV_KEYS) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  if (adapter.providerId === "codex") {
    environment.INITIAL_AGENT_MODE = permissionProfile === "write" ? "agent" : "read-only";
  }
  if (adapter.executableEnv) environment[adapter.executableEnv] = providerExecutable;
  return environment;
}
async function sandboxPlan({ providerId, pluginRoot, workspacePath, commonGitDir, sandboxTempDir, brokerControlDir, providerExecutable, permissionProfile }) {
  invariant(getProviderAdapter(providerId), "AO_PROVIDER_ADAPTER_MISSING", `No trusted sandbox command exists for ${providerId}.`);
  invariant((0, import_node_path3.isAbsolute)(workspacePath) && (0, import_node_path3.isAbsolute)(commonGitDir), "AO_SANDBOX_PATH_NOT_ABSOLUTE", "Sandbox paths must be absolute.");
  invariant((0, import_node_path3.isAbsolute)(sandboxTempDir) && (0, import_node_path3.isAbsolute)(brokerControlDir), "AO_SANDBOX_PATH_NOT_ABSOLUTE", "Sandbox temp and broker control paths must be absolute.");
  const [workspace, gitDir, tempDir] = await Promise.all([(0, import_promises.realpath)(workspacePath), (0, import_promises.realpath)(commonGitDir), (0, import_promises.realpath)(sandboxTempDir)]);
  if (permissionProfile === "write") {
    invariant(!isPathWithin(workspace, gitDir), "AO_UNSAFE_GIT_LAYOUT", "Shared Git metadata cannot be inside the writable workspace.");
  }
  const gitFile = (0, import_node_path3.join)(workspace, ".git");
  const gitMarker = await (0, import_promises.lstat)(gitFile);
  if (permissionProfile === "write") invariant(gitMarker.isFile(), "AO_UNSAFE_GIT_LAYOUT", "A write workspace must be a linked worktree with a .git pointer file.");
  await Promise.all([(0, import_promises.access)("/usr/bin/bwrap"), (0, import_promises.access)("/usr/bin/slirp4netns")]);
  const controlDir = await (0, import_promises.realpath)(brokerControlDir);
  const controlInfo = await (0, import_promises.lstat)(controlDir);
  invariant(controlInfo.isDirectory() && !controlInfo.isSymbolicLink(), "AO_UNSAFE_BROKER_CONTROL_DIR", "Broker control path must be a real directory.");
  const { adapter, providerExecutable: executable, command } = await trustedCommand(providerId, pluginRoot, providerExecutable);
  const providerHome = await prepareProviderHome(adapter, controlDir, tempDir);
  const environment = sandboxEnvironment({ adapter, providerExecutable: executable, command, providerHomeEnvironment: providerHome.environment, tempDir: SANDBOX_RUNTIME_ROOT, permissionProfile });
  const created = /* @__PURE__ */ new Set(["/"]);
  const mounted = /* @__PURE__ */ new Set();
  const args = [
    "--unshare-all",
    "--die-with-parent",
    "--new-session",
    "--tmpfs",
    "/",
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    "--tmpfs",
    "/run",
    "--tmpfs",
    "/tmp"
  ];
  for (const systemPath of ["/usr"]) {
    if (await pathExists(systemPath)) await addReadOnlyMount(args, systemPath, systemPath, created, mounted);
  }
  for (const systemPath of [
    "/etc/ssl",
    "/etc/pki",
    "/etc/ca-certificates.conf",
    "/etc/hosts",
    "/etc/nsswitch.conf",
    "/etc/gai.conf",
    "/etc/passwd",
    "/etc/group",
    "/etc/localtime",
    "/etc/os-release",
    "/etc/gitconfig"
  ]) {
    if (await pathExists(systemPath)) await addReadOnlyMount(args, systemPath, systemPath, created, mounted);
  }
  const sandboxDnsConfig = (0, import_node_path3.join)(controlDir, "resolv.conf");
  await (0, import_promises.writeFile)(sandboxDnsConfig, "nameserver 10.0.2.3\noptions timeout:2 attempts:3\n", { mode: 384, flag: "wx" });
  await addReadOnlyMount(args, sandboxDnsConfig, "/etc/resolv.conf", created, mounted);
  for (const [target, value] of [["/bin", "usr/bin"], ["/sbin", "usr/sbin"], ["/lib", "usr/lib"], ["/lib64", "usr/lib64"]]) {
    if (await pathExists(target)) args.push("--symlink", value, target);
  }
  const runtimeRoot = nodeInstallationRoot(await (0, import_promises.realpath)(process.execPath));
  if (runtimeRoot && await pathExists(runtimeRoot)) {
    assertSafeInstallationRoot(runtimeRoot, [workspace, gitDir, tempDir, controlDir]);
    await addReadOnlyMount(args, runtimeRoot, runtimeRoot, created, mounted);
  }
  if (await pathExists(pluginRoot)) await addReadOnlyMount(args, pluginRoot, pluginRoot, created, mounted);
  const providerRoot = nodeInstallationRoot(executable);
  if (providerRoot && await pathExists(providerRoot)) {
    assertSafeInstallationRoot(providerRoot, [workspace, gitDir, tempDir, controlDir]);
    await addReadOnlyMount(args, providerRoot, providerRoot, created, mounted);
  } else {
    await addReadOnlyMount(args, executable, executable, created, mounted);
  }
  const workspaceMount = permissionProfile === "write" ? "--bind" : "--ro-bind";
  args.push(
    ...parentDirectoryArgs(workspace, created),
    workspaceMount,
    workspace,
    workspace,
    "--dir",
    SANDBOX_RUNTIME_ROOT,
    "--bind",
    tempDir,
    SANDBOX_RUNTIME_ROOT,
    ...providerHome.protectedDirectories.flatMap((directory) => ["--bind", directory.source, directory.destination]),
    ...providerHome.bootstrapMounts.flatMap((mount) => ["--ro-bind", mount.source, mount.destination]),
    ...parentDirectoryArgs(gitFile, created),
    "--ro-bind",
    gitFile,
    gitFile,
    ...parentDirectoryArgs(gitDir, created),
    "--ro-bind",
    gitDir,
    gitDir,
    "--clearenv"
  );
  for (const [key, value] of Object.entries(environment)) args.push("--setenv", key, value);
  args.push("--chdir", workspace, "--", ...command);
  return { args, bootstrapFiles: providerHome.bootstrapFiles };
}
async function sandboxArguments(params) {
  return (await sandboxPlan(params)).args;
}
async function readBubblewrapInfo(stream, timeoutMs = 1e4) {
  let body = "";
  return new Promise((resolveInfo, rejectInfo) => {
    const timeout = setTimeout(() => rejectInfo(new Error("Timed out waiting for Bubblewrap namespace information.")), timeoutMs);
    const finish = () => {
      try {
        const info = JSON.parse(body);
        if (!Number.isInteger(info["child-pid"])) throw new Error("Bubblewrap did not report child-pid.");
        clearTimeout(timeout);
        resolveInfo(info);
      } catch (error) {
        clearTimeout(timeout);
        rejectInfo(error);
      }
    };
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      body += chunk;
      try {
        const info = JSON.parse(body);
        if (Number.isInteger(info["child-pid"])) {
          clearTimeout(timeout);
          resolveInfo(info);
        }
      } catch {
      }
    });
    stream.once("end", finish);
    stream.once("error", rejectInfo);
  });
}
async function waitForNetworkReady(process2, readyStream, timeoutMs = 1e4) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out configuring the provider network namespace.")), timeoutMs);
    timer.unref();
  });
  await Promise.race([
    (0, import_node_events.once)(readyStream, "data"),
    (0, import_node_events.once)(process2, "exit").then(([code, signal]) => {
      throw new Error(`slirp4netns exited before readiness (exit=${code}, signal=${signal}).`);
    }),
    timeout
  ]);
}
function startAcpProxy(child, revokeBootstrap, { inputStream = process.stdin, outputStream = process.stdout } = {}) {
  const providerRequestIds = /* @__PURE__ */ new Set();
  const establishmentMethods = /* @__PURE__ */ new Set(["session/new", "session/load", "session/resume"]);
  const maxFrameBytes = 1024 * 1024;
  const maxTransportBytes = 16 * 1024 * 1024;
  const maxBufferedBytes = 4 * 1024 * 1024;
  const maxBufferedFrames = 64;
  const bufferedInput = [];
  let bufferedBytes = 0;
  let activeEstablishmentId = null;
  let activeBootstrapId = null;
  let sessionState = "pre_establishment";
  let fatalError = null;
  const fail = (error) => {
    fatalError ??= error;
    child.kill("SIGKILL");
  };
  const writeLine = async (stream, line) => {
    if (!stream.write(`${line}
`)) await (0, import_node_events.once)(stream, "drain");
  };
  const parseMessage = (line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  };
  const bufferLine = (line) => {
    const frameBytes = Buffer.byteLength(line) + 1;
    invariant(bufferedInput.length < maxBufferedFrames && bufferedBytes + frameBytes <= maxBufferedBytes, "AO_ACP_GATE_BUFFER_LIMIT", "ACP input exceeded the bounded pre-prompt gate buffer.");
    bufferedInput.push(line);
    bufferedBytes += frameBytes;
  };
  const isBootstrapPrompt = (message) => {
    const parts = message?.params?.prompt;
    if (!Array.isArray(parts)) return false;
    return parts.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim() === AUTH_BOOTSTRAP_PROMPT;
  };
  const monitorFrames = (stream) => {
    let pendingBytes = 0;
    let totalBytes = 0;
    const onData = (chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += bytes.length;
      if (totalBytes > maxTransportBytes) {
        fail(new AgentOrchestrationError("AO_ACP_TRANSPORT_LIMIT", "ACP transport exceeded the sixteen-megabyte per-process limit."));
        return;
      }
      for (const byte of bytes) {
        if (byte === 10) pendingBytes = 0;
        else if ((pendingBytes += 1) > maxFrameBytes) {
          fail(new AgentOrchestrationError("AO_ACP_FRAME_TOO_LARGE", "ACP transport frame exceeds the one-megabyte limit."));
          break;
        }
      }
    };
    stream.on("data", onData);
    return () => stream.off("data", onData);
  };
  const stopInputMonitor = monitorFrames(inputStream);
  const stopOutputMonitor = monitorFrames(child.stdout);
  const input = import_node_readline.default.createInterface({ input: inputStream, crlfDelay: Infinity });
  let inputChain = Promise.resolve();
  const processInputLine = async (line) => {
    const message = parseMessage(line);
    invariant(message && typeof message === "object", "AO_ACP_INVALID_FRAME", "ACP transport received a malformed JSON frame.");
    const isResponse = message.method === void 0 && message.id !== void 0 && ("result" in message || "error" in message);
    if (isResponse && providerRequestIds.delete(String(message.id))) {
      await writeLine(child.stdin, line);
      return;
    }
    if (message.id !== void 0 && establishmentMethods.has(message.method)) {
      invariant(!["establishing", "bootstrap_pending", "bootstrap_running"].includes(sessionState), "AO_CONCURRENT_SESSION_ESTABLISHMENT", "Only one ACP session-establishment request may be active.");
      activeEstablishmentId = String(message.id);
      sessionState = "establishing";
      await writeLine(child.stdin, line);
      return;
    }
    if (message.method === "session/prompt") {
      if (sessionState === "pre_establishment") throw new AgentOrchestrationError("AO_SESSION_NOT_ESTABLISHED", "ACP prompt was rejected before session establishment.");
      if (sessionState === "bootstrap_pending") {
        invariant(message.id !== void 0 && isBootstrapPrompt(message), "AO_AUTH_BOOTSTRAP_REQUIRED", "The first provider prompt must be the broker-authored authentication bootstrap.");
        activeBootstrapId = String(message.id);
        sessionState = "bootstrap_running";
        await writeLine(child.stdin, line);
        return;
      }
    }
    if (["establishing", "bootstrap_running"].includes(sessionState)) {
      bufferLine(line);
      return;
    }
    invariant(sessionState !== "failed", "AO_ACP_GATE_FAILED", "ACP input was rejected after the prompt gate failed.");
    await writeLine(child.stdin, line);
  };
  const flushBufferedInput = async () => {
    const pending = bufferedInput.splice(0);
    bufferedBytes = 0;
    for (const pendingLine of pending) await processInputLine(pendingLine);
  };
  input.on("line", (line) => {
    input.pause();
    inputChain = inputChain.then(() => processInputLine(line)).catch(fail).finally(() => {
      if (!fatalError) input.resume();
    });
  });
  input.once("close", () => {
    inputChain = inputChain.then(() => child.stdin.end()).catch(fail);
  });
  const output = import_node_readline.default.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let outputChain = Promise.resolve();
  output.on("line", (line) => {
    output.pause();
    outputChain = outputChain.then(async () => {
      const message = parseMessage(line);
      invariant(message && typeof message === "object", "AO_ACP_INVALID_FRAME", "ACP provider emitted a malformed JSON frame.");
      if (message.method !== void 0 && message.id !== void 0) {
        invariant(providerRequestIds.size < 1024, "AO_ACP_PROVIDER_REQUEST_LIMIT", "ACP provider exceeded the outstanding request limit.");
        providerRequestIds.add(String(message.id));
      }
      const isResponse = message?.method === void 0 && message?.id !== void 0 && ("result" in message || "error" in message);
      const establishesSession = isResponse && activeEstablishmentId !== null && String(message.id) === activeEstablishmentId;
      if (establishesSession && "result" in message && !message.error) {
        await writeLine(outputStream, line);
        activeEstablishmentId = null;
        sessionState = "bootstrap_pending";
        await flushBufferedInput();
        return;
      }
      if (establishesSession) {
        sessionState = "failed";
        await revokeBootstrap();
        bufferedInput.splice(0);
        bufferedBytes = 0;
        await writeLine(outputStream, line);
        throw new AgentOrchestrationError("AO_SESSION_ESTABLISHMENT_FAILED", "ACP session establishment failed before the prompt gate opened.");
      }
      const completesBootstrap = isResponse && activeBootstrapId !== null && String(message.id) === activeBootstrapId;
      if (completesBootstrap && "result" in message && !message.error) {
        await revokeBootstrap();
        await writeLine(outputStream, line);
        activeBootstrapId = null;
        sessionState = "established";
        await flushBufferedInput();
        return;
      }
      if (completesBootstrap) {
        sessionState = "failed";
        await revokeBootstrap();
        bufferedInput.splice(0);
        bufferedBytes = 0;
        await writeLine(outputStream, line);
        throw new AgentOrchestrationError("AO_AUTH_BOOTSTRAP_FAILED", "Provider authentication bootstrap failed before the task prompt gate opened.");
      }
      await writeLine(outputStream, line);
    }).catch(fail).finally(() => {
      if (!fatalError) output.resume();
    });
  });
  return (0, import_node_events.once)(output, "close").then(async () => {
    input.close();
    child.stdin.end();
    stopInputMonitor();
    stopOutputMonitor();
    await inputChain;
    await outputChain;
    if (fatalError) throw fatalError;
  });
}
async function main() {
  const providerId = process.argv[2];
  const pluginRoot = await (0, import_promises.realpath)((0, import_node_url.fileURLToPath)(new URL("..", __aoImportMetaUrl)));
  for (const entry of await (0, import_promises.readdir)("/dev/shm", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^agent-orchestration-broker-(\d+)-/.exec(entry.name);
    if (!match) continue;
    try {
      process.kill(Number(match[1]), 0);
    } catch (error) {
      if (error?.code === "ESRCH") await (0, import_promises.rm)((0, import_node_path3.join)("/dev/shm", entry.name), { recursive: true, force: true });
    }
  }
  const brokerControlDir = await (0, import_promises.mkdtemp)((0, import_node_path3.join)("/dev/shm", `agent-orchestration-broker-${process.pid}-`));
  let child;
  let network;
  let terminating = false;
  for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]]) {
    process.once(signal, () => {
      if (terminating) return;
      terminating = true;
      child?.kill(signal);
      network?.kill(signal);
      (0, import_promises.rm)(brokerControlDir, { recursive: true, force: true }).finally(() => process.exit(exitCode));
    });
  }
  const plan = await sandboxPlan({
    providerId,
    pluginRoot,
    workspacePath: process.env.ao_sandbox_workspace,
    commonGitDir: process.env.ao_sandbox_common_git_dir,
    sandboxTempDir: process.env.ao_sandbox_temp_dir,
    brokerControlDir,
    providerExecutable: process.env.ao_provider_executable,
    permissionProfile: process.env.ao_sandbox_permission_profile
  }).catch(async (error) => {
    await (0, import_promises.rm)(brokerControlDir, { recursive: true, force: true });
    throw error;
  });
  let bootstrapRevoked = false;
  const revokeBootstrap = async () => {
    if (bootstrapRevoked) return;
    await revokeBootstrapFiles(plan.bootstrapFiles);
    bootstrapRevoked = true;
  };
  let outcome;
  try {
    child = (0, import_node_child_process2.spawn)("/usr/bin/bwrap", ["--info-fd", "3", "--block-fd", "4", ...plan.args], {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
      shell: false
    });
    const childOutcome = new Promise((resolveOutcome, rejectOutcome) => {
      child.once("error", rejectOutcome);
      child.once("exit", (code, signal) => resolveOutcome({ code, signal }));
    });
    let stderrBytes = 0;
    let stderrLimitReached = false;
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 8 * 1024 * 1024) {
        if (!stderrLimitReached) process.stderr.write("[agent-orchestration-sandbox] provider stderr exceeded eight megabytes; terminating.\n");
        stderrLimitReached = true;
        child.kill("SIGKILL");
        return;
      }
      if (!process.stderr.write(chunk)) {
        child.stderr.pause();
        process.stderr.once("drain", () => child.stderr.resume());
      }
    });
    const proxyDone = startAcpProxy(child, revokeBootstrap);
    const info = await readBubblewrapInfo(child.stdio[3]);
    network = (0, import_node_child_process2.spawn)("/usr/bin/slirp4netns", [
      "--configure",
      "--mtu=65520",
      "--disable-host-loopback",
      "--enable-sandbox",
      "--ready-fd=3",
      "--exit-fd=4",
      String(info["child-pid"]),
      "tap0"
    ], {
      stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
      shell: false
    });
    await waitForNetworkReady(network, network.stdio[3]);
    child.stdio[4].end("1");
    outcome = await childOutcome;
    await proxyDone;
  } catch (error) {
    child?.kill("SIGKILL");
    network?.kill("SIGKILL");
    throw error;
  } finally {
    network?.stdio[4]?.end();
    if (network) {
      await Promise.race([(0, import_node_events.once)(network, "exit"), new Promise((resolveExit) => setTimeout(resolveExit, 1e3))]);
      if (network.exitCode === null) network.kill("SIGTERM");
    }
    await revokeBootstrap();
    await (0, import_promises.rm)(brokerControlDir, { recursive: true, force: true });
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}
if (__aoImportMetaUrl === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`[agent-orchestration-sandbox] ${JSON.stringify(serializeError(error))}
`);
    process.exitCode = 1;
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  sandboxArguments,
  startAcpProxy
});

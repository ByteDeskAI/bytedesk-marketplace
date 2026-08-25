#!/usr/bin/env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { delimiter, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import readline from "node:readline";
import { AgentOrchestrationError, invariant, serializeError } from "./errors.mjs";
import { atomicWriteJson, isPathWithin } from "./util.mjs";
import { getProviderAdapter } from "./providers/adapters.mjs";
import { AUTH_BOOTSTRAP_PROMPT } from "./runtime/bootstrap.mjs";

const BASE_ENV_KEYS = Object.freeze([
  "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TZ",
  "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS",
]);
const SANDBOX_RUNTIME_ROOT = "/agent-orchestration-runtime";

async function pathExists(path) {
  return lstat(path).then(() => true, () => false);
}

async function resolveExecutable(name, env = process.env) {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  invariant(false, "AO_PROVIDER_EXECUTABLE_NOT_FOUND", `Trusted provider executable '${name}' was not found on PATH.`);
}

function nodeInstallationRoot(executable) {
  const marker = `${sep}lib${sep}node_modules${sep}`;
  const markerIndex = executable.indexOf(marker);
  if (markerIndex >= 0) {
    const candidate = executable.slice(0, markerIndex);
    return candidate !== "/" && !isPathWithin(candidate, os.homedir()) ? candidate : null;
  }
  const binMarker = `${sep}bin${sep}`;
  const binIndex = executable.lastIndexOf(binMarker);
  if (binIndex < 0) return null;
  const candidate = executable.slice(0, binIndex);
  return candidate !== "/" && !isPathWithin(candidate, os.homedir()) ? candidate : null;
}

function assertSafeInstallationRoot(root, protectedPaths) {
  invariant(root !== "/" && !isPathWithin(root, os.homedir()), "AO_UNSAFE_INSTALLATION_ROOT", "Refusing to mount an installation root that contains the user home.");
  for (const protectedPath of protectedPaths) {
    invariant(!isPathWithin(root, protectedPath) && !isPathWithin(protectedPath, root), "AO_UNSAFE_INSTALLATION_ROOT", "Provider installation roots must not overlap workspace, Git, state, or broker paths.", { root, protectedPath });
  }
}

async function trustedCommand(providerId, pluginRoot, selectedExecutable) {
  const adapter = getProviderAdapter(providerId);
  invariant(adapter, "AO_PROVIDER_ADAPTER_MISSING", `No trusted sandbox command exists for ${providerId}.`);
  const selected = selectedExecutable || await resolveExecutable(adapter.executable);
  invariant(isAbsolute(selected), "AO_PROVIDER_EXECUTABLE_NOT_ABSOLUTE", "The broker-selected provider executable must be absolute.");
  await access(selected, constants.X_OK);
  const providerExecutable = await realpath(selected);
  invariant(!isPathWithin(pluginRoot, providerExecutable), "AO_PROVIDER_EXECUTABLE_UNTRUSTED", "A provider executable cannot come from the plugin installation.");
  invariant(adapter.executableRoots.some((root) => isPathWithin(root, providerExecutable)), "AO_PROVIDER_EXECUTABLE_UNTRUSTED", "The provider executable is outside its declared trusted installation roots.", { providerId, providerExecutable });
  const command = adapter.bridgeLauncher
    ? process.platform === "win32"
      ? [process.execPath, "--preserve-symlinks", "--preserve-symlinks-main", join(pluginRoot, "dist", `${adapter.bridgeLauncher}.mjs`)]
      : [join(pluginRoot, "bin", adapter.bridgeLauncher)]
    : [providerExecutable];
  return { adapter, providerExecutable, command: [...command, ...adapter.args] };
}

async function prepareNativeProviderHome(adapter, brokerControlDir) {
  if (!adapter.sandboxHome) return { environment: {}, bootstrapFiles: [], root: null };
  const root = join(brokerControlDir, "provider-home", adapter.providerId);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const bootstrapFiles = [];
  for (const name of adapter.sandboxHome.bootstrapFiles) {
    const source = join(os.homedir(), adapter.sandboxHome.sourceDir, name);
    try { await access(source); } catch { continue; }
    const target = join(root, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyFile(await realpath(source), target, constants.COPYFILE_EXCL);
    await chmod(target, 0o600);
    bootstrapFiles.push(target);
  }
  return { environment: { [adapter.sandboxHome.env]: root }, bootstrapFiles, root };
}

async function prepareProviderHome(adapter, brokerControlDir, tempDir) {
  if (!adapter.sandboxHome) return { environment: {}, bootstrapFiles: [], bootstrapMounts: [], protectedDirectories: [] };
  // Auth material stays in a broker-owned tree that is never writable from the
  // provider namespace. An empty destination is over-mounted read-only below.
  // Revocation therefore operates only on broker-owned paths, never on a path
  // whose ancestors a provider could rename or replace.
  const sourceHome = join(brokerControlDir, "provider-home", adapter.providerId);
  const hostHomeRoot = join(tempDir, "provider-home");
  const targetHome = join(hostHomeRoot, adapter.providerId);
  const sandboxHomeRoot = join(SANDBOX_RUNTIME_ROOT, "provider-home");
  const sandboxHome = join(sandboxHomeRoot, adapter.providerId);
  await Promise.all([
    mkdir(sourceHome, { recursive: true, mode: 0o700 }),
    mkdir(targetHome, { recursive: true, mode: 0o700 }),
  ]);
  const bootstrapFiles = [];
  const bootstrapMounts = [];
  const protectedDirectories = new Map([
    [hostHomeRoot, sandboxHomeRoot],
    [targetHome, sandboxHome],
  ]);
  for (const name of adapter.sandboxHome.bootstrapFiles) {
    const source = join(os.homedir(), adapter.sandboxHome.sourceDir, name);
    try { await access(source); } catch { continue; }
    const target = join(sourceHome, name);
    const sandboxTargetHost = join(targetHome, name);
    const sandboxTarget = join(sandboxHome, name);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await mkdir(dirname(sandboxTargetHost), { recursive: true, mode: 0o700 });
    let protectedHostDirectory = dirname(sandboxTargetHost);
    while (isPathWithin(targetHome, protectedHostDirectory)) {
      const suffix = relative(targetHome, protectedHostDirectory);
      protectedDirectories.set(protectedHostDirectory, suffix ? join(sandboxHome, suffix) : sandboxHome);
      if (protectedHostDirectory === targetHome) break;
      protectedHostDirectory = dirname(protectedHostDirectory);
    }
    const present = await pathExists(target);
    if (!present) {
      await copyFile(await realpath(source), target, constants.COPYFILE_EXCL);
      await chmod(target, 0o600);
    }
    const sandboxTargetInfo = await lstat(sandboxTargetHost).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    invariant(!sandboxTargetInfo || (sandboxTargetInfo.isFile() && !sandboxTargetInfo.isSymbolicLink()), "AO_BOOTSTRAP_TARGET_REPLACED", "Provider bootstrap mount target was replaced between transport sessions.");
    await writeFile(sandboxTargetHost, "", { mode: 0o600, flag: sandboxTargetInfo ? "w" : "wx" });
    await chmod(sandboxTargetHost, 0o600);
    bootstrapFiles.push(target);
    bootstrapMounts.push({ source: target, destination: sandboxTarget });
  }
  return {
    environment: { [adapter.sandboxHome.env]: sandboxHome },
    bootstrapFiles,
    bootstrapMounts,
    protectedDirectories: [...protectedDirectories].map(([source, destination]) => ({ source, destination })).sort((a, b) => a.source.length - b.source.length),
  };
}

async function revokeBootstrapFiles(paths) {
  for (const path of paths) {
    const info = await lstat(path).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
    if (!info) continue;
    invariant(info.isFile() && !info.isSymbolicLink(), "AO_BOOTSTRAP_FILE_REPLACED", "Provider bootstrap material was replaced before revocation.");
    const handle = process.platform === "win32"
      ? await open(path, "r+")
      : await open(path, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
    try {
      if (process.platform === "win32") await handle.truncate(0);
      await handle.sync();
    } finally { await handle.close(); }
    await unlink(path);
  }
}

function parentDirectoryArgs(path, created) {
  const root = parse(path).root;
  const segments = relative(root, dirname(path)).split(sep).filter(Boolean);
  const args = [];
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (created.has(current)) continue;
    args.push("--dir", current);
    created.add(current);
  }
  return args;
}

async function addReadOnlyMount(args, source, destination, created, mounted) {
  const sourcePath = await realpath(source).catch(() => null);
  if (!sourcePath || mounted.has(destination)) return;
  args.push(...parentDirectoryArgs(destination, created), "--ro-bind", sourcePath, destination);
  mounted.add(destination);
}

function sandboxEnvironment({ adapter, providerExecutable, command, providerHomeEnvironment, tempDir, permissionProfile }) {
  // Host $HOME is not mounted. Point HOME at the writable provider config dir
  // (or scratch) so subscription CLIs can resolve credentials without dbus.
  const sandboxHome = adapter.sandboxHome ? providerHomeEnvironment[adapter.sandboxHome.env] : null;
  const environment = {
    HOME: sandboxHome || tempDir,
    USER: os.userInfo().username,
    LOGNAME: os.userInfo().username,
    TMPDIR: tempDir,
    PATH: [...new Set(process.platform === "win32"
      ? [dirname(process.execPath), dirname(providerExecutable), dirname(command[0]), process.env.SystemRoot && join(process.env.SystemRoot, "System32")].filter(Boolean)
      : ["/usr/local/bin", "/usr/bin", "/bin", dirname(process.execPath), dirname(providerExecutable), dirname(command[0])])].join(delimiter),
    ...providerHomeEnvironment,
  };
  if (process.platform === "win32") {
    environment.TEMP = tempDir;
    environment.TMP = tempDir;
    environment.USERPROFILE = sandboxHome || tempDir;
    environment.SystemRoot = process.env.SystemRoot;
    environment.WINDIR = process.env.WINDIR;
    environment.SystemDrive = process.env.SystemDrive;
    environment.ComSpec = process.env.ComSpec;
    environment.PATHEXT = process.env.PATHEXT;
    environment.OS = process.env.OS;
    environment.PROCESSOR_ARCHITECTURE = process.env.PROCESSOR_ARCHITECTURE;
    environment.NUMBER_OF_PROCESSORS = process.env.NUMBER_OF_PROCESSORS;
    for (const key of [
      "LOCALAPPDATA", "APPDATA", "ProgramData", "ProgramFiles", "ProgramW6432",
      "CommonProgramFiles", "CommonProgramW6432", "HOMEDRIVE", "HOMEPATH",
      "USERNAME", "USERDOMAIN", "PUBLIC",
    ]) {
      if (typeof process.env[key] === "string") environment[key] = process.env[key];
    }
  }
  for (const key of BASE_ENV_KEYS) {
    if (typeof process.env[key] === "string") environment[key] = process.env[key];
  }
  if (adapter.providerId === "codex") {
    // Bubblewrap still enforces the orchestration read/write mount. Codex itself
    // must not prompt: agent-full-access is the yolo / skip-permissions equivalent.
    environment.INITIAL_AGENT_MODE = "agent-full-access";
  }
  if (adapter.executableEnv) environment[adapter.executableEnv] = providerExecutable;
  return environment;
}

/**
 * Build an allowlisted Bubblewrap filesystem. The host root, runtime sockets,
 * inherited devices, and ambient environment are intentionally absent.
 */
async function sandboxPlan({ providerId, pluginRoot, workspacePath, commonGitDir, sandboxTempDir, brokerControlDir, providerExecutable, permissionProfile }) {
  invariant(getProviderAdapter(providerId), "AO_PROVIDER_ADAPTER_MISSING", `No trusted sandbox command exists for ${providerId}.`);
  invariant(isAbsolute(workspacePath) && isAbsolute(commonGitDir), "AO_SANDBOX_PATH_NOT_ABSOLUTE", "Sandbox paths must be absolute.");
  invariant(isAbsolute(sandboxTempDir) && isAbsolute(brokerControlDir), "AO_SANDBOX_PATH_NOT_ABSOLUTE", "Sandbox temp and broker control paths must be absolute.");
  const [workspace, gitDir, tempDir] = await Promise.all([realpath(workspacePath), realpath(commonGitDir), realpath(sandboxTempDir)]);
  if (permissionProfile === "write") {
    invariant(!isPathWithin(workspace, gitDir), "AO_UNSAFE_GIT_LAYOUT", "Shared Git metadata cannot be inside the writable workspace.");
  }
  const gitFile = join(workspace, ".git");
  const gitMarker = await lstat(gitFile);
  if (permissionProfile === "write") invariant(gitMarker.isFile(), "AO_UNSAFE_GIT_LAYOUT", "A write workspace must be a linked worktree with a .git pointer file.");
  const wslHosted = process.env.AGENT_ORCHESTRATION_HOST_PLATFORM === "win32";
  await Promise.all([access("/usr/bin/bwrap"), access(wslHosted ? "/usr/bin/pasta" : "/usr/bin/slirp4netns")]);

  const controlDir = await realpath(brokerControlDir);
  const controlInfo = await lstat(controlDir);
  invariant(controlInfo.isDirectory() && !controlInfo.isSymbolicLink(), "AO_UNSAFE_BROKER_CONTROL_DIR", "Broker control path must be a real directory.");
  const { adapter, providerExecutable: executable, command } = await trustedCommand(providerId, pluginRoot, providerExecutable);
  const providerHome = await prepareProviderHome(adapter, controlDir, tempDir);
  const environment = sandboxEnvironment({ adapter, providerExecutable: executable, command, providerHomeEnvironment: providerHome.environment, tempDir: SANDBOX_RUNTIME_ROOT, permissionProfile });
  const created = new Set(["/"]);
  const mounted = new Set();
  const args = [
    "--unshare-all", "--die-with-parent", "--new-session",
    "--tmpfs", "/", "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/run", "--tmpfs", "/tmp",
  ];

  for (const systemPath of ["/usr"]) {
    if (await pathExists(systemPath)) await addReadOnlyMount(args, systemPath, systemPath, created, mounted);
  }
  for (const systemPath of [
    "/etc/ssl", "/etc/pki", "/etc/ca-certificates.conf", "/etc/hosts",
    "/etc/nsswitch.conf", "/etc/gai.conf", "/etc/passwd", "/etc/group",
    "/etc/localtime", "/etc/os-release", "/etc/gitconfig",
  ]) {
    if (await pathExists(systemPath)) await addReadOnlyMount(args, systemPath, systemPath, created, mounted);
  }
  const sandboxDnsConfig = join(controlDir, "resolv.conf");
  const dnsConfig = wslHosted
    ? await readFile("/etc/resolv.conf", "utf8")
    : "nameserver 10.0.2.3\noptions timeout:2 attempts:3\n";
  await writeFile(sandboxDnsConfig, dnsConfig, { mode: 0o600, flag: "wx" });
  await addReadOnlyMount(args, sandboxDnsConfig, "/etc/resolv.conf", created, mounted);
  for (const [target, value] of [["/bin", "usr/bin"], ["/sbin", "usr/sbin"], ["/lib", "usr/lib"], ["/lib64", "usr/lib64"]]) {
    if (await pathExists(target)) args.push("--symlink", value, target);
  }

  const runtimeRoot = nodeInstallationRoot(await realpath(process.execPath));
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
    ...parentDirectoryArgs(workspace, created), workspaceMount, workspace, workspace,
    "--dir", SANDBOX_RUNTIME_ROOT, "--bind", tempDir, SANDBOX_RUNTIME_ROOT,
    ...providerHome.protectedDirectories.flatMap((directory) => ["--bind", directory.source, directory.destination]),
    ...providerHome.bootstrapMounts.flatMap((mount) => ["--ro-bind", mount.source, mount.destination]),
    ...parentDirectoryArgs(gitFile, created), "--ro-bind", gitFile, gitFile,
    ...parentDirectoryArgs(gitDir, created), "--ro-bind", gitDir, gitDir,
    "--clearenv",
  );
  for (const [key, value] of Object.entries(environment)) args.push("--setenv", key, value);
  args.push("--chdir", workspace, "--", ...command);
  return { args, bootstrapFiles: providerHome.bootstrapFiles };
}

export async function sandboxArguments(params) {
  return (await sandboxPlan(params)).args;
}

/** Strategy payload consumed by the native Windows AppContainer helper. */
export async function windowsSandboxPlan({ providerId, pluginRoot, workspacePath, commonGitDir, sandboxTempDir, brokerControlDir, providerExecutable, permissionProfile }) {
  invariant(process.platform === "win32" || process.env.AGENT_ORCHESTRATION_TEST_WINDOWS_SANDBOX === "1", "AO_WINDOWS_SANDBOX_PLATFORM", "The AppContainer sandbox strategy runs only on Windows.");
  invariant(isAbsolute(workspacePath) && isAbsolute(commonGitDir) && isAbsolute(sandboxTempDir) && isAbsolute(brokerControlDir), "AO_SANDBOX_PATH_NOT_ABSOLUTE", "Sandbox paths must be absolute.");
  const [workspace, gitDir, tempDir, controlDir, canonicalPluginRoot] = await Promise.all([
    realpath(workspacePath), realpath(commonGitDir), realpath(sandboxTempDir), realpath(brokerControlDir), realpath(pluginRoot),
  ]);
  if (permissionProfile === "write") invariant(!isPathWithin(workspace, gitDir), "AO_UNSAFE_GIT_LAYOUT", "Shared Git metadata cannot be inside the writable workspace.");
  const gitFile = join(workspace, ".git");
  const gitMarker = await lstat(gitFile);
  if (permissionProfile === "write") invariant(gitMarker.isFile(), "AO_UNSAFE_GIT_LAYOUT", "A write workspace must be a linked worktree with a .git pointer file.");
  const controlInfo = await lstat(controlDir);
  invariant(controlInfo.isDirectory() && !controlInfo.isSymbolicLink(), "AO_UNSAFE_BROKER_CONTROL_DIR", "Broker control path must be a real directory.");
  const trusted = await trustedCommand(providerId, canonicalPluginRoot, providerExecutable);
  const { adapter, providerExecutable: executable } = trusted;
  const command = [...trusted.command];
  let sandboxExecutable = executable;
  const protectedWindowsRoot = (path) => {
    const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.SystemRoot].filter(Boolean);
    return roots.some((root) => isPathWithin(root, path));
  };
  if (protectedWindowsRoot(executable)) {
    const stagedProvider = join(tempDir, "native-provider");
    await mkdir(stagedProvider, { recursive: true, mode: 0o700 });
    sandboxExecutable = join(stagedProvider, parse(executable).base);
    await copyFile(executable, sandboxExecutable, constants.COPYFILE_EXCL);
    if (!adapter.bridgeLauncher) command[0] = sandboxExecutable;
  }
  if (adapter.bridgeLauncher) {
    const stagedRuntime = join(tempDir, "native-runtime");
    await mkdir(stagedRuntime, { recursive: true, mode: 0o700 });
    const stagedNode = join(stagedRuntime, "node.exe");
    await copyFile(await realpath(process.execPath), stagedNode, constants.COPYFILE_EXCL);
    command[0] = stagedNode;
  }
  invariant(!/[.](?:bat|cmd)$/i.test(command[0]), "AO_WINDOWS_PROVIDER_SHIM_UNSUPPORTED", "Native Windows isolation requires a provider executable, not a batch or command shim.", { providerId, executable: command[0] });
  const providerHome = await prepareNativeProviderHome(adapter, controlDir);
  const environment = sandboxEnvironment({ adapter, providerExecutable: sandboxExecutable, command, providerHomeEnvironment: providerHome.environment, tempDir, permissionProfile });
  const readablePaths = [
    canonicalPluginRoot,
    gitFile,
    gitDir,
    protectedWindowsRoot(executable) ? null : dirname(executable),
    dirname(command[0]),
  ].filter(Boolean);
  const writablePaths = [tempDir];
  if (providerHome.root) writablePaths.push(providerHome.root);
  if (permissionProfile === "write") writablePaths.push(workspace);
  else readablePaths.push(workspace);
  const profileSuffix = `${process.pid}-${Date.now().toString(36)}`.replace(/[^a-z0-9-]/gi, "").slice(-32);
  return {
    helper: join(canonicalPluginRoot, "dist", "windows-native", "AgentOrchestration.Windows.dll"),
    config: {
      profileName: `ByteDesk.AO.${profileSuffix}`,
      // AppContainer process creation needs a writable current directory on
      // some Windows builds. ACP still receives the explicit workspace path,
      // whose ACL remains read-only for read profiles.
      workingDirectory: tempDir,
      readablePaths: [...new Set(readablePaths)],
      writablePaths: [...new Set(writablePaths)],
      protectedPaths: providerHome.bootstrapFiles,
      allowInternet: true,
      memoryBytes: 8 * 1024 * 1024 * 1024,
      processLimit: 512,
      runtimeMilliseconds: 8 * 60 * 60 * 1000,
    },
    command,
    environment,
    bootstrapFiles: providerHome.bootstrapFiles,
  };
}

async function runWindowsSandbox({ providerId, pluginRoot }) {
  const brokerControlDir = await mkdtemp(join(os.tmpdir(), `agent-orchestration-broker-${process.pid}-`));
  let child;
  const plan = await windowsSandboxPlan({
    providerId,
    pluginRoot,
    workspacePath: process.env.ao_sandbox_workspace,
    commonGitDir: process.env.ao_sandbox_common_git_dir,
    sandboxTempDir: process.env.ao_sandbox_temp_dir,
    brokerControlDir,
    providerExecutable: process.env.ao_provider_executable,
    permissionProfile: process.env.ao_sandbox_permission_profile,
  }).catch(async (error) => {
    await rm(brokerControlDir, { recursive: true, force: true });
    throw error;
  });
  const configPath = join(brokerControlDir, "appcontainer.json");
  await atomicWriteJson(configPath, plan.config);
  let bootstrapRevoked = false;
  const revokeBootstrap = async () => {
    if (bootstrapRevoked) return;
    await revokeBootstrapFiles(plan.bootstrapFiles);
    bootstrapRevoked = true;
  };
  try {
    const dotnet = join(process.env.ProgramFiles || "C:\\Program Files", "dotnet", "dotnet.exe");
    child = spawn(dotnet, [plan.helper, "sandbox", "--config", configPath, "--", ...plan.command], {
      stdio: ["pipe", "pipe", "pipe"],
      env: plan.environment,
      cwd: plan.config.workingDirectory,
      windowsHide: true,
      shell: false,
    });
    let stderrBytes = 0;
    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 8 * 1024 * 1024) {
        child.kill("SIGKILL");
        return;
      }
      if (!process.stderr.write(chunk)) {
        child.stderr.pause();
        process.stderr.once("drain", () => child.stderr.resume());
      }
    });
    const childOutcome = new Promise((resolveOutcome, rejectOutcome) => {
      child.once("error", rejectOutcome);
      child.once("exit", (code, signal) => resolveOutcome({ code, signal }));
    });
    const proxyDone = startAcpProxy(child, revokeBootstrap);
    const outcome = await childOutcome;
    await proxyDone;
    if (outcome.signal) process.kill(process.pid, outcome.signal);
    else process.exitCode = outcome.code ?? 1;
  } finally {
    child?.kill("SIGKILL");
    await revokeBootstrap();
    await rm(brokerControlDir, { recursive: true, force: true });
  }
}

async function readBubblewrapInfo(stream, timeoutMs = 10_000) {
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
      } catch {}
    });
    stream.once("end", finish);
    stream.once("error", rejectInfo);
  });
}

async function waitForNetworkReady(process, readyStream, timeoutMs = 10_000) {
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out configuring the provider network namespace.")), timeoutMs);
    timer.unref();
  });
  await Promise.race([
    once(readyStream, "data"),
    once(process, "exit").then(([code, signal]) => { throw new Error(`slirp4netns exited before readiness (exit=${code}, signal=${signal}).`); }),
    timeout,
  ]);
}

export function startAcpProxy(child, revokeBootstrap, { inputStream = process.stdin, outputStream = process.stdout } = {}) {
  const providerRequestIds = new Set();
  const establishmentMethods = new Set(["session/new", "session/load", "session/resume"]);
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
    if (!stream.write(`${line}\n`)) await once(stream, "drain");
  };
  const parseMessage = (line) => {
    try { return JSON.parse(line); } catch { return null; }
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
  const input = readline.createInterface({ input: inputStream, crlfDelay: Infinity });
  let inputChain = Promise.resolve();
  const processInputLine = async (line) => {
    const message = parseMessage(line);
    invariant(message && typeof message === "object", "AO_ACP_INVALID_FRAME", "ACP transport received a malformed JSON frame.");
    const isResponse = message.method === undefined
      && message.id !== undefined
      && ("result" in message || "error" in message);
    if (isResponse && providerRequestIds.delete(String(message.id))) {
      await writeLine(child.stdin, line);
      return;
    }
    if (message.id !== undefined && establishmentMethods.has(message.method)) {
      invariant(!["establishing", "bootstrap_pending", "bootstrap_running"].includes(sessionState), "AO_CONCURRENT_SESSION_ESTABLISHMENT", "Only one ACP session-establishment request may be active.");
      activeEstablishmentId = String(message.id);
      sessionState = "establishing";
      await writeLine(child.stdin, line);
      return;
    }
    if (message.method === "session/prompt") {
      if (sessionState === "pre_establishment") throw new AgentOrchestrationError("AO_SESSION_NOT_ESTABLISHED", "ACP prompt was rejected before session establishment.");
      if (sessionState === "bootstrap_pending") {
        invariant(message.id !== undefined && isBootstrapPrompt(message), "AO_AUTH_BOOTSTRAP_REQUIRED", "The first provider prompt must be the broker-authored authentication bootstrap.");
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
  input.once("close", () => { inputChain = inputChain.then(() => child.stdin.end()).catch(fail); });

  const output = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let outputChain = Promise.resolve();
  output.on("line", (line) => {
    output.pause();
    outputChain = outputChain.then(async () => {
      const message = parseMessage(line);
      invariant(message && typeof message === "object", "AO_ACP_INVALID_FRAME", "ACP provider emitted a malformed JSON frame.");
      if (message.method !== undefined && message.id !== undefined) {
        invariant(providerRequestIds.size < 1024, "AO_ACP_PROVIDER_REQUEST_LIMIT", "ACP provider exceeded the outstanding request limit.");
        providerRequestIds.add(String(message.id));
      }
      const isResponse = message?.method === undefined
        && message?.id !== undefined
        && ("result" in message || "error" in message);
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
        // Subscription CLIs (Claude Max) re-read the credential file on later
        // turns. Keep the broker-owned copy mounted until process teardown.
        // Failure paths still shred immediately. Host files are never the mount
        // source; teardown already deletes the broker copy.
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
  return once(output, "close").then(async () => {
    // The ACP parent waits for this wrapper to exit, while stdin can remain
    // open until that exit. Closing the reader when the provider is gone
    // prevents a circular wait and guarantees the systemd scope can drain.
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
  const pluginRoot = await realpath(fileURLToPath(new URL("..", import.meta.url)));
  if (process.platform === "win32") return runWindowsSandbox({ providerId, pluginRoot });
  for (const entry of await readdir("/dev/shm", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const match = /^agent-orchestration-broker-(\d+)-/.exec(entry.name);
    if (!match) continue;
    try { process.kill(Number(match[1]), 0); } catch (error) {
      if (error?.code === "ESRCH") await rm(join("/dev/shm", entry.name), { recursive: true, force: true });
    }
  }
  const brokerControlDir = await mkdtemp(join("/dev/shm", `agent-orchestration-broker-${process.pid}-`));
  let child;
  let network;
  let terminating = false;
  for (const [signal, exitCode] of [["SIGTERM", 143], ["SIGINT", 130], ["SIGHUP", 129]]) {
    process.once(signal, () => {
      if (terminating) return;
      terminating = true;
      child?.kill(signal);
      network?.kill(signal);
      rm(brokerControlDir, { recursive: true, force: true })
        .finally(() => process.exit(exitCode));
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
    permissionProfile: process.env.ao_sandbox_permission_profile,
  }).catch(async (error) => {
    await rm(brokerControlDir, { recursive: true, force: true });
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
    child = spawn("/usr/bin/bwrap", ["--info-fd", "3", "--block-fd", "4", ...plan.args], {
      stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
      env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
      shell: false,
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
    const wslHosted = process.env.AGENT_ORCHESTRATION_HOST_PLATFORM === "win32";
    if (wslHosted) {
      network = spawn("/usr/bin/pasta", [
        "--foreground", "--quiet", "--config-net", "--no-map-gw",
        "--tcp-ports", "none", "--udp-ports", "none",
        String(info["child-pid"]),
      ], {
        stdio: ["ignore", "ignore", "inherit"],
        env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
        shell: false,
      });
      await Promise.race([
        new Promise((resolveReady) => setTimeout(resolveReady, 500)),
        once(network, "exit").then(([code, signal]) => { throw new Error(`pasta exited before readiness (exit=${code}, signal=${signal}).`); }),
      ]);
    } else {
      network = spawn("/usr/bin/slirp4netns", [
        "--configure", "--mtu=65520", "--disable-host-loopback",
        "--enable-sandbox", "--ready-fd=3", "--exit-fd=4",
        String(info["child-pid"]), "tap0",
      ], {
        stdio: ["ignore", "ignore", "inherit", "pipe", "pipe"],
        env: { PATH: "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8" },
        shell: false,
      });
      await waitForNetworkReady(network, network.stdio[3]);
    }
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
      await Promise.race([once(network, "exit"), new Promise((resolveExit) => setTimeout(resolveExit, 1_000))]);
      if (network.exitCode === null) network.kill("SIGTERM");
    }
    await revokeBootstrap();
    await rm(brokerControlDir, { recursive: true, force: true });
  }
  if (outcome.signal) process.kill(process.pid, outcome.signal);
  else process.exitCode = outcome.code ?? 1;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`[agent-orchestration-sandbox] ${JSON.stringify(serializeError(error))}\n`);
    process.exitCode = 1;
  });
}

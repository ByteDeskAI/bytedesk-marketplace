// TM-272: the managed services. Every service-manager command goes through a fake systemctl,
// launchctl or schtasks on PATH that appends its argv to a file, and the tests assert on those
// recorded lists. Nothing here registers a real unit, LaunchAgent or task, and nothing touches tmux.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { renderRegistration, register, start, unregister, UNIT_NAME, LAUNCHD_LABEL, TASK_NAME } from "../../src/services/os-registration.mjs";
import { ensureServices, installProcessCompose, readLock, renderProject, servicePaths, apiClient } from "../../src/services/services.mjs";
import { startSessionHost, leasePath } from "../../src/session/host.mjs";

const run = promisify(execFile);
const pluginRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// The path that broke quoting in practice, plus `$` and `%`, which systemd and process-compose expand.
const SPACED = "/home/user/Documents/bytedesk-marketplace (copy)/$HOME 100%";

async function scratch(t, prefix) {
  const root = await mkdtemp(join(os.tmpdir(), prefix));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** Fake service-manager binaries on PATH. Each appends `{cmd, argv}` as one JSON line. */
async function fakeManagers(root) {
  const bin = join(root, "fake-bin");
  const log = join(root, "argv.jsonl");
  await mkdir(bin, { recursive: true });
  for (const name of ["systemctl", "launchctl", "schtasks", "process-compose"]) {
    await writeFile(join(bin, name), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cmd: ${JSON.stringify(name)}, argv: process.argv.slice(2) }) + '\\n');\n`);
    await chmod(join(bin, name), 0o755);
  }
  const cmdFor = { systemd: "systemctl", launchd: "launchctl", schtasks: "schtasks" };
  const runFake = (mode, args) => run(cmdFor[mode], args, { env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  const recorded = async () => (await readFile(log, "utf8").catch(() => "")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { bin, log, runFake, recorded };
}

test("systemd unit quotes a path with spaces, parentheses, $ and %", () => {
  const argv = [`${SPACED}/bin/process-compose`, "up", "-f", `${SPACED}/services/process-compose.yaml`, "-t=false"];
  const unit = renderRegistration({ mode: "systemd", argv, logPath: "/x", path: "/usr/bin:/bin" });
  const execStart = unit.split("\n").find((line) => line.startsWith("ExecStart="));
  assert.equal(execStart,
    'ExecStart="/home/user/Documents/bytedesk-marketplace (copy)/$$HOME 100%%/bin/process-compose" "up" "-f" "/home/user/Documents/bytedesk-marketplace (copy)/$$HOME 100%%/services/process-compose.yaml" "-t=false"');
  for (const line of ["Restart=always", "RestartSec=2", "WantedBy=default.target", 'Environment="PATH=/usr/bin:/bin"']) assert.ok(unit.includes(line), line);
});

test("launchd plist keeps each argument as its own escaped string", () => {
  const argv = [`${SPACED}/process-compose`, "-L", "/tmp/a&b<c>.log"];
  const plist = renderRegistration({ mode: "launchd", argv, logPath: `${SPACED}/pc.log` });
  const strings = [...plist.matchAll(/^ {4}<string>(.*)<\/string>$/gm)].map((match) => match[1]);
  assert.equal(strings.length, argv.length, "every argv entry is one <string>");
  assert.deepEqual(strings, [`${SPACED}/process-compose`, "-L", "/tmp/a&amp;b&lt;c&gt;.log"]);
  for (const key of ["<key>RunAtLoad</key><true/>", "<key>KeepAlive</key><true/>", "<key>ThrottleInterval</key>", `<string>${LAUNCHD_LABEL}</string>`]) assert.ok(plist.includes(key), key);
});

test("scheduled task: logon trigger, restart on failure, no time limit, quoted arguments", () => {
  const argv = ["C:\\Users\\Jo Smith\\AppData\\Local\\ByteDesk\\bin\\process-compose.exe", "up", "-f", "C:\\Users\\Jo Smith\\repo (copy)\\pc.yaml"];
  const task = renderRegistration({ mode: "schtasks", argv, logPath: "x" });
  assert.match(task, /<LogonTrigger><Enabled>true<\/Enabled><\/LogonTrigger>/);
  assert.match(task, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
  assert.match(task, /<RestartOnFailure><Interval>PT1M<\/Interval><Count>999<\/Count><\/RestartOnFailure>/);
  assert.match(task, /<Command>C:\\Users\\Jo Smith\\AppData\\Local\\ByteDesk\\bin\\process-compose.exe<\/Command>/);
  assert.match(task, /<Arguments>up -f &quot;C:\\Users\\Jo Smith\\repo \(copy\)\\pc.yaml&quot;<\/Arguments>/);
});

test("project: argv entrypoints survive the spaced path, and the node -e probe receives exact argv", async (t) => {
  const root = await scratch(t, "ao-services-probe-");
  const dir = join(root, "data (copy)");
  await mkdir(dir);
  const launcher = join(dir, "launcher.cjs");
  // A launcher that reports the argv it was given, exactly as the real one would receive it.
  await writeFile(launcher, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
  const stateRoot = join(root, "state $HOME (copy)");
  const { project } = renderProject({ platform: "linux", node: process.execPath, launcher, stateRoot, logs: join(root, "logs"),
    repos: [{ key: "abc", consumer: "/repo/bytedesk-marketplace (copy)" }] });
  assert.deepEqual(project.processes["session-host"].entrypoint, [process.execPath, launcher, "session-host", "--state-root", stateRoot]);
  assert.deepEqual(project.processes["supervise-abc"].entrypoint, [process.execPath, launcher, "ao-topology", "supervise", "--consumer", "/repo/bytedesk-marketplace (copy)"]);
  assert.equal(project.disable_env_expansion, true);
  assert.deepEqual(project.shell, { shell_command: process.execPath, shell_argument: "-e" });
  const { stdout } = await run(project.shell.shell_command, [project.shell.shell_argument, project.processes["session-host"].readiness_probe.exec.command]);
  assert.deepEqual(JSON.parse(stdout), ["services", "probe", "session-host", "--state-root", stateRoot]);
});

test("platform guards: nats only when prepared, supervise only off native Windows", () => {
  const base = { node: "/n", launcher: "/l", stateRoot: "/s", logs: "/logs", repos: [{ key: "k1", consumer: "/r (copy)" }, { key: "k2", consumer: "/q" }] };
  const nats = { bin: "/usr/bin/nats-server", args: ["-c", "/c"], log: "/n.log" };
  const cases = [
    { platform: "linux", nats, expect: ["session-host", "nats", "supervise-k1", "supervise-k2"], unsupported: 0 },
    { platform: "darwin", nats: null, expect: ["session-host", "supervise-k1", "supervise-k2"], unsupported: 0 },
    { platform: "win32", nats, expect: ["session-host", "nats"], unsupported: 2 },
    { platform: "win32", nats: null, expect: ["session-host"], unsupported: 2 },
  ];
  assert.equal(cases.length, 4);
  for (const { platform, nats: n, expect, unsupported } of cases) {
    const rendered = renderProject({ ...base, platform, nats: n });
    assert.deepEqual(Object.keys(rendered.project.processes), expect, platform);
    assert.equal(rendered.unsupported.length, unsupported, platform);
  }
  assert.deepEqual(renderProject({ ...base, platform: "linux", nats }).project.processes.nats.entrypoint, ["/usr/bin/nats-server", "-c", "/c"]);
});

/** A fake process-compose API: records every request; answers /live once `started` is true. */
function fakeApi() {
  const calls = [];
  const state = { started: false };
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url);
    calls.push(`${init.method ?? "GET"} ${pathname}`);
    if (pathname === "/live" && !state.started) throw new Error("ECONNREFUSED");
    return { ok: true, status: 200, json: async () => (pathname === "/processes" ? { data: [] } : {}) };
  };
  return { calls, state, fetchImpl };
}

async function snapshotTree(...roots) {
  const out = new Map();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else { const info = await stat(path); out.set(path, `${info.mtimeMs}:${info.size}`); }
    }
  };
  for (const root of roots) await walk(root);
  return out;
}

test("ensure is idempotent: the second run writes nothing, reloads nothing, starts nothing", async (t) => {
  const root = await scratch(t, "ao-services-ensure-");
  const home = join(root, "home"), stateRoot = join(root, "state (copy)"), data = join(root, "data");
  const managers = await fakeManagers(root);
  const api = fakeApi();
  const binary = join(data, "bin", "process-compose");
  const deps = {
    mode: "systemd",
    install: async () => ({ binary, installed: false }),
    prepareNats: async () => null,
    fetchImpl: api.fetchImpl,
    run: async (mode, args) => { const result = await managers.runFake(mode, args); if (args.includes("start")) api.state.started = true; return result; },
  };
  const env = { AGENT_ORCHESTRATION_DATA_HOME: data, XDG_CONFIG_HOME: join(home, ".config") };
  const first = await ensureServices({ pluginRoot, stateRoot, env, home, platform: "linux", deps });
  assert.deepEqual(first.actions, ["started"]);
  const afterFirst = await managers.recorded();
  assert.ok(afterFirst.length >= 3, `expected daemon-reload, enable and start, recorded ${afterFirst.length}`);
  assert.deepEqual(afterFirst.map((entry) => entry.argv), [
    ["--user", "daemon-reload"], ["--user", "enable", UNIT_NAME], ["--user", "start", UNIT_NAME],
  ]);
  const unit = await readFile(join(home, ".config", "systemd", "user", UNIT_NAME), "utf8");
  assert.ok(unit.includes(`"${binary}" "up" "-f" "${stateRoot}/services/process-compose.yaml"`), unit);

  const filesBefore = await snapshotTree(stateRoot, data, home);
  assert.ok(filesBefore.size >= 6, `expected the project, manager, token, pointer, launcher and unit; saw ${filesBefore.size}`);
  const callsBefore = api.calls.length;
  const second = await ensureServices({ pluginRoot, stateRoot, env, home, platform: "linux", deps });
  assert.deepEqual(second.actions, []);
  assert.deepEqual(Object.values(second.changed), [false, false, false, false, false]);
  assert.equal((await managers.recorded()).length, afterFirst.length, "no systemctl call on the second run");
  assert.deepEqual(api.calls.slice(callsBefore), ["GET /live"], "only a liveness check, no reload, no restart");
  const filesAfter = await snapshotTree(stateRoot, data, home);
  const rewritten = [...filesAfter].filter(([path, sig]) => filesBefore.get(path) !== sig && !path.endsWith(".lock") && !path.includes(".lock/"));
  assert.deepEqual(rewritten, [], "no file rewritten");

  // A plugin update moves only the pointer: every process restarts, the project is not rewritten.
  const moved = join(root, "cache", "agent-orchestration", "0123456789ab");
  const third = await ensureServices({ pluginRoot: moved, stateRoot, env, home, platform: "linux", deps: { ...deps, lock: readLock(pluginRoot) } });
  assert.equal(third.changed.pointer, true);
  assert.equal(third.changed.project, false);
  assert.deepEqual(api.calls.filter((call) => call.startsWith("POST")), ["POST /process/restart/session-host"]);
  assert.equal(JSON.parse(await readFile(servicePaths({ stateRoot, data }).pointer, "utf8")).sha, "0123456789ab");
});

test("ensure leaves nats out when AO_NATS_URL is set, and hot-reloads a changed project", async (t) => {
  const root = await scratch(t, "ao-services-nats-");
  const stateRoot = join(root, "state"), data = join(root, "data");
  const api = fakeApi();
  let prepared = 0, spawned = 0;
  const deps = { mode: "detached", install: async () => ({ binary: "/pc", installed: false }), fetchImpl: api.fetchImpl,
    spawnDetached: () => { spawned += 1; api.state.started = true; },
    prepareNats: async () => { prepared += 1; return { bin: "/usr/bin/nats-server", args: ["-c", "/c"], log: "/n.log" }; } };
  const base = { pluginRoot, stateRoot, home: root, platform: "linux", deps };
  const withUrl = await ensureServices({ ...base, env: { AGENT_ORCHESTRATION_DATA_HOME: data, AO_NATS_URL: "nats://elsewhere:4222" } });
  assert.equal(prepared, 0);
  assert.deepEqual(withUrl.processes, ["session-host"]);
  assert.deepEqual(withUrl.actions, ["started"]);
  const without = await ensureServices({ ...base, env: { AGENT_ORCHESTRATION_DATA_HOME: data } });
  assert.equal(prepared, 1);
  assert.deepEqual(without.processes, ["session-host", "nats"]);
  assert.deepEqual(without.actions, ["reloaded"]);
  assert.equal(spawned, 1, "the second ensure reloads the running manager instead of starting another");
  assert.ok(api.calls.includes("POST /project/configuration"));
});

test("launchd and Task Scheduler registration run exactly these commands", async (t) => {
  const root = await scratch(t, "ao-services-reg-");
  const managers = await fakeManagers(root);
  const argv = ["/pc", "up"];
  await register({ mode: "launchd", argv, logPath: "/l", home: root, env: {}, servicesDir: root, run: managers.runFake, uid: 501 });
  await start({ mode: "launchd", run: managers.runFake, uid: 501 });
  await register({ mode: "schtasks", argv, logPath: "/l", home: root, env: {}, servicesDir: root, run: managers.runFake });
  // schtasks reads UTF-16; the BOM is what tells it so.
  assert.deepEqual([...(await readFile(join(root, "agent-orchestration.task.xml"))).subarray(0, 2)], [0xff, 0xfe]);
  await start({ mode: "schtasks", run: managers.runFake });
  await unregister({ mode: "schtasks", home: root, env: {}, servicesDir: root, run: managers.runFake });
  const recorded = await managers.recorded();
  const plist = join(root, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
  const xml = join(root, "agent-orchestration.task.xml");
  const expected = [
    { cmd: "launchctl", argv: ["bootout", `gui/501/${LAUNCHD_LABEL}`] },
    { cmd: "launchctl", argv: ["bootstrap", "gui/501", plist] },
    { cmd: "launchctl", argv: ["kickstart", `gui/501/${LAUNCHD_LABEL}`] },
    { cmd: "schtasks", argv: ["/Create", "/XML", xml, "/TN", TASK_NAME, "/F"] },
    { cmd: "schtasks", argv: ["/Run", "/TN", TASK_NAME] },
    { cmd: "schtasks", argv: ["/End", "/TN", TASK_NAME] },
    { cmd: "schtasks", argv: ["/Delete", "/TN", TASK_NAME, "/F"] },
  ];
  assert.equal(recorded.length, expected.length);
  assert.deepEqual(recorded, expected);
  assert.match(await readFile(plist, "utf8"), /^<\?xml/);
});

test("a download whose SHA-256 does not match the lock is refused and nothing is installed", async (t) => {
  const data = await scratch(t, "ao-services-sha-");
  const lock = readLock(pluginRoot);
  const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from("not the pinned archive") });
  await assert.rejects(installProcessCompose({ data, platform: "linux", arch: "x64", lock, fetchImpl, extract: () => assert.fail("must not extract") }),
    (error) => error.code === "AO_SERVICES_CHECKSUM_MISMATCH" && error.details.expected === lock.assets["linux-x64"].sha256);
  assert.deepEqual(await readdir(join(data, "bin")).catch(() => []), [], "no binary and no staging left behind");
  // The same flow with bytes that DO match installs, so the refusal above is the hash and not the plumbing.
  const archiveRoot = join(data, "src");
  await mkdir(archiveRoot);
  await writeFile(join(archiveRoot, "process-compose"), "#!/bin/sh\n");
  await run("tar", ["-czf", join(data, "a.tar.gz"), "-C", archiveRoot, "process-compose"]);
  const bytes = await readFile(join(data, "a.tar.gz"));
  const matching = { ...lock, assets: { "linux-x64": { file: "a.tar.gz", sha256: createHash("sha256").update(bytes).digest("hex") } } };
  const installed = await installProcessCompose({ data, platform: "linux", arch: "x64", lock: matching, fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }) });
  assert.equal(installed.installed, true);
  assert.equal((await stat(installed.binary)).mode & 0o111, 0o111);
});

test("a second hand-run session-host exits 0 and leaves lease.json untouched", async (t) => {
  const root = await scratch(t, "ao-services-host-");
  const stateRoot = join(root, "state");
  const host = await startSessionHost({ stateRoot, uiRoot: join(pluginRoot, "session-ui", "mockup") });
  t.after(() => host.close());
  host.server.ref();
  const before = await readFile(leasePath(stateRoot));
  const beforeStat = await stat(leasePath(stateRoot));
  const child = spawn(process.execPath, [join(pluginRoot, "dist", "cli.cjs"), "session-host", "--state-root", stateRoot], {
    env: { ...process.env, AGENT_ORCHESTRATION_STATE_HOME: stateRoot }, stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const code = await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve("timeout"); }, 20_000)),
  ]);
  assert.equal(code, 0, stderr);
  assert.match(stderr, /already running/);
  assert.deepEqual(await readFile(leasePath(stateRoot)), before);
  assert.equal((await stat(leasePath(stateRoot))).mtimeMs, beforeStat.mtimeMs);
});

async function freePort() {
  return new Promise((resolve) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
}

test("integration: the real process-compose restarts a killed child within 5s", { timeout: 120_000 }, async (t) => {
  const root = await scratch(t, "ao-services-real (copy) ");
  let binary;
  try { ({ binary } = await installProcessCompose({ data: join(root, "data"), lock: readLock(pluginRoot) })); }
  catch (error) { return t.skip(`pinned process-compose unavailable: ${error.code ?? error.message}`); }
  // A launcher stand-in: probes succeed, everything else is a trivial long-running child. The
  // project is the one renderProject generates, so its schema is checked by the real binary too.
  const launcher = join(root, "launcher.cjs");
  await writeFile(launcher, "if (process.argv.includes('probe')) process.exit(0); setInterval(() => {}, 1000);\n");
  const logs = join(root, "logs");
  await mkdir(logs);
  const { project } = renderProject({ platform: process.platform, node: process.execPath, launcher, stateRoot: join(root, "state"), logs });
  const projectPath = join(root, "process-compose.yaml");
  await writeFile(projectPath, JSON.stringify(project, null, 2));
  const token = join(root, "token");
  await writeFile(token, "integration-token-0123456789", { mode: 0o600 });
  const port = await freePort();
  const pc = spawn(binary, ["up", "-f", projectPath, "-t=false", "--keep-project", "--disable-dotenv", "--address", "127.0.0.1", "-p", String(port), "--token-file", token, "-L", join(logs, "pc.log")],
    { stdio: "ignore", env: { ...process.env, TMUX: "" } });
  t.after(() => { try { pc.kill("SIGKILL"); } catch { /* already gone */ } });
  const client = apiClient({ port, token: "integration-token-0123456789" });
  const until = async (check, ms) => { const end = Date.now() + ms; for (;;) { const value = await check(); if (value || Date.now() > end) return value; await new Promise((r) => setTimeout(r, 100)); } };
  assert.ok(await until(() => client.alive(), 15_000), "process-compose answers");
  const host = () => client.processes().then((list) => list.find((p) => p.name === "session-host"));
  const first = await until(async () => { const p = await host(); return p?.status === "Running" && p.pid > 0 ? p : null; }, 15_000);
  assert.ok(first, "session-host is running");
  process.kill(first.pid, "SIGKILL");
  const killedAt = Date.now();
  const second = await until(async () => { const p = await host(); return p?.status === "Running" && p.pid > 0 && p.pid !== first.pid ? p : null; }, 5_000);
  assert.ok(second, `a new pid within 5s of killing ${first.pid}`);
  t.diagnostic(`killed ${first.pid}, new pid ${second.pid} after ${Date.now() - killedAt}ms, restarts=${second.restarts}`);
  await client.stop();
  assert.ok(await until(async () => !(await client.alive()), 10_000), "process-compose stopped through its API");
  const exited = await until(() => pc.exitCode !== null || pc.signalCode !== null, 5_000);
  assert.ok(exited, "process-compose exited");
});

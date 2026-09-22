import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, readlink } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { promisify } from "node:util";
import test from "node:test";
import { linuxNetworkCommand } from "../../src/platform/linux-network.mjs";

const execute = promisify(execFile);
const env = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8" };
const sandboxArgs = ["--unshare-all", "--die-with-parent", "--new-session", "--ro-bind", "/", "/", "--proc", "/proc", "--dev", "/dev", "--clearenv", "--setenv", "PATH", "/usr/bin:/bin"];
const inspectNestedNamespace = String.raw`
import fcntl, json, os, sys, time
pid, expected = map(int, sys.argv[1:])
net = os.open("/proc/%d/ns/net" % pid, os.O_RDONLY)
assert os.fstat(net).st_ino == expected, "owned netns identity changed"
owner = fcntl.ioctl(net, 0xb701)
owner_inode = os.fstat(owner).st_ino
deadline = time.monotonic() + 3
while time.monotonic() < deadline:
    current = os.stat("/proc/%d/ns/user" % pid).st_ino
    if current != owner_inode:
        print(json.dumps({"currentUserNamespace": current, "ownerUserNamespace": owner_inode, "networkNamespace": expected}))
        break
    time.sleep(.01)
else:
    raise RuntimeError("Bubblewrap did not reach its nested user namespace")
`;
const workload = String.raw`
import json, os, socket, sys
status = dict(line.split(":", 1) for line in open("/proc/self/status") if ":" in line)
blocked = False
try:
    connection = socket.create_connection(("10.0.2.2", int(sys.argv[1])), timeout=1)
    connection.close()
except OSError:
    blocked = True
print(json.dumps({"capEff": status["CapEff"].strip(), "profile": open("/proc/self/attr/current").read().strip(),
    "userNamespace": os.stat("/proc/self/ns/user").st_ino, "networkNamespace": os.stat("/proc/self/ns/net").st_ino,
    "loopbackBlocked": blocked, "tapConfigured": "tap0" in open("/proc/net/route").read()}))
`;

async function bounded(promise, milliseconds, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]); }
  finally { clearTimeout(timer); }
}

function launch(command, args, stdio = ["ignore", "pipe", "pipe", "pipe", "pipe"]) {
  const child = spawn(command, args, { stdio, env, shell: false });
  const record = { child, stdout: "", stderr: "" };
  child.stdout?.on("data", chunk => { record.stdout = (record.stdout + chunk).slice(-8192); });
  child.stderr.on("data", chunk => { record.stderr = (record.stderr + chunk).slice(-8192); });
  record.closed = new Promise(resolve => {
    child.once("error", error => resolve({ error: error.message }));
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return record;
}

async function stop(record) {
  record.child.stdio[4]?.end();
  if (record.child.exitCode === null && record.child.signalCode === null) {
    try { await bounded(record.closed, 1000, "waiting for owned process exit"); }
    catch { record.child.kill("SIGTERM"); }
  }
  try { await bounded(record.closed, 1000, "waiting for owned process termination"); }
  catch { record.child.kill("SIGKILL"); await bounded(record.closed, 1000, "owned process survived SIGKILL"); }
  assert.ok(record.child.exitCode !== null || record.child.signalCode !== null, "owned launcher must terminate");
}

async function fixture(t, port, callback) {
  const sandbox = launch("/usr/bin/bwrap", ["--info-fd", "3", "--block-fd", "4", ...sandboxArgs, "--", "/usr/bin/python3", "-I", "-c", workload, String(port)]);
  const networks = [];
  let info;
  let childStart;
  try {
    const payload = await bounded(Promise.race([
      new Promise((resolve, reject) => {
        let body = "";
        sandbox.child.stdio[3].on("data", chunk => { body += chunk; });
        sandbox.child.stdio[3].once("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
      }),
      sandbox.closed.then(outcome => { throw new Error(`Bubblewrap exited before its namespace record: ${JSON.stringify(outcome)} ${sandbox.stderr}`); }),
    ]), 5000, "Bubblewrap did not report its namespace");
    info = payload;
    childStart = (await readFile(`/proc/${info["child-pid"]}/stat`, "utf8")).split(") ")[1].split(" ")[19];
    const { stdout } = await execute("/usr/bin/python3", ["-I", "-c", inspectNestedNamespace, String(info["child-pid"]), String(info["net-namespace"])], { env, timeout: 5000 });
    const observed = JSON.parse(stdout);
    assert.notEqual(observed.currentUserNamespace, observed.ownerUserNamespace, "the regression must wait until the real ownership mismatch exists");
    t.diagnostic(`delayed attachment: net=${observed.networkNamespace}, current-user=${observed.currentUserNamespace}, owner-user=${observed.ownerUserNamespace}`);
    await callback({ sandbox, info, observed, network(command, args) { const record = launch(command, args); networks.push(record); return record; } });
  } finally {
    // Kill only the exact inner child reported by this owned bwrap process.
    // Let the monitor reap it before falling back to launcher termination.
    if (info && childStart) {
      const current = await readFile(`/proc/${info["child-pid"]}/stat`, "utf8").catch(() => null);
      if (current?.split(") ")[1].split(" ")[19] === childStart) {
        try { process.kill(info["child-pid"], "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
    await Promise.all(networks.map(stop));
    await stop(sandbox);
    if (info) {
      const deadline = Date.now() + 2000;
      let remaining;
      do {
        remaining = await readFile(`/proc/${info["child-pid"]}/stat`, "utf8").catch(() => null);
        if (!remaining || remaining.split(") ")[1].split(" ")[19] !== childStart) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      assert.ok(!remaining || remaining.split(") ")[1].split(" ")[19] !== childStart, `owned Bubblewrap child ${info["child-pid"]} was not reaped`);
    }
  }
}

test("Linux networking attaches to the pinned owner after Bubblewrap changes user namespace", { skip: process.platform !== "linux", timeout: 30_000 }, async t => {
  assert.notEqual(process.getuid(), 0, "this contract needs the unprivileged production launch path");
  const server = createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  try {
    const direct = createConnection({ host: "127.0.0.1", port });
    await once(direct, "connect"); direct.destroy();
    const baseline = await execute("/usr/bin/bwrap", [...sandboxArgs, "--", "/usr/bin/python3", "-I", "-c", 'print(open("/proc/self/attr/current").read().strip())'], { env, timeout: 5000 });

    await t.test("old PID-based attachment fails once the nested namespace exists", async () => fixture(t, port, async ({ sandbox, info, network }) => {
      const legacy = network("/usr/bin/slirp4netns", ["--configure", "--mtu=65520", "--disable-host-loopback", "--enable-sandbox", "--ready-fd=3", "--exit-fd=4", String(info["child-pid"]), "tap0"]);
      const outcome = await bounded(legacy.closed, 5000, "legacy attachment did not terminate");
      assert.equal(outcome.code, 1, legacy.stderr);
      assert.match(legacy.stderr, /setns\(CLONE_NEWNET\): Operation not permitted/);
      assert.equal(sandbox.stdout, "", "workload remains blocked after failed attachment");
    }));

    await t.test("pinned owner attachment retains isolation and host-loopback denial", async () => fixture(t, port, async ({ sandbox, info, observed, network }) => {
      const command = linuxNetworkCommand(info);
      const helper = network(command.executable, command.args);
      await bounded(Promise.race([
        once(helper.child.stdio[3], "data"),
        helper.closed.then(outcome => { throw new Error(`Owner attachment failed: ${JSON.stringify(outcome)} ${helper.stderr}`); }),
      ]), 5000, "network helper did not acknowledge readiness");
      assert.equal(await readlink(`/proc/${helper.child.pid}/ns/user`), `user:[${observed.ownerUserNamespace}]`, "helper must enter the kernel-reported owner");
      assert.equal(await readlink(`/proc/${helper.child.pid}/ns/net`), await readlink("/proc/self/ns/net"), "only the network helper keeps outbound host networking");
      assert.notEqual(await readlink(`/proc/${helper.child.pid}/ns/mnt`), await readlink("/proc/self/ns/mnt"), "slirp --enable-sandbox still creates its separate mount namespace");
      sandbox.child.stdio[4].end("1");
      const outcome = await bounded(sandbox.closed, 5000, "sandbox workload did not finish");
      assert.equal(outcome.code, 0, sandbox.stderr);
      const result = JSON.parse(sandbox.stdout);
      assert.equal(result.capEff, "0000000000000000");
      assert.equal(result.profile, baseline.stdout.trim(), "network repair must not change the provider's AppArmor confinement");
      assert.equal(result.userNamespace, observed.currentUserNamespace);
      assert.equal(result.networkNamespace, observed.networkNamespace);
      assert.equal(result.tapConfigured, true);
      assert.equal(result.loopbackBlocked, true, "sandbox must not reach the owned host-loopback listener through slirp");
    }));

    await t.test("wrong namespace inode fails before configuration and leaves the child blocked", async () => fixture(t, port, async ({ sandbox, info, network }) => {
      const command = linuxNetworkCommand({ ...info, "net-namespace": info["net-namespace"] + 1 });
      const helper = network(command.executable, command.args);
      const outcome = await bounded(helper.closed, 5000, "mismatched attachment did not terminate");
      assert.equal(outcome.code, 1);
      assert.match(helper.stderr, /network namespace identity changed/);
      assert.doesNotMatch(helper.stderr, /sent tapfd/);
      assert.equal(sandbox.stdout, "");
    }));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

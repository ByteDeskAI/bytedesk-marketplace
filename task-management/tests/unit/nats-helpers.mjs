// Test harness for the NATS backend: a throwaway nats-server -js on a free port with its own store
// dir, ambient NATS env cleared. Uses the binary agent-orchestration manages, else PATH.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const NATS_BIN = [process.env.TM_TEST_NATS_SERVER, join(homedir(), ".cache/ao-orch/nats-server"), "nats-server"].find((b) => b && (b === "nats-server" || existsSync(b)));
for (const k of Object.keys(process.env)) if (/^NATS_/.test(k)) delete process.env[k];

// Every server and temp dir this process makes is registered, so a failing test, a dropped restart()
// handle, a stop() on an already-signalled process, or SIGTERM/SIGINT still ends with no server left.
// TM_TEST_TMP (set by run-tests.sh) is the per-run base dir its leak check greps for.
const BASE = process.env.TM_TEST_TMP || tmpdir();
const procs = new Set();
const dirs = new Set();
export const tmpDir = (prefix) => { const d = mkdtempSync(join(BASE, prefix)); dirs.add(d); return d; };
const reap = () => { for (const p of procs) try { p.kill("SIGKILL"); } catch {} for (const d of dirs) rmSync(d, { recursive: true, force: true }); };
process.on("exit", reap);
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { reap(); process.exit(128 + (sig === "SIGINT" ? 2 : 15)); });

export const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });

const up = (port) =>
  new Promise((res) => {
    const c = connect(port, "127.0.0.1");
    c.once("connect", () => (c.destroy(), res(true)));
    c.once("error", () => res(false));
  });

export async function startServer({ port, dir, args = [] } = {}) {
  port ??= await freePort();
  const own = !dir;
  dir ??= tmpDir("tm-nats-");
  const proc = spawn(NATS_BIN, ["-a", "127.0.0.1", "-p", String(port), "-js", "-sd", dir, ...args], { stdio: "ignore" });
  procs.add(proc);
  proc.unref(); // a test that dies without teardown must not keep node alive: the exit handler then reaps it
  for (let i = 0; i < 100 && !(await up(port)); i += 1) await new Promise((r) => setTimeout(r, 50));
  const stop = () => new Promise((res) => (proc.exitCode !== null || proc.signalCode !== null ? res() : (proc.ref(), proc.once("exit", res), proc.kill("SIGKILL"))));
  return { port, dir, url: `nats://127.0.0.1:${port}`, proc, stop, restart: async () => startServer({ port, dir, args }), cleanup: async () => (await stop(), own && rmSync(dir, { recursive: true, force: true })) };
}

/** A hub (JetStream domain "hub") and a leaf (domain "leaf") linked over a leafnode port, own store dirs. */
export async function startHubLeaf() {
  const work = tmpDir("tm-leaf-");
  const leafPort = await freePort();
  const hubConf = join(work, "hub.conf");
  writeFileSync(hubConf, `server_name: hub\njetstream { domain: hub }\nleafnodes { port: ${leafPort} }\n`);
  const hub = await startServer({ dir: join(work, "hub-js"), args: ["-c", hubConf] });
  const leafConf = join(work, "leaf.conf");
  writeFileSync(leafConf, `server_name: leaf\njetstream { domain: leaf }\nleafnodes { remotes [ { url: "nats://127.0.0.1:${leafPort}" } ] }\n`);
  const leaf = await startServer({ dir: join(work, "leaf-js"), args: ["-c", leafConf] });
  const net = { hub, leaf, work, cleanup: async () => { await net.leaf.cleanup(); await net.hub.cleanup(); rmSync(work, { recursive: true, force: true }); } }; // net.hub: a restart replaces it
  return net;
}

/**
 * Real operator-mode credentials via nsc: a server config that only admits users signed by the
 * operator, plus a good creds file, an expired one, and one from a different operator.
 */
export function makeCreds() {
  const work = tmpDir("tm-creds-");
  const nsc = (home, ...a) => execFileSync("nsc", a, { env: { ...process.env, NKEYS_PATH: join(home, "keys"), NSC_HOME: join(home, "home") }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const build = (name) => {
    const home = join(work, name);
    nsc(home, "env", "-s", join(home, "store"));
    nsc(home, "add", "operator", "--name", name, "--sys");
    nsc(home, "add", "account", "--name", "TM");
    nsc(home, "edit", "account", "--name", "TM", "--js-mem-storage", "-1", "--js-disk-storage", "-1", "--js-streams", "-1", "--js-consumer", "-1");
    nsc(home, "add", "user", "--name", "good", "--account", "TM");
    nsc(home, "add", "user", "--name", "old", "--account", "TM");
    nsc(home, "edit", "user", "--name", "old", "--account", "TM", "--expiry", "2020-01-01");
    const creds = (user) => { const f = join(home, `${user}.creds`); writeFileSync(f, nsc(home, "generate", "creds", "--account", "TM", "--name", user)); return f; };
    return { home, creds };
  };
  const real = build("real");
  const other = build("other");
  const conf = join(work, "server.conf");
  nsc(real.home, "generate", "config", "--mem-resolver", "--sys-account", "SYS", "--config-file", conf);
  return { work, conf, good: real.creds("good"), expired: real.creds("old"), stranger: other.creds("good"), cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

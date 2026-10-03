// Test harness for the NATS backend: a throwaway nats-server -js on a free port with its own store
// dir, ambient NATS env cleared. Uses the binary agent-orchestration manages, else PATH.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const NATS_BIN = [process.env.TM_TEST_NATS_SERVER, join(homedir(), ".cache/ao-orch/nats-server"), "nats-server"].find((b) => b && (b === "nats-server" || existsSync(b)));
for (const k of Object.keys(process.env)) if (/^NATS_/.test(k)) delete process.env[k];

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

export async function startServer({ port, dir } = {}) {
  port ??= await freePort();
  const own = !dir;
  dir ??= mkdtempSync(join(tmpdir(), "tm-nats-"));
  const proc = spawn(NATS_BIN, ["-a", "127.0.0.1", "-p", String(port), "-js", "-sd", dir], { stdio: "ignore" });
  for (let i = 0; i < 100 && !(await up(port)); i += 1) await new Promise((r) => setTimeout(r, 50));
  const stop = () => new Promise((res) => (proc.exitCode !== null ? res() : (proc.once("exit", res), proc.kill("SIGKILL"))));
  return { port, dir, url: `nats://127.0.0.1:${port}`, proc, stop, restart: async () => startServer({ port, dir }), cleanup: async () => (await stop(), own && rmSync(dir, { recursive: true, force: true })) };
}

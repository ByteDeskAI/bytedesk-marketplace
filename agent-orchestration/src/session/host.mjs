import { createServer } from "node:http";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { assertLoopbackBind } from "./capability.mjs";
import { createSessionHandler } from "./http.mjs";
import { atomicWriteJson, ensurePrivateDir, newId, processStartIdentity, readJson } from "../util.mjs";
import { invariant } from "../errors.mjs";

const BIND = "127.0.0.1";
const PORT_MIN = 45_000;
const PORT_MAX = 45_032;

export function sessionHostDir(stateRoot) {
  return join(stateRoot, "session-host");
}

export function leasePath(stateRoot) {
  return join(sessionHostDir(stateRoot), "lease.json");
}

export async function startSessionHost({ stateRoot, uiRoot, port: requestedPort = undefined, controls = undefined }) {
  assertLoopbackBind(BIND);
  await ensurePrivateDir(sessionHostDir(stateRoot));
  const hostNonce = newId("host");
  const preferred = await preferredPort(stateRoot, requestedPort);
  const { server, port } = await listenLoopback(preferred);
  const handle = createSessionHandler({ stateRoot, uiRoot, hostNonce, port, controls });
  server.on("request", (req, res) => {
    Promise.resolve(handle(req, res)).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: "AO_SESSION_INTERNAL", message: "Session host failed." }));
      }
    });
  });
  server.unref();
  const lease = {
    pid: process.pid,
    startIdentity: await processStartIdentity(process.pid),
    hostNonce,
    boundAt: new Date().toISOString(),
    bind: `${BIND}:${port}`,
    port,
  };
  await atomicWriteJson(leasePath(stateRoot), lease);
  await atomicWriteJson(join(sessionHostDir(stateRoot), "port.json"), { port });
  return {
    server,
    port,
    hostNonce,
    bind: `${BIND}:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.closeAllConnections?.();
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function preferredPort(stateRoot, requestedPort) {
  if (Number.isInteger(requestedPort) && requestedPort > 0) return requestedPort;
  const stored = await readJson(join(sessionHostDir(stateRoot), "port.json"), null);
  if (Number.isInteger(stored?.port) && stored.port >= PORT_MIN) return stored.port;
  return PORT_MIN;
}

async function listenLoopback(preferred) {
  const candidates = [preferred];
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    if (port !== preferred) candidates.push(port);
  }
  let lastError = null;
  for (const port of candidates) {
    try {
      const server = await bindPort(port);
      return { server, port: server.address().port };
    } catch (error) {
      lastError = error;
      if (error?.code !== "EADDRINUSE") throw error;
    }
  }
  invariant(false, "AO_SESSION_BIND", "No loopback port is available for the session host.", { lastError: lastError?.message });
}

function bindPort(port) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, BIND);
  });
}

export async function probeSessionHost(stateRoot) {
  const lease = await readJson(leasePath(stateRoot), null);
  if (!lease?.port || !lease.hostNonce) return null;
  if (await processStartIdentity(lease.pid) !== lease.startIdentity) return null;
  try {
    const response = await fetch(`http://127.0.0.1:${lease.port}/api/health`, {
      headers: { host: `127.0.0.1:${lease.port}` },
    });
    if (!response.ok) return null;
    const body = await response.json();
    if (body.hostNonce !== lease.hostNonce) return null;
    return lease;
  } catch {
    return null;
  }
}

export async function openSessionBrowser(url) {
  if (process.env.AGENT_ORCHESTRATION_OPEN_BROWSER === "0") return false;
  if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
  try {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true, shell: false }).unref();
    return true;
  } catch {
    return false;
  }
}

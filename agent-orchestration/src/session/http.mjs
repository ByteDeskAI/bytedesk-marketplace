import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { hashesEqual, isExpired, parseCookie, readSessionMeta, runPagePath, sessionCookie, writeSessionMeta } from "./capability.mjs";
import { readJson, sha256 } from "../util.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(res, status, body, headers = {}) {
  const isJson = typeof body === "object" && body !== null && !Buffer.isBuffer(body);
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "content-type": isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

function allowedHost(hostHeader, port) {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

function safeUiFile(uiRoot, urlPath) {
  const decoded = decodeURIComponent((urlPath.split("?")[0] || "/"));
  const relative = decoded === "/" || decoded.endsWith("/") ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = normalize(join(uiRoot, relative));
  if (!resolved.startsWith(uiRoot)) return null;
  return resolved;
}

export function createSessionHandler({ stateRoot, uiRoot, hostNonce, port }) {
  return async function handle(req, res) {
    if (!allowedHost(req.headers.host, port)) {
      send(res, 421, { code: "AO_SESSION_HOST", message: "Session host is loopback-only." });
      return;
    }
    const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
    const path = url.pathname;

    if (req.method === "GET" && path === "/api/health") {
      send(res, 200, { ok: true, hostNonce, bind: `127.0.0.1:${port}` });
      return;
    }

    const capMatch = path.match(/^\/s\/([^/]+)$/);
    if (req.method === "GET" && capMatch) {
      await exchangeCapability(stateRoot, capMatch[1], res);
      return;
    }

    const apiSnap = path.match(/^\/api\/runs\/(run_[0-9a-f-]{36})\/snapshot$/i);
    if (req.method === "GET" && apiSnap) {
      const runId = apiSnap[1];
      if (!await authorizeRun(stateRoot, runId, req)) {
        send(res, 401, { code: "AO_SESSION_UNAUTHORIZED", message: "Session cookie does not match this run." });
        return;
      }
      const snapshot = await readJson(join(stateRoot, "runs", runId, "snapshot.json"), null);
      if (!snapshot) {
        send(res, 404, { code: "AO_RUN_NOT_FOUND", message: "Run snapshot is missing." });
        return;
      }
      send(res, 200, publicSnapshot(snapshot));
      return;
    }

    const pageMatch = path.match(/^\/runs\/(run_[0-9a-f-]{36})(?:\/(.*))?$/i);
    if (req.method === "GET" && pageMatch) {
      const runId = pageMatch[1];
      const rest = pageMatch[2] || "";
      if (!await authorizeRun(stateRoot, runId, req)) {
        send(res, 401, { code: "AO_SESSION_UNAUTHORIZED", message: "Session cookie does not match this run." });
        return;
      }
      const file = rest ? safeUiFile(uiRoot, `/${rest}`) : safeUiFile(uiRoot, "/index.html");
      await streamUi(res, file);
      return;
    }

    if (req.method === "GET") {
      await streamUi(res, safeUiFile(uiRoot, path));
      return;
    }
    send(res, 404, { code: "AO_SESSION_NOT_FOUND", message: "Not found." });
  };
}

async function exchangeCapability(stateRoot, token, res) {
  const tokenHash = sha256(token);
  const dir = join(stateRoot, "runs");
  const names = await readdir(dir).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  let matched = null;
  for (const runId of names.filter((name) => RUN_ID.test(name))) {
    const meta = await readSessionMeta(stateRoot, runId);
    if (meta?.tokenHash && hashesEqual(meta.tokenHash, tokenHash)) {
      matched = { runId, meta };
      break;
    }
  }
  if (!matched || isExpired(matched.meta.expiresAt) || matched.meta.exchangedAt) {
    send(res, 404, { code: "AO_SESSION_CAPABILITY", message: "Session capability is missing, expired, or already used." });
    return;
  }
  await writeSessionMeta(stateRoot, matched.runId, { ...matched.meta, exchangedAt: new Date().toISOString() });
  res.writeHead(302, {
    location: runPagePath(matched.runId),
    "set-cookie": sessionCookie(token),
  });
  res.end();
}

async function authorizeRun(stateRoot, runId, req) {
  const token = parseCookie(req.headers.cookie);
  if (!token) return false;
  const meta = await readSessionMeta(stateRoot, runId);
  return Boolean(meta?.tokenHash && hashesEqual(meta.tokenHash, sha256(token)));
}

function publicSnapshot(snapshot) {
  const { worker, ...rest } = snapshot;
  return {
    ...rest,
    worker: worker ? { pid: worker.pid, supervisorUnit: worker.supervisorUnit, startedAt: worker.startedAt } : null,
  };
}

async function streamUi(res, file) {
  if (!file) {
    send(res, 403, { code: "AO_SESSION_FORBIDDEN", message: "Forbidden." });
    return;
  }
  const info = await lstat(file).catch(() => null);
  if (!info?.isFile()) {
    send(res, 404, { code: "AO_SESSION_NOT_FOUND", message: "Not found." });
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

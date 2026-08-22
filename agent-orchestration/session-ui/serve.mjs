#!/usr/bin/env node
/**
 * Loopback static server for the Agent Orchestration Session mockup.
 * Prints the session URL the same way the broker will: one stderr line, then xdg-open.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("./mockup/", import.meta.url));
const HOST = "127.0.0.1";
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = normalize(join(ROOT, relative));
  if (!resolved.startsWith(ROOT)) return null;
  return resolved;
}

const server = createServer(async (req, res) => {
  const file = safePath(req.url ?? "/");
  if (!file) {
    res.writeHead(403).end("forbidden");
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  }
});

const requested = Number(process.env.AGENT_ORCHESTRATION_SESSION_PORT || process.env.PORT || 0);
server.listen(requested, HOST, () => {
  const { port } = server.address();
  const url = `http://${HOST}:${port}/`;
  process.stderr.write(`Orchestration session: ${url}\n`);
  if (process.env.AO_SESSION_NO_OPEN !== "1") {
    spawn("xdg-open", [url], { stdio: "ignore", detached: true }).unref();
  }
});

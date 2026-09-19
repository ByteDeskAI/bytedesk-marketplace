import { randomBytes, timingSafeEqual } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { atomicWriteJson, readJson, sha256 } from "../util.mjs";
import { invariant } from "../errors.mjs";

export const SESSION_TTL_MS = 10 * 60 * 1000;
const COOKIE_NAME = "ao_session";

export function sessionMetaPath(stateRoot, runId) {
  return join(stateRoot, "runs", runId, "session.json");
}

export function mintCapability(now = Date.now()) {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  };
}

export function hashesEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/** True when runs/<runId> still holds a durable record, the same evidence RunStore.get reads. */
async function hasDurableRun(stateRoot, runId) {
  for (const name of ["snapshot.json", "events.ndjson"]) {
    if (await stat(join(stateRoot, "runs", runId, name)).then(() => true).catch(() => false)) return true;
  }
  return false;
}

export async function writeSessionMeta(stateRoot, runId, record) {
  // The write creates runs/<runId>/ for whatever id it is handed, so an unknown run would leave a
  // directory holding a session and no run — an orphan every later list() has to step around.
  invariant(await hasDurableRun(stateRoot, runId), "AO_RUN_NOT_FOUND", `Run ${runId} does not exist.`);
  await atomicWriteJson(sessionMetaPath(stateRoot, runId), record);
}

export async function readSessionMeta(stateRoot, runId) {
  return readJson(sessionMetaPath(stateRoot, runId), null);
}

export function capabilityUrl(port, token) {
  return `http://127.0.0.1:${port}/s/${token}`;
}

export function runPagePath(runId) {
  return `/runs/${runId}`;
}

export function parseCookie(header, name = COOKIE_NAME) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const [rawName, ...rest] = part.trim().split("=");
    if (rawName === name) return rest.join("=");
  }
  return null;
}

export function sessionCookie(token, maxAgeSeconds = 86_400) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export function isExpired(expiresAt, now = Date.now()) {
  const at = Date.parse(expiresAt);
  return !Number.isFinite(at) || at <= now;
}

export function assertLoopbackBind(address) {
  invariant(address === "127.0.0.1", "AO_SESSION_BIND", "The session host must bind 127.0.0.1 only.", { address });
}

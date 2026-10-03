/**
 * Backend selection. `file` (the markdown store) is the default until the NATS cutover is approved.
 * Precedence: TM_STORAGE env, then config.json `storage.backend`, then "file".
 * The NATS endpoint is TM_NATS_URL (+ TM_NATS_CREDS) only; ambient NATS_URL is never consulted.
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import "./types.mjs";
import { boardId, gitBoardId } from "../paths.mjs";
import { actor, actorLabel } from "../actor.mjs";
import { SyncBridge } from "./syncbridge.mjs";

const kinds = new Map(); // config path -> { stamp, kind }: this runs on every store read, so skip the parse unless config.json changed

export function storageKind(p) {
  if (p.forceFile) return "file"; // migrate reads the markdown source through this, whatever TM_STORAGE says
  const env = process.env.TM_STORAGE;
  if (env) return env;
  let stamp;
  try {
    const st = statSync(p.config);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return "file";
  }
  const hit = kinds.get(p.config);
  if (hit?.stamp === stamp) return hit.kind;
  let kind = "file";
  try {
    kind = JSON.parse(readFileSync(p.config, "utf8")).storage?.backend || "file";
  } catch { /* unreadable config: the default */ }
  kinds.set(p.config, { stamp, kind });
  return kind;
}

/** `storage.spillBytes` from config.json (env TM_SPILL_BYTES wins, inside the backend); undefined = the default. */
export function spillBytes(p) {
  try {
    return JSON.parse(readFileSync(p.config, "utf8")).storage?.spillBytes;
  } catch {
    return undefined;
  }
}

const key16 = (v) => createHash("sha256").update(String(v)).digest("hex").slice(0, 16);

/** The board's key: its origin remote (owner/name), so every clone shares one board. */
export const repoKey = (p) => key16(gitBoardId(p.root) || boardId(p.root));

/**
 * Older keys that may already hold this board: the path-based one (sha of the git common dir).
 * The backend resolves to the first key that has entities, primary first, so renaming the key
 * scheme never orphans a board that was created under the old one.
 */
export const repoAliases = (p) => [key16(join(p.root, ".git"))].filter((k) => k !== repoKey(p));

const bridges = new Map();

/** The synchronous handle to the NATS backend, or null when the file backend is selected. */
export function remote(p) {
  const kind = storageKind(p);
  if (kind === "file") return null;
  if (kind !== "nats") throw new Error(`unknown storage backend "${kind}" — use "file" or "nats"`);
  const key = p.base;
  if (!bridges.has(key)) {
    const repo = repoKey(p);
    const a = actor();
    bridges.set(
      key,
      new SyncBridge(
        {
          repo,
          aliases: repoAliases(p),
          domain: process.env.TM_NATS_DOMAIN,
          root: p.root,
          cacheDir: join(process.env.TM_CACHE_DIR || join(homedir(), ".cache", "task-management"), repo),
          actor: { actor: actorLabel(a), agent: a.name },
          url: process.env.TM_NATS_URL,
          creds: process.env.TM_NATS_CREDS,
          spillBytes: process.env.TM_SPILL_BYTES ? undefined : spillBytes(p),
        },
        { onNotice: (m, why) => process.stderr.write(`${m}${process.env.TM_DEBUG ? ` (${why})` : ""}\n`) },
      ),
    );
  }
  return bridges.get(key);
}

/** What `tm doctor` and `tm cutover` report: the active backend, its server, and whether it is reachable. */
export function storageInfo(p) {
  const kind = storageKind(p);
  if (kind === "file") return { kind, server: p.base, offline: false };
  const rb = remote(p);
  const info = rb.call("info");
  try {
    info.events = rb.call("eventCount"); // metadata only: doctor never pages the stream
  } catch { /* unreachable and no mirror */ }
  return info;
}

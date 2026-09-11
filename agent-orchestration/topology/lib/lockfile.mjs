// Atomic mkdir admission; destructive operations serialize inside the existing generation.
// Unknown ownership fails closed: elapsed time is never proof a provider has died.
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fail, nowIso, sleep } from "./util.mjs";

export async function processIdentity(pid) {
  try {
    const raw = await readFile(`/proc/${pid}/stat`, "utf8");
    const start = raw.slice(raw.lastIndexOf(")") + 2).split(" ")[19];
    const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
    return `${boot}:${start}`;
  } catch { return null; }
}
export async function lockOwner(path) {
  try { return JSON.parse(await readFile(join(path, "owner.json"), "utf8")); }
  catch { return null; }
}
async function dead(owner) {
  if (!owner?.token || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
  try { process.kill(owner.pid, 0); }
  catch (error) { return error.code === "ESRCH"; }
  const identity = await processIdentity(owner.pid);
  return Boolean(identity && owner.process_identity && identity !== owner.process_identity);
}

// A gate INSIDE the generation prevents two removers from renaming a successor. If a remover
// crashes holding this gate, fail closed; an operator must inspect it instead of guessing.
async function removeOwned(path, token) {
  const gate = join(path, ".remove");
  try { await mkdir(gate); }
  catch (error) { if (["EEXIST", "ENOENT"].includes(error.code)) return false; throw error; }
  let moved = false;
  try {
    if ((await lockOwner(path))?.token !== token) return false;
    const retired = `${path}.retired-${randomUUID()}`;
    await rename(path, retired);
    moved = true;
    await rm(retired, { recursive: true, force: true });
    return true;
  } finally {
    if (!moved) await rm(gate, { recursive: true, force: true });
  }
}

/** Run under exclusive ownership. hooks.afterMkdir is a deterministic test seam.
 * staleMs is accepted for compatibility, but age alone never permits reclamation.
 */
export async function withLock(lockPath, fn, { timeoutMs = 30_000, pollMs = 50, hooks = {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  await mkdir(dirname(lockPath), { recursive: true });
  for (;;) {
    let acquired = false;
    try { await mkdir(lockPath); acquired = true; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    if (acquired) {
      // If initialization fails, leave the unknown generation intact for operator inspection.
      await hooks.afterMkdir?.();
      await writeFile(join(lockPath, "owner.json"), JSON.stringify({ token, pid: process.pid,
        process_identity: await processIdentity(process.pid), created_at: nowIso() }), "utf8");
      break;
    }
    const owner = await lockOwner(lockPath);
    if (await dead(owner)) {
      await hooks.beforeReclaim?.(owner);
      await removeOwned(lockPath, owner.token);
    }
    if (Date.now() >= deadline) {
      fail("TOPOLOGY_LOCK_TIMEOUT", `Timed out after ${timeoutMs}ms waiting for ${lockPath}; owner ${JSON.stringify(owner)}. Ownership is live or unknown. Inspect the owner process and lock before manual recovery.`);
    }
    await sleep(Math.max(1, Math.min(deadline - Date.now(), pollMs * (0.75 + Math.random() * 0.5))));
  }
  const ownership = await lockOwner(lockPath);
  try { return await fn(ownership); }
  finally { await removeOwned(lockPath, token); }
}

/** Status only, never admission authority. */
export async function lockHeld(lockPath) {
  try { await stat(lockPath); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

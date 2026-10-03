// Atomic rename admission; destructive operations serialize inside the existing generation.
// Unknown ownership fails closed: elapsed time is never proof a provider has died.
//
// TM-307: admission used to be mkdir(lockPath) followed by an awaited owner.json write. A SIGKILL
// between the two left an EMPTY generation that nobody could ever reclaim, and every supervisor
// timed out against it for 5.5 hours. Now the owner record is written into a private
// `<lock>.pending-*` sibling first and the whole directory is renamed onto lockPath, so lockPath
// only ever appears already populated. This code can no longer create an ownerless lock.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
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

// A gate INSIDE the generation prevents two removers from renaming a successor. Gates are admitted
// like locks (owner record first, then rename), so a crashed remover leaves a gate whose owner is
// provably dead rather than an anonymous mkdir. A dead gate is never removed — removing it would race
// a live successor gate — the next remover instead takes the gate named after the dead one's token.
// Each link exists only once its predecessor's holder is dead, so at most one live remover holds a
// gate in a generation and the chain cannot wedge (TM-307: a SIGKILL between mkdir(.remove) and the
// rename used to block every reclaim of that generation forever).
async function removeOwned(path, token) {
  const gateToken = randomUUID();
  let gate = join(path, ".remove");
  try {
    for (;;) {
      if (await admit(gate, gateToken)) break;
      const holder = await lockOwner(gate);
      if (!holder || !(await dead(holder))) return false;   // live remover, or unknown: fail closed
      gate = join(path, `.remove-${holder.token}`);
    }
  } catch (error) { if (error.code === "ENOENT") return false; throw error; }   // generation gone
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

// A pending sibling is never authoritative: nothing reads it as a lock. Removing one only makes its
// creator's rename fail with ENOENT, and the creator then simply retries. Retire it by rename first
// so a rename-into-place that wins the race is never half-deleted. A `.retired-*` sibling was already
// renamed out of authority, so one a crashed remover left behind is always safe to delete.
const PENDING_STALE_MS = 10 * 60_000;
async function sweepPending(lockPath) {
  const dir = dirname(lockPath), prefix = `${basename(lockPath)}.pending-`, retiredPrefix = `${basename(lockPath)}.retired-`;
  for (const name of await readdir(dir).catch(() => [])) {
    const path = join(dir, name);
    if (name.startsWith(retiredPrefix)) { await rm(path, { recursive: true, force: true }).catch(() => {}); continue; }
    if (!name.startsWith(prefix)) continue;
    try {
      const owner = await lockOwner(path);
      const old = Date.now() - (await stat(path)).mtimeMs > PENDING_STALE_MS;
      if (!old && !(await dead(owner))) continue;
      const retired = `${lockPath}.retired-${randomUUID()}`;
      await rename(path, retired);
      await rm(retired, { recursive: true, force: true });
    } catch { /* gone, or raced by its creator: either way not ours to report */ }
  }
}

// Admission: returns true when lockPath now holds OUR owner record.
// ponytail: an old-version process (pre-TM-307, mkdir-then-write) that is mid-acquire holds lockPath
// as an empty directory; our rename replaces it and its later owner.json write lands in our
// generation, so both believe they hold. The ceiling is that old writer's mkdir→write gap
// (sub-millisecond) during a rollout window only; it closes once every ao process is restarted.
// An age heuristic would not narrow it and would break the "age is never proof" rule.
async function admit(lockPath, token, hooks = {}) {
  const pending = await mkdtemp(`${lockPath}.pending-`);
  try {
    await hooks.step?.("pending", pending);
    await writeFile(join(pending, "owner.json"), JSON.stringify({ token, pid: process.pid,
      process_identity: await processIdentity(process.pid), created_at: nowIso() }), "utf8");
    await hooks.step?.("owner", pending);
    try { await rename(pending, lockPath); }
    catch (error) {
      // EEXIST/ENOTEMPTY: populated generation (POSIX). EPERM/EACCES: win32 MoveFileEx refuses any
      // existing directory target. ENOENT: our pending was swept as stale; just retry.
      if (["EEXIST", "ENOTEMPTY", "EPERM", "EACCES", "ENOENT"].includes(error.code)) return false;
      throw error;
    }
    await hooks.step?.("renamed", lockPath);
    return true;
  } finally {
    await rm(pending, { recursive: true, force: true });
  }
}

/** Run under exclusive ownership. hooks.step(name, path) is a deterministic test seam called at
 * "pending", "owner" and "renamed"; hooks.beforeReclaim(owner) before a dead-owner reclaim.
 * staleMs is accepted for compatibility, but age alone never permits reclamation.
 */
export async function withLock(lockPath, fn, { timeoutMs = 30_000, pollMs = 50, hooks = {}, timeoutCode = "TOPOLOGY_LOCK_TIMEOUT" } = {}) {
  const deadline = Date.now() + timeoutMs;
  const token = randomUUID();
  await mkdir(dirname(lockPath), { recursive: true });
  let swept = false;
  for (;;) {
    if (await admit(lockPath, token, hooks)) break;
    if (!swept) { swept = true; await sweepPending(lockPath); }
    const owner = await lockOwner(lockPath);
    // POSIX rename(2) replaces a legacy EMPTY lockPath by itself. win32 cannot rename onto any
    // existing directory, so remove an empty one explicitly; rmdir refuses a populated generation.
    if (!owner && process.platform === "win32") await rmdir(lockPath).catch(() => {});
    if (await dead(owner)) {
      await hooks.beforeReclaim?.(owner);
      await removeOwned(lockPath, owner.token);
    }
    if (Date.now() >= deadline) {
      fail(timeoutCode, `Timed out after ${timeoutMs}ms waiting for ${lockPath}; owner ${JSON.stringify(owner)}. Ownership is live or unknown. Inspect the owner process and lock before manual recovery.`);
    }
    await sleep(Math.max(1, Math.min(deadline - Date.now(), pollMs * (0.75 + Math.random() * 0.5))));
  }
  const ownership = await lockOwner(lockPath);
  try { return await fn(ownership); }
  finally {
    // A reclaimer that misjudged an older generation can briefly hold the gate of ours; it lets go as
    // soon as it sees our token, so retry rather than leak a live-owned lock for this process's life.
    const end = Date.now() + timeoutMs;
    while (!(await removeOwned(lockPath, token)) && (await lockOwner(lockPath))?.token === token && Date.now() < end) await sleep(pollMs);
  }
}

/** Status only, never admission authority. */
export async function lockHeld(lockPath) {
  try { await stat(lockPath); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

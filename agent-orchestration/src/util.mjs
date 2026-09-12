import { execFile as execFileCallback } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { invariant } from "./errors.mjs";

const execFile = promisify(execFileCallback);

const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/g;

/** process.cwd() throws when the directory has been deleted under a long-lived process. */
export function safeCwd() {
  try { return process.cwd(); } catch { return null; }
}

export async function runFile(command, args, options = {}) {
  invariant(Array.isArray(args), "AO_INVALID_ARGUMENT", "Command arguments must be an array.");
  const result = await execFile(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    timeout: options.timeoutMs ?? 30_000,
    windowsHide: true,
  });
  return { stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

export async function git(cwd, args, options = {}) {
  return runFile(process.platform === "win32" ? "git.exe" : "/usr/bin/git", ["-C", cwd, ...args], options);
}

export function assertAbsolutePath(value, fieldName) {
  invariant(typeof value === "string" && value.length > 0, "AO_CONSUMER_CWD_REQUIRED", `${fieldName} is required.`);
  invariant(!value.includes("\0"), "AO_UNSAFE_PATH", `${fieldName} contains a NUL byte.`);
  invariant(isAbsolute(value), "AO_CONSUMER_CWD_NOT_ABSOLUTE", `${fieldName} must be an absolute path.`);
}

export function isPathWithin(parent, candidate) {
  const rel = relative(resolve(parent), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export async function assertDirectory(path, fieldName = "path") {
  const info = await stat(path).catch(() => null);
  invariant(info?.isDirectory(), "AO_DIRECTORY_REQUIRED", `${fieldName} must name an existing directory.`, { path });
}

export async function canonicalPath(path) {
  return realpath(path);
}

/**
 * A bounded, single-line label, or null when there is nothing to record.
 *
 * Used for the few free-text identities a run carries — who approved it, which tab launched it.
 * Each arrives from outside and is read back by another program's UI, so it is trimmed of control
 * characters and capped here rather than at every call site.
 */
export function oneLineLabel(value, max = 200) {
  if (typeof value !== "string") return null;
  const text = value.replace(CONTROL_CHARACTERS, "").trim();
  return text ? text.slice(0, max) : null;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

export async function ensurePrivateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

/**
 * Remove a sandbox tree that may contain read-only caches.
 *
 * `rm({ force: true })` only swallows ENOENT. A provider that ran `go build`
 * leaves `go/pkg/mod` behind with directories at mode 0555, and unlink needs
 * write on the *parent* directory, so teardown fails with EACCES on a file the
 * broker owns. Restore write on our own directories and retry once. Symlinked
 * directories are skipped (Dirent.isDirectory() is false for them), so this
 * cannot chmod outside the tree.
 */
export async function removeTree(path) {
  const options = { recursive: true, force: true, maxRetries: 8, retryDelay: 50 };
  try {
    await rm(path, options);
    return;
  } catch (error) {
    if (error?.code !== "EACCES" && error?.code !== "EPERM") throw error;
  }
  await restoreDirectoryWrite(path);
  await rm(path, options);
}

async function restoreDirectoryWrite(path) {
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory()) return;
  await chmod(path, 0o700).catch(() => {});
  const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) await restoreDirectoryWrite(join(path, entry.name));
  }
}

export async function readJson(path, fallback = undefined) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && fallback !== undefined) return fallback;
    throw error;
  }
}

export async function atomicWriteJson(path, value) {
  await ensurePrivateDir(dirname(path));
  const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(tempPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(tempPath, path);
      break;
    } catch (error) {
      const transientWindowsLock = process.platform === "win32" && ["EACCES", "EBUSY", "EPERM"].includes(error?.code);
      if (!transientWindowsLock || attempt >= 7) throw error;
      await delay(10 * (attempt + 1));
    }
  }
  if (process.platform !== "win32") {
    const directory = await open(dirname(path), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
}

export async function processStartIdentity(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try {
    const statLine = await readFile(`/proc/${pid}/stat`, "utf8");
    const closeParen = statLine.lastIndexOf(")");
    const fields = statLine.slice(closeParen + 2).split(" ");
    return fields[19] ?? null;
  } catch {}
  try {
    const { stdout } = await runFile("ps", ["-p", String(pid), "-o", "lstart="], { timeoutMs: 2_000 });
    return stdout || null;
  } catch { return null; }
}

export function processGroupExists(processGroup) {
  if (!Number.isInteger(processGroup) || processGroup <= 0) return false;
  try {
    process.kill(-processGroup, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    if (error?.code === "EPERM") return true;
    throw error;
  }
}

export async function waitForProcessGroupExit(processGroup, timeoutMs, pollMs = 50) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(processGroup) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return !processGroupExists(processGroup);
}

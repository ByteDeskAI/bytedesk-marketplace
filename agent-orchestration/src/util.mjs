import { execFile as execFileCallback } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, open, readFile, realpath, rename, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { invariant } from "./errors.mjs";

const execFile = promisify(execFileCallback);

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
  return runFile("/usr/bin/git", ["-C", cwd, ...args], options);
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
  await rename(tempPath, path);
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
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

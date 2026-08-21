import { lstat, realpath } from "node:fs/promises";
import { spawn } from "node:child_process";
import { invariant } from "../errors.mjs";
import { runFile } from "../util.mjs";

const USER_MANAGER_EXECUTABLES = new Set(["/usr/bin/systemctl", "/usr/bin/systemd-run"]);

function validateUserManagerCommand(command, args) {
  invariant(USER_MANAGER_EXECUTABLES.has(command), "AO_UNSAFE_USER_MANAGER_COMMAND", "Refusing to execute an unexpected user-manager command.");
  invariant(Array.isArray(args), "AO_INVALID_ARGUMENT", "User-manager command arguments must be an array.");
}

export async function canonicalUserBusEnvironment(environment = process.env, dependencies = {}) {
  const uid = dependencies.uid ?? process.getuid?.();
  const inspectPath = dependencies.lstat ?? lstat;
  const canonicalizePath = dependencies.realpath ?? realpath;
  invariant(Number.isInteger(uid) && uid >= 0, "AO_USER_BUS_UNAVAILABLE", "The current Unix user identity is unavailable.");

  // XDG_RUNTIME_DIR is defined by the login manager. Derive it from the
  // current kernel identity instead of trusting an ambient path or bus address.
  const runtimeDir = `/run/user/${uid}`;
  const busPath = `${runtimeDir}/bus`;
  const [runtimeInfo, busInfo, canonicalRuntimeDir, canonicalBusPath] = await Promise.all([
    inspectPath(runtimeDir).catch(() => null),
    inspectPath(busPath).catch(() => null),
    canonicalizePath(runtimeDir).catch(() => null),
    canonicalizePath(busPath).catch(() => null),
  ]);

  invariant(
    runtimeInfo?.isDirectory() && runtimeInfo.uid === uid && (runtimeInfo.mode & 0o077) === 0 && canonicalRuntimeDir === runtimeDir,
    "AO_USER_BUS_UNAVAILABLE",
    "The canonical systemd user runtime directory is unavailable or unsafe.",
  );
  invariant(
    busInfo?.isSocket() && busInfo.uid === uid && canonicalBusPath === busPath,
    "AO_USER_BUS_UNAVAILABLE",
    "The canonical systemd user bus socket is unavailable or unsafe.",
  );

  return {
    ...environment,
    XDG_RUNTIME_DIR: runtimeDir,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${busPath}`,
  };
}

export async function runUserManagerFile(command, args, options = {}, dependencies = {}) {
  validateUserManagerCommand(command, args);
  const runner = dependencies.runFile ?? runFile;
  const env = await canonicalUserBusEnvironment(options.env ?? process.env, dependencies);
  return runner(command, args, { ...options, env });
}

export async function spawnUserManagerFile(command, args, options = {}, dependencies = {}) {
  validateUserManagerCommand(command, args);
  const spawnProcess = dependencies.spawn ?? spawn;
  const env = await canonicalUserBusEnvironment(options.env ?? process.env, dependencies);
  return spawnProcess(command, args, { ...options, env });
}

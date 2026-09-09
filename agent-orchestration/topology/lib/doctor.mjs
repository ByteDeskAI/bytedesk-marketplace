// Environment diagnosis and setup guidance. Read-only: it never installs anything itself; the
// setup-agent-orchestration skill runs the commands it suggests after the operator agrees.
import { readFile } from "node:fs/promises";
import { platform, release } from "node:os";
import { detectAdapter } from "./providers.mjs";
import { tmuxVersion } from "./tmux.mjs";
import { exists, run } from "./util.mjs";

async function hasCommand(name) {
  const which = process.platform === "win32" ? "where" : "which";
  const result = await run(which, [name], { allowFailure: true, timeoutMs: 5000 }).catch(() => ({ code: 1 }));
  return result.code === 0;
}

export async function detectOs() {
  const os = platform();
  const info = { platform: os, release: release(), wsl: false, package_manager: null };
  if (os === "linux") {
    const version = await readFile("/proc/version", "utf8").catch(() => "");
    info.wsl = /microsoft/i.test(version);
    for (const manager of ["apt-get", "dnf", "pacman", "zypper", "apk"]) {
      if (await hasCommand(manager)) {
        info.package_manager = manager;
        break;
      }
    }
  } else if (os === "darwin") {
    info.package_manager = (await hasCommand("brew")) ? "brew" : null;
  } else if (os === "win32") {
    info.package_manager = (await hasCommand("winget")) ? "winget" : null;
    info.msys2 = await exists("C:\\msys64\\usr\\bin\\tmux.exe");
  }
  return info;
}

export function tmuxInstallPlan(osInfo) {
  switch (osInfo.platform) {
    case "linux": {
      const commands = {
        "apt-get": "sudo apt-get update && sudo apt-get install -y tmux",
        dnf: "sudo dnf install -y tmux",
        pacman: "sudo pacman -S --noconfirm tmux",
        zypper: "sudo zypper install -y tmux",
        apk: "sudo apk add tmux",
      };
      return { command: commands[osInfo.package_manager] ?? null, note: osInfo.package_manager ? null : "No known package manager found; install tmux from your distribution." };
    }
    case "darwin":
      return { command: osInfo.package_manager === "brew" ? "brew install tmux" : null, note: osInfo.package_manager ? null : "Install Homebrew (https://brew.sh) first, then `brew install tmux`." };
    case "win32":
      return {
        command: null,
        note: "tmux does not run natively on Windows. Recommended: WSL2 (`wsl --install`), then run ao-topology and every agent CLI inside the distribution. Alternative: MSYS2 (`pacman -S tmux`) with agent CLIs installed in that environment.",
      };
    default:
      return { command: null, note: `Unknown platform ${osInfo.platform}; install tmux manually.` };
  }
}

export async function doctor({ adapters, workflowDirs, skillDirs, roleDirs, providerDirs, consumer, env, home }) {
  const osInfo = await detectOs();
  const tmux = await tmuxVersion();
  const node = process.version;
  const providers = [];
  for (const adapter of adapters.values()) {
    if (adapter.id === "generic") continue;
    providers.push(await detectAdapter(adapter));
  }
  const dirs = {};
  for (const [label, list] of Object.entries({ workflows: workflowDirs, skills: skillDirs, roles: roleDirs, providers: providerDirs })) {
    dirs[label] = [];
    for (const dir of list) dirs[label].push({ dir, exists: await exists(dir) });
  }
  const problems = [];
  if (!tmux) problems.push({ code: "TMUX_MISSING", message: "tmux is not installed or not on PATH.", fix: tmuxInstallPlan(osInfo) });
  if (osInfo.platform === "win32" && !osInfo.wsl) problems.push({ code: "WINDOWS_HOST", message: "Running on native Windows; tmux sessions must be created inside WSL2 or MSYS2.", fix: tmuxInstallPlan(osInfo) });
  const readyProviders = providers.filter((provider) => provider.ready);
  if (readyProviders.length === 0) problems.push({ code: "NO_PROVIDERS", message: "No known agent CLI was found on PATH. Install at least one, or use cli: <command> with the generic adapter." });
  // Is a supervisor alive for this repository, and how old is its last tick? Without one, the
  // Presence v1 heartbeat stops and every consumer reads this repo as permanently stale — the
  // failure that has no other symptom on this machine, which is exactly why doctor asks.
  // A repo that never started one is reported, not faulted: not every checkout wants a supervisor.
  let supervision = null;
  if (consumer) {
    try {
      const { supervisionStatus } = await import("./supervision.mjs");
      supervision = await supervisionStatus({ consumer, env, home });
      const stallMs = Math.max(60_000, supervision.reconcile_min_ms * 4);
      if (supervision.state === "died-before-first-tick") {
        // Distinct from "down" on purpose: this one never worked, so the remedy is to read the
        // startup crash rather than to wonder what killed a healthy daemon hours later.
        problems.push({ code: "SUPERVISOR_NEVER_TICKED", message: `The repository supervisor (pid ${supervision.pid}) died during startup and never completed a tick, so presence for this repo was never published.`, fix: { note: `The reason is at the end of ${supervision.log}` } });
      } else if (supervision.state === "orphaned") {
        problems.push({ code: "SUPERVISOR_ORPHANED", message: `A supervisor record names ${supervision.consumer}, which no longer exists — a removed worktree leaves a record no restart can reclaim.`, fix: { command: `rm ${supervision.record_path}`, note: "Debris only; nothing is running. Delete the record and its .log sibling." } });
      } else if (supervision.state === "down") {
        problems.push({ code: "SUPERVISOR_DOWN", message: `The repository supervisor (pid ${supervision.pid}) is gone after ${supervision.restarts} restart(s); presence for this repo is no longer being republished.`, fix: { command: "ao-topology supervise", note: `Last words, if any: ${supervision.log}` } });
      } else if (supervision.state !== "never-started" && supervision.tick_age_ms !== null && supervision.tick_age_ms > stallMs) {
        problems.push({ code: "SUPERVISOR_STALLED", message: `The supervisor process is alive but its last reconcile tick was ${Math.round(supervision.tick_age_ms / 1000)}s ago (floor ${supervision.reconcile_min_ms}ms).`, fix: { note: `Inspect ${supervision.log}` } });
      }
    } catch (error) {
      supervision = { state: "unknown", error: error.message };
    }
  }
  return { ok: problems.length === 0, os: osInfo, tmux: tmux ?? null, node, providers, dirs, supervision, problems };
}

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

export async function doctor({ adapters, templateDirs, skillDirs, roleDirs, providerDirs }) {
  const osInfo = await detectOs();
  const tmux = await tmuxVersion();
  const node = process.version;
  const providers = [];
  for (const adapter of adapters.values()) {
    if (adapter.id === "generic") continue;
    providers.push(await detectAdapter(adapter));
  }
  const dirs = {};
  for (const [label, list] of Object.entries({ templates: templateDirs, skills: skillDirs, roles: roleDirs, providers: providerDirs })) {
    dirs[label] = [];
    for (const dir of list) dirs[label].push({ dir, exists: await exists(dir) });
  }
  const problems = [];
  if (!tmux) problems.push({ code: "TMUX_MISSING", message: "tmux is not installed or not on PATH.", fix: tmuxInstallPlan(osInfo) });
  if (osInfo.platform === "win32" && !osInfo.wsl) problems.push({ code: "WINDOWS_HOST", message: "Running on native Windows; tmux sessions must be created inside WSL2 or MSYS2.", fix: tmuxInstallPlan(osInfo) });
  const readyProviders = providers.filter((provider) => provider.ready);
  if (readyProviders.length === 0) problems.push({ code: "NO_PROVIDERS", message: "No known agent CLI was found on PATH. Install at least one, or use cli: <command> with the generic adapter." });
  return { ok: problems.length === 0, os: osInfo, tmux: tmux ?? null, node, providers, dirs, problems };
}

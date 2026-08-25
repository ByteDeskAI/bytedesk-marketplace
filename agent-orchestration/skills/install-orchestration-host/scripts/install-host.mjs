#!/usr/bin/env node
/**
 * Wire Claude Code, Codex, Grok Build, and Kimi as orchestration hosts.
 * Spawn targets stay the trusted catalog (claude, codex, grok-build, kimi).
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOSTS = Object.freeze(["claude", "codex", "grok", "kimi"]);
const SKILL_NAMES = Object.freeze([
  "agent-orchestrate",
  "agent-orchestration-doctor",
  "roadmap-orchestrator",
]);

export function pluginRootFromScript(scriptPath = fileURLToPath(import.meta.url)) {
  return path.resolve(path.dirname(scriptPath), "..", "..", "..");
}

export function parseArgs(argv) {
  const hosts = [];
  let dryRun = false;
  let pluginRoot;
  let home = os.homedir();
  let kimiHome;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--plugin-root") pluginRoot = argv[++i];
    else if (arg === "--home") home = argv[++i];
    else if (arg === "--kimi-home") kimiHome = argv[++i];
    else if (arg === "--host") hosts.push(argv[++i]);
    else if (arg === "--all") hosts.push(...HOSTS);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  const selected = hosts.length > 0 ? [...new Set(hosts)] : [...HOSTS];
  for (const host of selected) {
    if (!HOSTS.includes(host)) throw new Error(`Unknown host: ${host}`);
  }
  return {
    dryRun,
    pluginRoot: path.resolve(pluginRoot ?? pluginRootFromScript()),
    home: path.resolve(home),
    kimiHome: path.resolve(kimiHome ?? path.join(home, ".kimi-code")),
    hosts: selected,
  };
}

function mcpCommand(pluginRoot) {
  return path.join(pluginRoot, "bin", "agent-orchestration-mcp");
}

function readJsonIfPresent(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function planHostInstall(options) {
  const pluginRoot = path.resolve(options.pluginRoot);
  const command = mcpCommand(pluginRoot);
  const plans = [];
  for (const host of options.hosts) {
    if (host === "claude") {
      plans.push({
        host,
        actions: [
          {
            kind: "report",
            detail: "Claude Code loads .claude-plugin/plugin.json, .mcp.json, skills/, and agents/ from this package.",
          },
        ],
      });
    } else if (host === "codex") {
      plans.push({
        host,
        actions: [
          {
            kind: "report",
            detail: "Codex loads .codex-plugin/plugin.json and .codex-mcp.json. Enable agent-orchestration@bytedesk in ~/.codex/config.toml.",
          },
        ],
      });
    } else if (host === "grok") {
      plans.push({
        host,
        actions: [
          {
            kind: "exec",
            command: "grok",
            args: ["plugin", "install", pluginRoot, "--trust"],
            detail: "Install and trust this plugin so Grok loads skills, the orchestrator agent, and .mcp.json.",
          },
          {
            kind: "exec",
            command: "grok",
            args: ["plugin", "enable", "agent-orchestration"],
            detail: "Enable the plugin if install left it disabled.",
            allowFailure: true,
          },
        ],
      });
    } else if (host === "kimi") {
      const kimiHome = path.resolve(options.kimiHome);
      const mcpPath = path.join(kimiHome, "mcp.json");
      const skillsDir = path.join(kimiHome, "skills");
      const agentsDir = path.join(kimiHome, "agents");
      const mcp = readJsonIfPresent(mcpPath, { mcpServers: {} });
      if (!mcp.mcpServers || typeof mcp.mcpServers !== "object") mcp.mcpServers = {};
      mcp.mcpServers["agent-orchestration"] = {
        command,
        args: [],
      };
      plans.push({
        host,
        actions: [
          { kind: "mkdir", path: kimiHome },
          { kind: "mkdir", path: skillsDir },
          { kind: "mkdir", path: agentsDir },
          { kind: "write-json", path: mcpPath, value: mcp },
          ...SKILL_NAMES.map((name) => ({
            kind: "symlink",
            from: path.join(pluginRoot, "skills", name),
            to: path.join(skillsDir, name),
          })),
          {
            kind: "symlink",
            from: path.join(pluginRoot, "agents", "cross-provider-orchestrator.md"),
            to: path.join(agentsDir, "cross-provider-orchestrator.md"),
          },
        ],
      });
    }
  }
  return { pluginRoot, command, plans };
}

export function applyHostInstall(plan, { dryRun = false, spawn = spawnSync } = {}) {
  const results = [];
  for (const hostPlan of plan.plans) {
    for (const action of hostPlan.actions) {
      if (dryRun) {
        results.push({ host: hostPlan.host, action, status: "dry-run" });
        continue;
      }
      if (action.kind === "report") {
        results.push({ host: hostPlan.host, action, status: "ok" });
      } else if (action.kind === "mkdir") {
        mkdirSync(action.path, { recursive: true });
        results.push({ host: hostPlan.host, action, status: "ok" });
      } else if (action.kind === "write-json") {
        mkdirSync(path.dirname(action.path), { recursive: true });
        writeFileSync(action.path, `${JSON.stringify(action.value, null, 2)}\n`, { mode: 0o600 });
        results.push({ host: hostPlan.host, action, status: "ok" });
      } else if (action.kind === "symlink") {
        mkdirSync(path.dirname(action.to), { recursive: true });
        rmSync(action.to, { recursive: true, force: true });
        if (process.platform === "win32" && !lstatSync(action.from).isDirectory()) {
          copyFileSync(action.from, action.to);
        } else {
          symlinkSync(action.from, action.to, process.platform === "win32" ? "junction" : undefined);
        }
        results.push({ host: hostPlan.host, action, status: "ok" });
      } else if (action.kind === "exec") {
        const ran = spawn(action.command, action.args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        const ok = ran.status === 0;
        if (!ok && !action.allowFailure) {
          throw new Error(`${action.command} ${action.args.join(" ")} failed: ${(ran.stderr || ran.stdout || "").trim()}`);
        }
        results.push({ host: hostPlan.host, action, status: ok ? "ok" : "skipped" });
      }
    }
  }
  if (!dryRun && existsSync(plan.command)) chmodSync(plan.command, 0o755);
  return results;
}

function formatResults(plan, results) {
  const lines = [
    `Plugin root: ${plan.pluginRoot}`,
    `MCP launcher: ${plan.command}`,
    "Hosts: Claude Code, Codex, Grok Build, and Kimi can orchestrate.",
    "Delegates remain catalog IDs: claude, codex, grok-build, kimi. New CLIs need a trusted adapter (docs/EXTENDING.md).",
  ];
  for (const result of results) {
    const label = result.action.detail || result.action.kind;
    const target = result.action.path || result.action.to || (result.action.args ? result.action.args.join(" ") : "");
    lines.push(`${result.host}: ${result.status} ${label}${target ? ` (${target})` : ""}`);
  }
  return `${lines.join("\n")}\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  const plan = planHostInstall(options);
  const results = applyHostInstall(plan, { dryRun: options.dryRun });
  process.stdout.write(formatResults(plan, results));
}

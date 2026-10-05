// A real git pre-commit hook, so commits made outside a Claude session are checked too.
// It runs the same guard as the PreToolUse hook (scripts/check-no-project-plugin-installs.mjs).
// The hook finds the plugin at run time from ~/.claude/plugins/installed_plugins.json, not from a path
// baked in at install time, so it survives plugin updates. It fails open when the plugin cannot be found.
import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fail } from "./util.mjs";

const exec = promisify(execFile);
const MARKER = "# ao-topology git-hook: project-install guard";

export const HOOK_SCRIPT = `#!/bin/sh
${MARKER}
# Managed by \`ao-topology git-hook install\`. Remove with \`ao-topology git-hook uninstall\`.
root=$(git rev-parse --show-toplevel) || exit 0
check=$(node -e '
const fs = require("fs"), os = require("os"), path = require("path");
try {
  const all = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude/plugins/installed_plugins.json"), "utf8")).plugins;
  const user = (all["agent-orchestration@bytedesk"] || []).find((e) => e.scope === "user");
  const file = path.join(user.installPath, "scripts", "check-no-project-plugin-installs.mjs");
  if (fs.existsSync(file)) process.stdout.write(file);
} catch {}
' 2>/dev/null)
[ -n "$check" ] || exit 0
node "$check" "$root" || { echo "pre-commit blocked: apply the Fix above (rule: ~/.agents/AGENTS.md, Claude Code plugins from a local marketplace)." >&2; exit 1; }
`;

async function hookPath(repo) {
  try {
    const { stdout } = await exec("git", ["-C", repo, "rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-commit"]);
    return resolve(stdout.trim());
  } catch { return fail("TOPOLOGY_NOT_A_GIT_REPO", `${repo} is not a Git repository.`); }
}

async function current(path) {
  try { return await readFile(path, "utf8"); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** @returns {{ path: string, state: "absent" | "installed" | "foreign" }} */
export async function gitHookStatus({ repo }) {
  const path = await hookPath(repo);
  const text = await current(path);
  return { path, state: text === null ? "absent" : text.includes(MARKER) ? "installed" : "foreign" };
}

export async function installGitHook({ repo }) {
  const { path, state } = await gitHookStatus({ repo });
  // ponytail: refuses to chain onto an existing pre-commit hook; add chaining if a repo needs two.
  if (state === "foreign") fail("TOPOLOGY_GIT_HOOK_EXISTS", `${path} already exists and is not managed by ao-topology; not overwriting it.`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, HOOK_SCRIPT);
  await chmod(path, 0o755);
  return { path, state: "installed", changed: state !== "installed" };
}

export async function uninstallGitHook({ repo }) {
  const { path, state } = await gitHookStatus({ repo });
  if (state === "foreign") fail("TOPOLOGY_GIT_HOOK_EXISTS", `${path} is not managed by ao-topology; not removing it.`);
  if (state === "installed") await rm(path);
  return { path, state: "absent", changed: state === "installed" };
}

// Retired (TM-392). This used to install a git pre-commit hook that blocked a commit in a repository
// enabling agent-orchestration or task-management at project scope. ~/.agents/AGENTS.md allows that,
// so the check is gone. A hook installed earlier looked for scripts/check-no-project-plugin-installs.mjs
// at commit time and exits 0 when that file is missing, so it no longer blocks anything.
// `status` and `uninstall` stay so a repository can find and remove an old hook; `install` refuses.
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { fail } from "./util.mjs";

const exec = promisify(execFile);
const MARKER = "# ao-topology git-hook: project-install guard";

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

export async function installGitHook() {
  fail("TOPOLOGY_GIT_HOOK_RETIRED", "The project-install pre-commit hook is retired (TM-392): a repository may enable agent-orchestration and task-management in its own .claude/settings.json. Use `git-hook uninstall` to remove an old one.");
}

export async function uninstallGitHook({ repo }) {
  const { path, state } = await gitHookStatus({ repo });
  if (state === "foreign") fail("TOPOLOGY_GIT_HOOK_EXISTS", `${path} is not managed by ao-topology; not removing it.`);
  if (state === "installed") await rm(path);
  return { path, state: "absent", changed: state === "installed" };
}

// Repository enrollment: the one provider-neutral answer to "is agent orchestration switched on for
// this repository?" (TM-167). It is keyed on the canonical repository (the common Git directory),
// so every linked worktree of one repository gets the same answer.
//
// Precedence, highest first. Every file is read from the CANONICAL root (`repositoryConsumer`), never
// from the worktree the caller happens to stand in, so eight linked worktrees cannot disagree:
//
//   1. repo config `enabled: false`  -> disabled         beats everything, a lead registration included
//   2. repo config `enabled: true`   -> repo-config
//   3. project `.claude/settings.json` enabledPlugins["agent-orchestration@<any marketplace>"] === true
//                                    -> project-plugin   an explicit `false` there does NOT disable
//   4. an existing lead registration -> lead-registration (compatibility with pre-TM-167 repos)
//   5. otherwise                     -> none
//
// Fail closed: a repo config that cannot be read, is not a JSON object, or carries a non-boolean
// `enabled` is treated as `enabled: false` — we cannot tell what it meant, and the only value that
// is allowed to override every other source is the one that switches orchestration OFF.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { repoConfigPath } from "./config.mjs";
import { readLeadRegistration } from "./lead.mjs";
import { canonicalRepoId, repositoryConsumer } from "./repoid.mjs";

const PLUGIN_KEY = /^agent-orchestration@[^@]+$/;

async function readJsonFile(path) {
  try { return { value: JSON.parse(await readFile(path, "utf8")) }; }
  catch (error) { return error?.code === "ENOENT" ? { value: undefined } : { error: `${path}: ${error.message}` }; }
}

/**
 * @returns {Promise<{ enrolled: boolean,
 *   source: "repo-config" | "project-plugin" | "lead-registration" | "disabled" | "none",
 *   repo_id: string, root: string, reason?: string }>}
 */
export async function resolveEnrollment({ consumer, env = process.env, home = homedir() }) {
  const root = await repositoryConsumer(consumer);
  const identity = await canonicalRepoId(root);
  const at = { repo_id: identity.id, root };
  const disabled = (reason) => ({ enrolled: false, source: "disabled", ...at, reason });

  const configPath = repoConfigPath(root);
  const config = await readJsonFile(configPath);
  if (config.error) return disabled(`repo config is unreadable, so it is treated as enabled:false (${config.error})`);
  if (config.value !== undefined) {
    const raw = config.value;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return disabled(`${configPath}: top level is not a JSON object, so it is treated as enabled:false`);
    if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
      return disabled(`${configPath}: "enabled" must be true or false, got ${JSON.stringify(raw.enabled)}; treated as enabled:false`);
    }
    if (raw.enabled === false) return disabled(`${configPath} sets enabled:false`);
    if (raw.enabled === true) return { enrolled: true, source: "repo-config", ...at };
  }

  const settings = await readJsonFile(join(root, ".claude", "settings.json"));
  const plugins = settings.value?.enabledPlugins;
  if (plugins && typeof plugins === "object" && Object.entries(plugins).some(([key, on]) => on === true && PLUGIN_KEY.test(key))) {
    return { enrolled: true, source: "project-plugin", ...at };
  }

  try {
    if (await readLeadRegistration({ consumer: root, env, home })) return { enrolled: true, source: "lead-registration", ...at };
  } catch (error) {
    return { enrolled: false, source: "none", ...at, reason: `lead registration is unreadable: ${error.message}` };
  }
  return { enrolled: false, source: "none", ...at, ...(settings.error ? { reason: `project settings are unreadable (${settings.error})` } : {}) };
}

/**
 * Start the canonical per-repository supervisor if, and only if, the repository is enrolled.
 * Never fatal — not even when enrollment itself cannot be resolved — never launches an agent, and
 * lists no tmux server itself. This is the ONLY self-start path: every ordinary verb routes here.
 * @returns {Promise<{ enrollment: object, reason: string, supervision: object }>}
 */
export async function activateRepository({ consumer, env = process.env, home = homedir(), reason = "unspecified", ...options }) {
  let enrollment;
  try { enrollment = await resolveEnrollment({ consumer, env, home }); }
  catch (error) { enrollment = { enrolled: false, source: "none", repo_id: null, root: null, reason: `enrollment could not be resolved: ${error.message}` }; }
  if (!enrollment.enrolled) return { enrollment, reason, supervision: { started: false, reason: "not-enrolled" } };
  try {
    const { startRepositorySupervision } = await import("./supervision.mjs");
    return { enrollment, reason, supervision: await startRepositorySupervision({ ...options, consumer: enrollment.root, env, home }) };
  } catch (error) {
    return { enrollment, reason, supervision: { started: false, error: error.message } };
  }
}

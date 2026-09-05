// Provider adapters describe how to run one agent CLI inside a tmux pane. Adding a CLI is one JSON
// file; an unknown `cli` id falls back to the generic adapter with the id used as the command.
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { exists, invariant, readJson, render, run, consumerResourceDirs } from "./util.mjs";

export const GENERIC_ADAPTER = {
  id: "generic",
  display: "Generic CLI",
  command: null,
  args: [],
  model_args: [],
  system_prompt_args: [],
  auto_approve_args: [],
  // What this CLI is given so a coordinator cannot write. Appended after auto_approve_args, so a
  // restriction always wins over a permission. Empty means this CLI has no equivalent — declare it
  // empty and say so in `notes` rather than inventing a flag.
  coordinator_args: [],
  // How this CLI is granted tool access to a directory that is not its cwd. An agent runs with its
  // own per-agent cwd (that is what gives it its own memory), so the repo it works on has to be
  // granted explicitly. `{{dir}}` is the directory. Empty means the CLI cannot do this.
  add_dir_args: [],
  // Where this CLI keeps the state that makes an agent remember: `scope` is the key it files that
  // state under, `path` a renderable location ({{home}}, {{cwd}}, {{cwd_slug}}) or null when the
  // CLI keys internally rather than by path. Declared, not inferred, so adding a CLI stays a JSON
  // file rather than a special case in the launcher.
  memory: { scope: "none", path: null, note: "" },
  ready: { delay_ms: 3000 },
  // Screen text that means "this candidate cannot serve": the launcher moves to the next one.
  failure_patterns: [
    "usage limit",
    "rate limit",
    "quota",
    "too many requests",
    "\\b429\\b",
    "overloaded",
    "capacity",
    "not logged in",
    "please log in",
    "unauthori[sz]ed",
    "invalid api key",
    "authentication",
    "command not found",
    "no such file or directory",
    "billing",
  ],
  submit_keys: ["Enter"],
  bootstrap_message: "Read {{bootstrap_file}} and follow it exactly. Reply here with the single word READY when you have read it.",
  detect: null,
  install_hint: "Install the CLI and make sure it is on PATH.",
  notes: "Fallback adapter: launches the command and delivers every instruction as typed text.",
};

export const MEMORY_SCOPES = ["cwd", "home", "none"];

export function providerDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(...consumerResourceDirs(consumer, "providers"));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", "providers"));
  if (pluginRoot) dirs.push(join(pluginRoot, "providers"));
  return dirs;
}

export function normalizeAdapter(raw, source) {
  invariant(raw && typeof raw === "object", "TOPOLOGY_ADAPTER_INVALID", `Adapter ${source} must be a JSON object.`);
  invariant(typeof raw.id === "string" && raw.id, "TOPOLOGY_ADAPTER_INVALID", `Adapter ${source} needs an "id".`);
  const adapter = { ...GENERIC_ADAPTER, ...raw, source };
  for (const key of ["args", "model_args", "system_prompt_args", "auto_approve_args", "coordinator_args", "add_dir_args", "submit_keys", "failure_patterns"]) {
    invariant(Array.isArray(adapter[key]), "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: "${key}" must be an array.`);
    adapter[key] = adapter[key].map(String);
  }
  adapter.ready = { ...GENERIC_ADAPTER.ready, ...(adapter.ready ?? {}) };
  adapter.memory = { ...GENERIC_ADAPTER.memory, ...(adapter.memory ?? {}) };
  invariant(
    MEMORY_SCOPES.includes(adapter.memory.scope),
    "TOPOLOGY_ADAPTER_INVALID",
    `Adapter ${adapter.id}: memory.scope must be one of ${MEMORY_SCOPES.join(", ")} (got ${JSON.stringify(adapter.memory.scope)}).`,
  );
  invariant(
    adapter.memory.path === null || typeof adapter.memory.path === "string",
    "TOPOLOGY_ADAPTER_INVALID",
    `Adapter ${adapter.id}: memory.path must be a string template or null.`,
  );
  for (const pattern of adapter.failure_patterns) {
    try {
      new RegExp(pattern, "i");
    } catch (error) {
      invariant(false, "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: failure pattern "${pattern}" is not a valid regex (${error.message}).`);
    }
  }
  if (adapter.ready.pattern) {
    try {
      new RegExp(adapter.ready.pattern, "m");
    } catch (error) {
      invariant(false, "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: ready.pattern is not a valid regex (${error.message}).`);
    }
  }
  return adapter;
}

/** Load adapters from every dir; earlier dirs win so a consumer can override a plugin adapter. */
export async function loadAdapters(dirs) {
  const adapters = new Map();
  for (const dir of dirs) {
    if (!(await exists(dir))) continue;
    const entries = await readdir(dir).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const path = join(dir, entry);
      const adapter = normalizeAdapter(await readJson(path), path);
      if (!adapters.has(adapter.id)) adapters.set(adapter.id, adapter);
    }
  }
  if (!adapters.has("generic")) adapters.set("generic", { ...GENERIC_ADAPTER, source: "built-in" });
  return adapters;
}

/** Pick the adapter for an agent. Unknown ids use the generic adapter with the id as the command. */
export function adapterFor(agent, adapters) {
  const known = adapters.get(agent.cli);
  if (known) {
    return { ...known, command: agent.command ?? known.command ?? known.id, fallback: false };
  }
  return { ...adapters.get("generic"), id: agent.cli, command: agent.command ?? agent.cli, fallback: true };
}

/** Build the argv the pane will execute for one agent. */
export function buildArgv(adapter, agent, vars) {
  // Order: adapter args, then the agent's own args (so a generic adapter can name a script), then
  // the option groups the adapter knows how to express.
  const argv = [adapter.command, ...adapter.args, ...agent.args];
  if (agent.model && adapter.model_args.length > 0) argv.push(...adapter.model_args);
  if (adapter.system_prompt_args.length > 0) argv.push(...adapter.system_prompt_args);
  if (agent.auto_approve && adapter.auto_approve_args.length > 0) argv.push(...adapter.auto_approve_args);
  // Last of the option groups, so where a CLI expresses both with one flag (codex's --sandbox) the
  // coordinator's restriction is the value that survives.
  if (agent.coordinates_only && adapter.coordinator_args.length > 0) argv.push(...adapter.coordinator_args);
  const rendered = argv.map((item) => render(item, { ...vars, model: agent.model ?? "" }));
  // Extra directories are rendered per directory rather than with the shared vars: the flag repeats.
  for (const dir of grantedDirs(adapter, agent)) {
    rendered.push(...adapter.add_dir_args.map((item) => render(item, { ...vars, dir })));
  }
  return rendered;
}

/** The directories this adapter will actually be told to grant. Empty if it has no mechanism. */
export function grantedDirs(adapter, agent) {
  const wanted = (agent.add_dirs ?? []).filter(Boolean);
  if (wanted.length === 0 || (adapter.add_dir_args ?? []).length === 0) return [];
  return [...new Set(wanted)];
}

/** True when this adapter can grant tool access to a directory outside the agent's cwd. */
export function grantsDirs(adapter) {
  return (adapter.add_dir_args ?? []).length > 0;
}

/**
 * Where one agent's memory lives for this adapter, from the adapter's own declaration. The cwd is
 * the scoping key for every CLI that keys by working directory, so two agents with two cwds get two
 * memories and one agent keeps its memory across spawns — neither fact depends on the run.
 */
export function memoryLocation(adapter, { cwd, home }) {
  const memory = adapter.memory ?? GENERIC_ADAPTER.memory;
  const path = memory.path ? render(memory.path, { cwd, home, cwd_slug: sanitizeCwd(cwd) }) : null;
  return { scope: memory.scope, path, note: memory.note ?? "" };
}

/** Claude Code's project key: the absolute cwd with every "/" and "." replaced by "-". */
export function sanitizeCwd(cwd) {
  return String(cwd ?? "").replace(/[/.]/g, "-");
}

/**
 * Returns the matched failure pattern if the screen text shows the candidate cannot serve.
 *
 * Paths are dropped before matching. The launcher path, the run directory and the agent directory
 * are all echoed into the pane, and a repo called `capacity-planning` or a run under
 * `.../quota-work/` is not an error — it used to burn a failover slot on a perfectly healthy agent.
 */
export function failureOnScreen(adapter, screen) {
  const text = withoutPaths(screen);
  for (const pattern of adapter.failure_patterns ?? []) {
    if (new RegExp(pattern, "i").test(text)) return pattern;
  }
  return null;
}

/** Blank out whitespace-delimited tokens that contain a "/" — paths and URLs, never failure text. */
export function withoutPaths(screen) {
  return String(screen ?? "").replace(/\S*\/\S*/g, " ");
}

export async function commandExists(command) {
  const which = process.platform === "win32" ? "where" : "which";
  const located = await run(which, [command], { allowFailure: true, timeoutMs: 5000 }).catch(() => ({ code: 1 }));
  return located.code === 0;
}

export async function detectAdapter(adapter) {
  const command = adapter.command ?? adapter.id;
  const which = process.platform === "win32" ? "where" : "which";
  const located = await run(which, [command], { allowFailure: true, timeoutMs: 5000 }).catch(() => ({ code: 1, stdout: "" }));
  const path = located.code === 0 ? located.stdout.trim().split(/\r?\n/)[0] : null;
  let version = null;
  if (path && Array.isArray(adapter.detect) && adapter.detect.length > 0) {
    const [cmd, ...args] = adapter.detect;
    const probe = await run(cmd, args, { allowFailure: true, timeoutMs: 10_000 }).catch(() => ({ code: 1, stdout: "" }));
    version = probe.code === 0 ? (probe.stdout || probe.stderr).trim().split(/\r?\n/)[0] : null;
  }
  return { id: adapter.id, display: adapter.display ?? adapter.id, command, path, version, ready: Boolean(path), install_hint: adapter.install_hint, source: adapter.source };
}

export function adapterSummary(adapter) {
  return {
    id: adapter.id,
    display: adapter.display,
    command: adapter.command ?? adapter.id,
    supports: {
      model: adapter.model_args.length > 0,
      system_prompt: adapter.system_prompt_args.length > 0,
      auto_approve: adapter.auto_approve_args.length > 0,
      add_dir: grantsDirs(adapter),
      coordinator: (adapter.coordinator_args ?? []).length > 0,
      ready_pattern: Boolean(adapter.ready.pattern),
    },
    memory: adapter.memory ?? GENERIC_ADAPTER.memory,
    source: adapter.source,
    notes: adapter.notes ?? "",
    file: adapter.source === "built-in" ? null : basename(adapter.source),
  };
}

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
  //
  // Every entry needs failure CONTEXT, not a bare noun. A bare noun costs a healthy agent its slot:
  // Claude Code prints "⚠ 2 MCP servers need authentication · run /mcp" at startup on any machine
  // with an unauthenticated MCP server — extremely common — and `authentication` matched it, so the
  // agent was declared a failed candidate in five seconds and, on a single-candidate spec, never
  // came up at all. `quota`, `capacity` and `billing` were the same shape of mistake waiting to
  // happen. These patterns are matched case-insensitively against the pane, with paths blanked
  // first (see `withoutPaths`), so they must survive that stripping too.
  //
  // Keep them free of "{", "}" and ":" where you can: `tmuxFailureTrigger` drops any pattern tmux's
  // format parser cannot read, and on the subscription path a dropped pattern never fires at all.
  // That is why `no such file or directory` is not narrowed to the `: no such file` shell shape —
  // the colon would buy precision on the polling path by disabling it on the path real adapters use.
  failure_patterns: [
    "usage limit",
    "rate limit",
    "quota[ _-](exceeded|exhausted|reached)",
    "exceeded your quota",
    "out of quota",
    "too many requests",
    "\\b429\\b",
    "overloaded",
    "(at|over|no) capacity",
    "capacity[ _-](exceeded|limit)",
    "not logged in",
    "please log in",
    "\\bunauthori[sz]ed\\b",
    "invalid api key",
    "authentication[ _-](failed|error|required|expired)",
    "failed to authenticate",
    "command not found",
    "no such file or directory",
    "billing[ _-](issue|problem|error|required)",
    "update your billing",
  ],
  // Screen text that means "a human has to answer something before this CLI will start". It is a
  // failure like any other for chain purposes — the next candidate is a different CLI and may have
  // no such prompt — but the operator's action is completely different from a provider outage, so
  // the message says what to do instead of naming a regex. Entries are { pattern, message }.
  attention_patterns: [],
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
  // Native session-start hook coverage, when the CLI has a mechanism we have observed. Absent means
  // honestly none — the startup layer reports no coverage rather than inventing one. Normalized to
  // { kind, path, event } so startup.mjs can switch on kind without re-validating.
  if (adapter.hooks === undefined || adapter.hooks === null) {
    adapter.hooks = null;
  } else {
    invariant(
      typeof adapter.hooks === "object" && !Array.isArray(adapter.hooks)
        && typeof adapter.hooks.kind === "string" && adapter.hooks.kind
        && typeof adapter.hooks.path === "string" && adapter.hooks.path
        && typeof adapter.hooks.event === "string" && adapter.hooks.event,
      "TOPOLOGY_ADAPTER_INVALID",
      `Adapter ${adapter.id}: "hooks" must be { kind, path, event } — the mechanism, the settings file it lives in, and the event to hang on.`,
    );
    adapter.hooks = { kind: adapter.hooks.kind, path: adapter.hooks.path, event: adapter.hooks.event };
  }
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
  invariant(Array.isArray(adapter.attention_patterns), "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: "attention_patterns" must be an array.`);
  adapter.attention_patterns = adapter.attention_patterns.map((entry, index) => {
    invariant(
      entry && typeof entry === "object" && typeof entry.pattern === "string" && typeof entry.message === "string",
      "TOPOLOGY_ADAPTER_INVALID",
      `Adapter ${adapter.id}: attention_patterns[${index}] must be { pattern, message } — the message is what an operator is told to do, so it is not optional.`,
    );
    try {
      new RegExp(entry.pattern, "i");
    } catch (error) {
      invariant(false, "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: attention pattern "${entry.pattern}" is not a valid regex (${error.message}).`);
    }
    return { pattern: entry.pattern, message: entry.message };
  });
  assertTmuxPattern(adapter, "ready.tmux_pattern", adapter.ready.tmux_pattern);
  // How this CLI renders an EMPTY composer, right now. Absent means absent: an adapter with no
  // measured `composer` holds its mail and reports rather than ringing blind, and NOTHING defaults
  // it to `ready.tmux_pattern` — codex is the proof that the two differ (its shipped ready pattern
  // matched zero lines while the empty composer plainly rendered a placeholder). The note is
  // required for the same reason `memory.note` is: an unmeasured pattern is the codex bug again.
  if (adapter.composer === undefined || adapter.composer === null) {
    adapter.composer = null;
  } else {
    invariant(
      typeof adapter.composer === "object" && !Array.isArray(adapter.composer)
        && typeof adapter.composer.empty_tmux_pattern === "string" && adapter.composer.empty_tmux_pattern
        && typeof adapter.composer.empty_pattern === "string" && adapter.composer.empty_pattern
        && typeof adapter.composer.note === "string" && adapter.composer.note.trim(),
      "TOPOLOGY_ADAPTER_INVALID",
      `Adapter ${adapter.id}: "composer" must be { empty_tmux_pattern, empty_pattern, note } — the note records WHEN and against WHAT the pattern was measured, so it is not optional.`,
    );
    assertTmuxPattern(adapter, "composer.empty_tmux_pattern", adapter.composer.empty_tmux_pattern);
    try {
      new RegExp(adapter.composer.empty_pattern, "m");
    } catch (error) {
      invariant(false, "TOPOLOGY_ADAPTER_INVALID", `Adapter ${adapter.id}: composer.empty_pattern is not a valid regex (${error.message}).`);
    }
    adapter.composer = {
      empty_tmux_pattern: adapter.composer.empty_tmux_pattern,
      empty_pattern: adapter.composer.empty_pattern,
      note: adapter.composer.note,
    };
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

/**
 * Validate one tmux-side pattern. Every field whose value is evaluated by the tmux SERVER goes
 * through here, because the traps are the server's, not ours, and each one costs the full timeout
 * while looking like a slow agent:
 *
 *   * `{`, `}` and `:` are structure to tmux's format parser — `#{C/r:a{2}}` returns the literal
 *     `0}`, and `:` is the format's own separator, so `[[:space:]]` cannot be used at all.
 *   * tmux searches one RENDERED LINE at a time, so a pattern spanning a newline matches nothing.
 *     Measured on tmux 3.4: a pane showing "ready\n> " answers 0 for `#{C/r:ready\n>}`, 1 for
 *     `#{C/r:ready}`.
 *   * tmux trims trailing whitespace off a rendered line, so a pattern ending in a whitespace class
 *     cannot match a prompt that is last on its line — the common case. Verified: for a line "> ",
 *     `#{C/r:>[[:space:]]}` answers 0 while `#{C/r:>$}` answers 2.
 *
 * `field` names the declaration so the message points at the JSON key that has to change.
 */
export function assertTmuxPattern(adapter, field, value) {
  if (!value) return;
  invariant(
    !/[{}:]/.test(value),
    "TOPOLOGY_ADAPTER_INVALID",
    `Adapter ${adapter.id}: ${field} may not contain "{", "}" or ":" — tmux's format parser consumes them. Got ${JSON.stringify(value)}.`,
  );
  invariant(
    !/\\n|\\r|\n/.test(value),
    "TOPOLOGY_ADAPTER_INVALID",
    `Adapter ${adapter.id}: ${field} may not span a line break — tmux matches one rendered line at a time, so a pattern containing a newline can never match. Got ${JSON.stringify(value)}. Match the one line alone.`,
  );
  invariant(
    !/(\\s|\[\[:space:\]\]|\\t| )[*+?]?$/.test(value),
    "TOPOLOGY_ADAPTER_INVALID",
    `Adapter ${adapter.id}: ${field} ends in a whitespace match, which tmux has already trimmed off the rendered line. Got ${JSON.stringify(value)}. Drop the trailing whitespace.`,
  );
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

/**
 * Returns the attention entry if the screen shows something only a human can answer.
 *
 * Checked before the failure list, because these screens are specific and the failure list is
 * generic: Claude's folder-trust modal contains the word "exit", and a first-launch login screen
 * says "not logged in" while meaning "press a key", not "this provider is down". Naming the specific
 * thing first is what makes the message actionable.
 */
export function attentionOnScreen(adapter, screen) {
  const text = withoutPaths(screen);
  for (const entry of adapter.attention_patterns ?? []) {
    if (new RegExp(entry.pattern, "i").test(text)) return entry;
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
      hooks: Boolean(adapter.hooks),
    },
    memory: adapter.memory ?? GENERIC_ADAPTER.memory,
    source: adapter.source,
    notes: adapter.notes ?? "",
    file: adapter.source === "built-in" ? null : basename(adapter.source),
  };
}

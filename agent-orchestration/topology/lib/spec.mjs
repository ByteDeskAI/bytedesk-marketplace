// Orchestration spec: the declarative object that natural language compiles into and that a
// template stores. Validation is deliberately strict and explains every failure so that an LLM
// composing a spec can fix it from the error text alone.
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { absolutize, exists, fail, invariant, readJson, renderDeep, slug } from "./util.mjs";

export const SPEC_VERSION = 1;
export const LAYOUTS = ["main-vertical", "grid", "windows"];
export const ROLES = ["orchestrator", "worker", "designer", "judge", "reviewer", "researcher", "implementer"];
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

export function specSchemaSummary() {
  return {
    version: SPEC_VERSION,
    required: ["name", "agents"],
    fields: {
      name: "slug; becomes the template name",
      description: "one sentence shown by `ao-topology templates`",
      inputs: "map of input name -> { description, required, default, options?: [value | {value, description}], multi?: bool }; referenced as {{inputs.<name>}}; options make the launcher show a menu",
      session: "tmux session name template (default '{{name}}-{{run_id}}')",
      cwd: "default working directory for every agent (default '{{consumer}}')",
      run_dir: "where mailbox, journal, and artifacts live (default '{{consumer}}/.orchestration/runs/{{run_id}}')",
      layout: LAYOUTS,
      agents: "array of { id, role, cli, model?, candidates?: ['cli:model', ...] (ordered fallback chain; replaces cli/model), cwd?, skills?[], instructions?, env?{}, args?[], auto_approve? }",
      workflow: "ordered stages: { stage, from, to[], contract?, timeout?, wait_for?[], loop_until?, max_rounds?, description? }",
      gates: "array of { after: <stage>, human: true, description? } — the conductor stops and asks the operator",
      artifacts: "{ dir: 'artifacts', promote_to?: '<path or instruction>' }",
    },
    roles: ROLES,
    placeholders: ["{{run_id}}", "{{name}}", "{{consumer}}", "{{run_dir}}", "{{session}}", "{{home}}", "{{inputs.<name>}}", "{{agent.id}}", "{{agent.role}}"],
  };
}

/** Parse "claude:fable, codex:gpt-5, grok" (string or array) into [{ cli, model }]. Placeholders are kept. */
export function candidateList(value) {
  const items = Array.isArray(value) ? value : String(value).split(",");
  return items
    .map((item) => (typeof item === "object" && item ? `${item.cli ?? ""}:${item.model ?? ""}` : String(item)))
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const colon = item.indexOf(":");
      const cli = (colon >= 0 ? item.slice(0, colon) : item).trim();
      const model = colon >= 0 ? item.slice(colon + 1).trim() : "";
      return { cli, model: model || undefined };
    });
}

/** Validate a raw spec object. Returns a normalized copy; throws TopologyError with every problem listed. */
export function validateSpec(raw) {
  const problems = [];
  const note = (message) => problems.push(message);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail("TOPOLOGY_SPEC_INVALID", "Spec must be a JSON object.");
  }

  const spec = { ...raw };
  spec.version = spec.version ?? SPEC_VERSION;
  if (spec.version !== SPEC_VERSION) note(`version must be ${SPEC_VERSION} (got ${JSON.stringify(spec.version)})`);

  if (typeof spec.name !== "string" || !spec.name.trim()) note("name is required (a short slug)");
  else spec.name = slug(spec.name);

  spec.description = typeof spec.description === "string" ? spec.description : "";
  spec.session = typeof spec.session === "string" && spec.session ? spec.session : "{{name}}-{{run_id}}";
  spec.cwd = typeof spec.cwd === "string" && spec.cwd ? spec.cwd : "{{consumer}}";
  spec.run_dir = typeof spec.run_dir === "string" && spec.run_dir ? spec.run_dir : "{{consumer}}/.orchestration/runs/{{run_id}}";
  spec.layout = spec.layout ?? "main-vertical";
  if (!LAYOUTS.includes(spec.layout)) note(`layout must be one of ${LAYOUTS.join(", ")}`);

  spec.inputs = spec.inputs && typeof spec.inputs === "object" ? spec.inputs : {};
  for (const [key, def] of Object.entries(spec.inputs)) {
    if (!ID_PATTERN.test(key)) note(`inputs.${key}: input names must be lowercase slugs`);
    if (!def || typeof def !== "object") {
      spec.inputs[key] = { description: "", required: true };
    } else {
      const options = Array.isArray(def.options) ? def.options.map((option) => (typeof option === "string" ? { value: option, description: "" } : { value: String(option?.value ?? ""), description: option?.description ?? "" })) : undefined;
      if (options && options.some((option) => !option.value)) note(`inputs.${key}.options: every option needs a value`);
      if (options && def.default !== undefined && !options.some((option) => option.value === String(def.default))) note(`inputs.${key}: default "${def.default}" is not one of its options`);
      spec.inputs[key] = { description: def.description ?? "", required: def.required !== false && def.default === undefined, default: def.default, options, multi: def.multi === true };
    }
  }

  if (!Array.isArray(spec.agents) || spec.agents.length === 0) {
    note("agents must be a non-empty array");
    spec.agents = [];
  }
  const ids = new Set();
  spec.agents = spec.agents.map((agent, index) => {
    const where = `agents[${index}]`;
    if (!agent || typeof agent !== "object") {
      note(`${where} must be an object`);
      return { id: `agent-${index}`, role: "worker", cli: "generic", skills: [] };
    }
    const normalized = { ...agent };
    if (typeof normalized.id !== "string" || !ID_PATTERN.test(normalized.id)) note(`${where}.id must be a lowercase slug (got ${JSON.stringify(normalized.id)})`);
    else if (ids.has(normalized.id)) note(`${where}.id "${normalized.id}" is duplicated`);
    else ids.add(normalized.id);
    normalized.role = typeof normalized.role === "string" ? normalized.role : "worker";
    if (!ID_PATTERN.test(normalized.role)) note(`${where}.role must be a slug (built-in roles: ${ROLES.join(", ")})`);
    // Fallback chain: `candidates` is an ordered list of "cli[:model]" (array, or one comma-separated
    // string so an input can supply it). `cli`/`model` alone is a chain of one.
    const rawCandidates = normalized.candidates;
    if (rawCandidates !== undefined) {
      if (typeof rawCandidates !== "string" && !Array.isArray(rawCandidates)) note(`${where}.candidates must be an array of "cli:model" strings or one comma-separated string`);
      else {
        normalized.candidates = candidateList(rawCandidates);
        if (normalized.candidates.length === 0) note(`${where}.candidates is empty`);
        if (normalized.candidates.some((candidate) => !candidate.cli)) note(`${where}.candidates entries must look like "claude:fable" or "codex"`);
        if (normalized.cli === undefined && normalized.candidates[0]) normalized.cli = normalized.candidates[0].cli;
        if (normalized.model === undefined && normalized.candidates[0]) normalized.model = normalized.candidates[0].model;
      }
    }
    if (typeof normalized.cli !== "string" || !normalized.cli.trim()) note(`${where}.cli is required (a provider adapter id such as claude, codex, grok, or generic), or give candidates: ["claude:fable", "codex:gpt-5"]`);
    normalized.skills = Array.isArray(normalized.skills) ? normalized.skills.map(String) : [];
    normalized.args = Array.isArray(normalized.args) ? normalized.args.map(String) : [];
    normalized.env = normalized.env && typeof normalized.env === "object" ? normalized.env : {};
    normalized.instructions = typeof normalized.instructions === "string" ? normalized.instructions : "";
    normalized.auto_approve = normalized.auto_approve === true;
    if (normalized.model !== undefined && typeof normalized.model !== "string") note(`${where}.model must be a string`);
    if (normalized.cwd !== undefined && typeof normalized.cwd !== "string") note(`${where}.cwd must be a string`);
    return normalized;
  });

  const orchestrators = spec.agents.filter((agent) => agent.role === "orchestrator");
  if (orchestrators.length !== 1) note(`exactly one agent must have role "orchestrator" (found ${orchestrators.length}); it is the conductor that runs the workflow`);

  spec.workflow = Array.isArray(spec.workflow) ? spec.workflow : [];
  const stages = new Set();
  spec.workflow = spec.workflow.map((stage, index) => {
    const where = `workflow[${index}]`;
    if (!stage || typeof stage !== "object") {
      note(`${where} must be an object`);
      return { stage: `stage-${index}`, from: "", to: [] };
    }
    const normalized = { ...stage };
    if (typeof normalized.stage !== "string" || !ID_PATTERN.test(normalized.stage)) note(`${where}.stage must be a slug`);
    else if (stages.has(normalized.stage)) note(`${where}.stage "${normalized.stage}" is duplicated`);
    else stages.add(normalized.stage);
    normalized.to = Array.isArray(normalized.to) ? normalized.to : normalized.to ? [normalized.to] : [];
    normalized.wait_for = Array.isArray(normalized.wait_for) ? normalized.wait_for : normalized.wait_for ? [normalized.wait_for] : [];
    if (normalized.from !== undefined && !ids.has(normalized.from)) note(`${where}.from references unknown agent "${normalized.from}"`);
    for (const target of [...normalized.to, ...normalized.wait_for]) {
      if (!ids.has(target)) note(`${where} references unknown agent "${target}"`);
    }
    if (normalized.max_rounds !== undefined && !(Number.isInteger(normalized.max_rounds) && normalized.max_rounds > 0)) note(`${where}.max_rounds must be a positive integer`);
    normalized.description = typeof normalized.description === "string" ? normalized.description : "";
    return normalized;
  });

  spec.gates = Array.isArray(spec.gates) ? spec.gates : [];
  spec.gates.forEach((gate, index) => {
    if (!gate || typeof gate !== "object" || typeof gate.after !== "string") note(`gates[${index}] must be { after: <stage>, human: true }`);
    else if (!stages.has(gate.after)) note(`gates[${index}].after references unknown stage "${gate.after}"`);
  });

  spec.artifacts = spec.artifacts && typeof spec.artifacts === "object" ? spec.artifacts : {};
  spec.artifacts.dir = typeof spec.artifacts.dir === "string" && spec.artifacts.dir ? spec.artifacts.dir : "artifacts";

  if (problems.length > 0) {
    fail("TOPOLOGY_SPEC_INVALID", `Spec "${raw.name ?? "(unnamed)"}" has ${problems.length} problem(s):\n- ${problems.join("\n- ")}`, { problems });
  }
  return spec;
}

/** Fill inputs from `--input k=v` pairs and defaults; fail on missing required inputs. */
export function resolveInputs(spec, provided = {}) {
  const inputs = {};
  const missing = [];
  const invalid = [];
  for (const [key, def] of Object.entries(spec.inputs)) {
    const choices = def.options ? def.options.map((option) => option.value) : null;
    const describe = () => `${key}${def.description ? ` — ${def.description}` : ""}${choices ? ` (options: ${choices.join(" | ")}${def.multi ? ", comma-separated for several" : ""})` : ""}`;
    if (provided[key] !== undefined) {
      const value = String(provided[key]);
      if (choices) {
        const values = def.multi ? value.split(",").map((item) => item.trim()).filter(Boolean) : [value];
        const bad = values.filter((item) => !choices.includes(item));
        if (bad.length > 0) invalid.push(`${key}="${value}" is not allowed; ${describe()}`);
      }
      inputs[key] = value;
    } else if (def.default !== undefined) inputs[key] = def.default;
    else if (def.required) missing.push(describe());
  }
  for (const key of Object.keys(provided)) {
    if (!(key in spec.inputs)) inputs[key] = provided[key];
  }
  invariant(invalid.length === 0, "TOPOLOGY_INPUT_INVALID", `Invalid input(s):\n- ${invalid.join("\n- ")}`, { invalid });
  invariant(missing.length === 0, "TOPOLOGY_INPUT_MISSING", `Missing required input(s):\n- ${missing.join("\n- ")}\nPass them with --input <name>=<value>.`, { missing });
  return inputs;
}

/** Render every placeholder in a validated spec for one concrete run. */
export function materializeSpec(spec, context) {
  const base = { run_id: context.runId, name: spec.name, consumer: context.consumer, home: context.home };
  // Inputs may themselves contain placeholders (a default of "{{consumer}}"); render them first.
  const vars = { ...base, inputs: renderDeep(context.inputs ?? {}, base) };
  const session = slug(renderDeep(spec.session, vars));
  vars.session = session;
  const runDir = absolutize(renderDeep(spec.run_dir, vars), context.consumer);
  vars.run_dir = runDir;
  const rendered = renderDeep({ ...spec, session, run_dir: runDir }, vars);
  rendered.cwd = absolutize(rendered.cwd, context.consumer);
  rendered.agents = rendered.agents.map((agent) => {
    const agentVars = { ...vars, agent: { id: agent.id, role: agent.role } };
    const withAgent = renderDeep(agent, agentVars);
    withAgent.cwd = absolutize(withAgent.cwd ?? rendered.cwd, context.consumer);
    // Re-parse the chain after rendering: an input may have supplied "codex:gpt-5,claude:fable".
    const chainSource = withAgent.candidates ? withAgent.candidates.map((c) => (c.model ? `${c.cli}:${c.model}` : c.cli)).join(",") : `${withAgent.cli}:${withAgent.model ?? ""}`;
    withAgent.candidates = candidateList(chainSource).filter((c) => c.cli && c.cli !== "none");
    if (withAgent.candidates.length === 0) withAgent.candidates = [{ cli: withAgent.cli, model: withAgent.model || undefined }];
    withAgent.cli = withAgent.candidates[0].cli;
    withAgent.model = withAgent.candidates[0].model;
    return withAgent;
  });
  rendered.inputs_resolved = vars.inputs;
  rendered.run_id = context.runId;
  rendered.consumer = context.consumer;
  return rendered;
}

/** Search order for templates: explicit dirs, consumer `.orchestration/templates`, user config, plugin templates. */
export function templateDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(join(consumer, ".orchestration", "templates"));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", "templates"));
  if (pluginRoot) dirs.push(join(pluginRoot, "templates", "orchestrations"));
  return dirs;
}

export async function listTemplates(dirs) {
  const found = [];
  for (const dir of dirs) {
    if (!(await exists(dir))) continue;
    const entries = await readdir(dir).catch(() => []);
    for (const entry of entries.filter((name) => name.endsWith(".json")).sort()) {
      const path = join(dir, entry);
      try {
        const spec = validateSpec(await readJson(path));
        found.push({ name: spec.name, file: basename(entry, ".json"), path, description: spec.description, agents: spec.agents.map((agent) => `${agent.id}(${agent.cli})`) });
      } catch (error) {
        found.push({ name: basename(entry, ".json"), path, error: error.message });
      }
    }
  }
  return found;
}

/** Resolve `--template <name|path>` or `--spec <path>` to a validated spec plus its source path. */
export async function loadSpec({ template, specPath, dirs }) {
  if (specPath) {
    const path = absolutize(specPath);
    invariant(await exists(path), "TOPOLOGY_SPEC_NOT_FOUND", `Spec file not found: ${path}`);
    return { spec: validateSpec(await readJson(path)), path };
  }
  invariant(template, "TOPOLOGY_SPEC_REQUIRED", "Pass --template <name> or --spec <file.json>.");
  if (template.endsWith(".json")) {
    const path = absolutize(template);
    if (await exists(path)) return { spec: validateSpec(await readJson(path)), path };
  }
  for (const dir of dirs) {
    const path = join(dir, `${template}.json`);
    if (await exists(path)) return { spec: validateSpec(await readJson(path)), path };
  }
  fail("TOPOLOGY_TEMPLATE_NOT_FOUND", `No template named "${template}". Searched:\n- ${dirs.join("\n- ")}\nRun \`ao-topology templates\` to list what exists.`);
}

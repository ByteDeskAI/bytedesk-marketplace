// Orchestration spec: the declarative object that natural language compiles into and that a
// template stores. Validation is deliberately strict and explains every failure so that an LLM
// composing a spec can fix it from the error text alone.
import { mkdirSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { absolutize, exists, fail, invariant, readJson, renderDeep, slug, consumerResourceDirs, isInside } from "./util.mjs";
import { agentDirs, agentsRoot, listAgentsSync, matchAgent } from "./agents.mjs";

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
      description: "one sentence shown by `ao-topology workflows`",
      inputs: "map of input name -> { description, required, default, options?: [value | {value, description}], multi?: bool }; referenced as {{inputs.<name>}}; options make the launcher show a menu",
      session: "tmux session name template (default '{{name}}-{{run_id}}')",
      cwd: "default working directory for every agent (default '{{consumer}}')",
      run_dir: "where mailbox, journal, and artifacts live (default '{{consumer}}/.bytedesk/agent-orchestration/runs/{{run_id}}')",
      layout: LAYOUTS,
      agents: "array of { id, role, cli, model?, candidates?: ['cli:model', ...] (ordered fallback chain; replaces cli/model), cwd?, skills?[], mcp?[], instructions?, instructions_file?, env?{}, args?[], auto_approve?, coordinates_only? }",
      "agents[].coordinates_only": "true for an agent that delegates and does not implement — the launcher withholds the work tree and the write tools from it. A repo's lead carries it; a spec may set it directly.",
      "agents[].agent": "id or full name of an agent stored in this repo's library (`ao-topology agent list`). Its stored definition supplies role, cli/candidates, skills, mcp, instructions, instructions_file, args, env and auto_approve; any field written inline on the spec entry overrides the stored one. `id` may be omitted — it is derived from the stored agent's name.",
      "agents[].mcp": "MCP servers this agent gets, as names resolved by the provider or inline server objects",
      "agents[].instructions_file": "path to a Markdown system prompt, read at launch and prepended to `instructions`. Relative to the stored agent's own directory when the entry names one, otherwise to the consumer repo.",
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
  spec.session = typeof spec.session === "string" && spec.session ? spec.session : DEFAULT_SESSION;
  spec.cwd = typeof spec.cwd === "string" && spec.cwd ? spec.cwd : "{{consumer}}";
  spec.run_dir = typeof spec.run_dir === "string" && spec.run_dir ? spec.run_dir : "{{consumer}}/.bytedesk/agent-orchestration/runs/{{run_id}}";
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
    // `workflow` names another workflow, which joins this run as a PARTICIPANT rather than a pane:
    // the conductor addresses it by id exactly like an agent and never learns it is a team. Like
    // `agent` below, what it names cannot be checked here — validation is synchronous and dirless —
    // so the child spec is resolved at launch, not now. A participant is not a process, so it has no
    // cli, no model and no fallback chain, and saying otherwise is a spec bug worth naming early.
    if (normalized.workflow !== undefined && (typeof normalized.workflow !== "string" || !normalized.workflow.trim())) note(`${where}.workflow must be the name of another workflow`);
    const isParticipant = typeof normalized.workflow === "string" && normalized.workflow.trim().length > 0;
    if (isParticipant) {
      for (const field of ["cli", "model", "candidates", "agent", "instructions_file", "auto_approve"]) {
        if (normalized[field] !== undefined) note(`${where}.${field} cannot be set on a workflow participant — "${normalized.workflow}" is a team, not a process. Set it inside that workflow instead.`);
      }
      if (normalized.inputs !== undefined && (typeof normalized.inputs !== "object" || Array.isArray(normalized.inputs))) {
        note(`${where}.inputs must be a map of input name to value, passed to "${normalized.workflow}" when it launches`);
      }
      normalized.inputs = normalized.inputs && typeof normalized.inputs === "object" && !Array.isArray(normalized.inputs) ? normalized.inputs : {};
      // `for_each` turns one entry into one child per item. An array or a comma-separated string,
      // matching how `candidates` already accepts both — an input can only ever supply a string, and
      // a fan-out whose width comes from an input is the whole point.
      if (normalized.for_each !== undefined && typeof normalized.for_each !== "string" && !Array.isArray(normalized.for_each)) {
        note(`${where}.for_each must be an array, or one comma-separated string (often "{{inputs.<name>}}")`);
      }
      // A participant is a worker as far as the mailbox is concerned: it can be briefed and it owes
      // replies. Only a pane-ful agent may be the conductor, which the orchestrator count enforces.
      normalized.role = typeof normalized.role === "string" && normalized.role ? normalized.role : "worker";
      if (normalized.role === "orchestrator") note(`${where}.role cannot be orchestrator — a workflow participant has no pane, so it cannot conduct this run`);
      // The direct loop, caught here rather than at launch. An indirect one (A contains B, B contains
      // A) is only visible once the ancestry exists, so the launcher refuses that from the lineage —
      // but a workflow naming ITSELF is decidable from this file alone, and catching it here means
      // the operator is told before a single pane is created rather than after half a run is up.
      if (typeof spec.name === "string" && normalized.workflow.trim() === spec.name) {
        note(`${where}.workflow is "${spec.name}", which is this workflow — a workflow cannot contain itself. For a loop over items use for_each; for a nested team name a different workflow.`);
      }
    }
    // `agent` names a stored agent in this repo's library. What it supplies cannot be checked here —
    // validation is synchronous and dirless — so the entry is allowed to omit what the library will
    // provide, and materializeSpec merges the stored definition in. `_inline` is the record of what
    // the spec author actually wrote, which is what makes "inline overrides stored" decidable later.
    if (normalized.agent !== undefined && (typeof normalized.agent !== "string" || !normalized.agent.trim())) note(`${where}.agent must be the id or full name of a stored agent`);
    const hasRef = typeof normalized.agent === "string" && normalized.agent.trim().length > 0;
    if (hasRef) normalized._inline = Array.isArray(agent._inline) ? agent._inline.map(String) : Object.keys(agent);
    if (normalized.id === undefined && hasRef) {
      // Derived from the stored agent's name at materialize time. An entry without an id cannot be
      // named by the workflow, which is why omitting it is only allowed for a library reference.
    } else if (typeof normalized.id !== "string" || !ID_PATTERN.test(normalized.id)) note(`${where}.id must be a lowercase slug (got ${JSON.stringify(normalized.id)})`);
    else if (ids.has(normalized.id)) note(`${where}.id "${normalized.id}" is duplicated`);
    else ids.add(normalized.id);
    if (normalized.role === undefined && hasRef) {
      // The stored agent's role stands.
    } else {
      normalized.role = typeof normalized.role === "string" ? normalized.role : "worker";
      if (!ID_PATTERN.test(normalized.role)) note(`${where}.role must be a slug (built-in roles: ${ROLES.join(", ")})`);
    }
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
    if (!hasRef && !isParticipant && (typeof normalized.cli !== "string" || !normalized.cli.trim())) note(`${where}.cli is required (a provider adapter id such as claude, codex, grok, or generic), or give candidates: ["claude:fable", "codex:gpt-5"]`);
    normalized.skills = Array.isArray(normalized.skills) ? normalized.skills.map(String) : [];
    if (normalized.mcp !== undefined && !Array.isArray(normalized.mcp)) note(`${where}.mcp must be an array of MCP server names or server objects`);
    normalized.mcp = Array.isArray(normalized.mcp) ? normalized.mcp : [];
    if (normalized.instructions_file !== undefined && typeof normalized.instructions_file !== "string") note(`${where}.instructions_file must be a path to a Markdown prompt`);
    normalized.args = Array.isArray(normalized.args) ? normalized.args.map(String) : [];
    normalized.env = normalized.env && typeof normalized.env === "object" ? normalized.env : {};
    normalized.instructions = typeof normalized.instructions === "string" ? normalized.instructions : "";
    normalized.auto_approve = normalized.auto_approve === true;
    // A coordinator delegates and does not implement. It travels on the agent rather than being
    // inferred from the role, because a repo's lead appears in a run as an orchestrator — there is
    // no lead role pack, and a spec must have exactly one orchestrator. A spec written by hand can
    // declare it directly; a library agent brings its own.
    normalized.coordinates_only = normalized.coordinates_only === true;
    if (normalized.model !== undefined && typeof normalized.model !== "string") note(`${where}.model must be a string`);
    if (normalized.cwd !== undefined && typeof normalized.cwd !== "string") note(`${where}.cwd must be a string`);
    return normalized;
  });

  // A library reference that does not state a role takes the stored one, which is unknown until
  // materialization — so the conductor count is checked there instead of here.
  if (!spec.agents.some((agent) => agent.agent && agent.role === undefined)) {
    const problem = orchestratorProblem(spec.agents);
    if (problem) note(problem);
  }

  // The stage list is `stages`. It used to be `workflow`, which collided head-on with
  // `agents[].workflow` naming another workflow to nest — one word for "the steps of this run" and
  // for "a whole other run" is a spec nobody can read. The old key is still accepted, because specs
  // are committed data in repos this rename does not get to break; `validate` says so out loud.
  const deprecations = [];
  if (spec.stages === undefined && Array.isArray(spec.workflow)) {
    spec.stages = spec.workflow;
    deprecations.push('the stage list is now `stages`; `workflow` is still read but names a nested workflow elsewhere in the spec. Rename the top-level "workflow" key to "stages".');
  }
  delete spec.workflow;
  spec.stages = Array.isArray(spec.stages) ? spec.stages : [];
  const stages = new Set();
  spec.stages = spec.stages.map((stage, index) => {
    const where = `stages[${index}]`;
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

  if (deprecations.length > 0) spec.deprecations = deprecations;

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

function orchestratorProblem(agents) {
  // Participants are excluded: a workflow participant has no pane, so it cannot be the thing that
  // conducts this run. Counting one would let a spec whose only "conductor" is a child team pass
  // validation and then have nobody to send the first message.
  const found = agents.filter((agent) => agent.role === "orchestrator" && !agent.workflow).length;
  return found === 1 ? null : `exactly one agent must have role "orchestrator" (found ${found}); it is the conductor that runs the workflow`;
}

/** Fields a stored agent contributes to a spec entry that references it. */
const FROM_LIBRARY = ["role", "cli", "model", "candidates", "skills", "mcp", "instructions", "instructions_file", "args", "env", "auto_approve", "coordinates_only", "cwd"];

/** A spec entry that omits `id` borrows the stored agent's name, uniquely within the run. */
function derivedAgentId(stored, taken) {
  let base = slug(stored.full_name || "");
  if (!ID_PATTERN.test(base)) base = `agent-${slug(String(stored.id))}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * Replace every `{ agent: "<id|name>" }` entry with the stored definition from the repo's agent
 * library, with anything written inline on the spec entry winning. This is where a spec stops being
 * self-contained and starts referring to the project's roster, so an unknown reference fails loudly
 * and prints the roster rather than launching a half-configured agent.
 */
/**
 * The session name a spec gets when it does not name one itself. A run is addressed by what ran and
 * when — until `agentAddress` says the run is a spawn of one known agent, and then it is addressed
 * by who.
 */
export const DEFAULT_SESSION = "{{name}}-{{run_id}}";

/**
 * The stable agent address this run should be named after, or `null` to stay run-addressed.
 *
 * A run of exactly one agent drawn from the repo's library *is* a spawn of that agent, and naming
 * the session after it is what makes `tmux ls` answer "who is running" rather than only "what ran".
 * Two cases deliberately return null. A team has no single answer. And an agent declared inline has
 * no stable id to offer — an id written into a spec file is a label local to that file, not an
 * address, and two unrelated specs both saying `id: "worker"` would collide into one name.
 */
export function agentAddress(rawSpec, context) {
  const spec = expandAgentRefs(rawSpec, context);
  if (spec.agents.length !== 1) return null;
  return spec.agents[0]._agent || null;
}

function expandAgentRefs(spec, context) {
  if (!spec.agents.some((agent) => agent.agent)) return spec;
  const dirs = context.agentDirs?.length ? context.agentDirs : agentDirs({ consumer: context.consumer, home: context.home });
  const roster = listAgentsSync(dirs);
  const taken = new Set(spec.agents.map((agent) => agent.id).filter(Boolean));
  const agents = spec.agents.map((entry, index) => {
    if (!entry.agent) return entry;
    const stored = matchAgent(roster, entry.agent);
    if (!stored) {
      const known = roster.length === 0
        ? "(none — create one with `ao-topology agent new --role <role>`)"
        : roster.map((agent) => `${agent.full_name || "(unnamed)"} [${agent.id}] — ${agent.role}`).join("\n- ");
      fail(
        "TOPOLOGY_AGENT_NOT_FOUND",
        `agents[${index}].agent references ${JSON.stringify(entry.agent)}, which is not in this repo's agent library.\nKnown agents:\n- ${known}\nSearched:\n- ${dirs.join("\n- ")}`,
        { ref: entry.agent, searched: dirs },
      );
    }
    const inline = new Set(entry._inline || []);
    const merged = { ...entry, _agent: stored.id, _agent_dir: stored._dir, full_name: stored.full_name, title: stored.title };
    for (const field of FROM_LIBRARY) {
      if (inline.has(field) || stored[field] === undefined || stored[field] === null) continue;
      merged[field] = field === "candidates" ? candidateList(stored[field]) : stored[field];
    }
    // An inline cli/model states the chain for this run, so it replaces the stored one rather than
    // being overruled by it — candidates otherwise win over cli everywhere downstream.
    if ((inline.has("cli") || inline.has("model")) && !inline.has("candidates")) delete merged.candidates;
    else if (merged.candidates?.length) {
      merged.cli = merged.candidates[0].cli;
      merged.model = merged.candidates[0].model;
    }
    merged.role = merged.role || "worker";
    if (!merged.id) merged.id = derivedAgentId(stored, taken);
    taken.add(merged.id);
    delete merged._inline;
    return merged;
  });
  const problem = orchestratorProblem(agents);
  if (problem) fail("TOPOLOGY_SPEC_INVALID", `Spec "${spec.name}" has 1 problem(s) once its agent references are resolved:\n- ${problem}`, { problems: [problem] });
  return { ...spec, agents };
}

/**
 * An agent from the repo's library runs in its OWN directory, not in the repo root. That is what
 * gives it private memory: Claude Code and its peers key their memory off the working directory, so
 * a per-agent cwd is per-agent memory with no memory layer to invent. The work tree is granted
 * separately (the launcher passes it to the adapter's add-dir mechanism) and mapped in the prompt.
 *
 * Scoped to library agents deliberately: an inline spec agent is an ad-hoc pane, not a durable
 * roster member, and the shipped templates set `spec.cwd` to a repo their agents must work in.
 * An `agent:` entry or an agent record that states its own `cwd` still wins over this default.
 */
function libraryCwd(agent, context) {
  if (!agent._agent_dir) return null;
  // A definition found outside the consumer (user config, plugin) still gets its working directory
  // inside this repo — memory is per project, and a cwd outside the repo would not survive containment.
  const dir = isInside(context.consumer, agent._agent_dir) ? agent._agent_dir : join(agentsRoot(context.consumer), String(agent._agent));
  // The launcher `cd`s here. A missing directory fails inside the pane, where nobody sees it.
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Read a file-backed system prompt. It is resolved against the stored agent's own directory when
 * the entry came from the library — that is where its `prompt.md` lives — and against the consumer
 * repo otherwise. A missing file is fatal: launching with a silently empty system prompt produces
 * an agent that looks fine and knows nothing.
 */
function readInstructionsFile(agent, context, vars) {
  const path = absolutize(agent.instructions_file, agent._agent_dir || context.consumer);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    fail(
      "TOPOLOGY_INSTRUCTIONS_FILE_NOT_FOUND",
      `agents.${agent.id}.instructions_file: cannot read ${path} (${error.code || error.message}). A file-backed system prompt must exist when the run is materialized.`,
      { path },
    );
  }
  return [renderDeep(text, vars), agent.instructions].map((part) => String(part || "").trim()).filter(Boolean).join("\n\n");
}

/** Render every placeholder in a validated spec for one concrete run. */
export function materializeSpec(rawSpec, context) {
  const spec = expandAgentRefs(rawSpec, context);
  const base = { run_id: context.runId, name: spec.name, consumer: context.consumer, home: context.home };
  // Inputs may themselves contain placeholders (a default of "{{consumer}}"); render them first.
  const vars = { ...base, inputs: renderDeep(context.inputs ?? {}, base) };
  // An explicit session from the caller wins over the template: it is how `launch` hands back a name
  // it has already probed against the live tmux server, which the template cannot do.
  const session = context.session ? slug(context.session) : slug(renderDeep(spec.session, vars));
  vars.session = session;
  const runDir = absolutize(renderDeep(spec.run_dir, vars), context.consumer);
  containPath(runDir, context.consumer, "run_dir", context);
  vars.run_dir = runDir;
  const rendered = renderDeep({ ...spec, session, run_dir: runDir }, vars);
  rendered.cwd = absolutize(rendered.cwd, context.consumer);
  containPath(rendered.cwd, context.consumer, "cwd", context);
  // Fan-out happens BEFORE the per-agent pass, so every expanded child then goes through exactly
  // the same rendering, containment and cwd resolution as a hand-written entry. Expanding afterwards
  // would mean the copies skipped checks the original passed.
  rendered.agents = expandForEach(rendered.agents, vars, context);
  rendered.agents = rendered.agents.map((agent) => {
    const agentVars = { ...vars, agent: { id: agent.id, role: agent.role } };
    const withAgent = renderDeep(agent, agentVars);
    withAgent.cwd = absolutize(withAgent.cwd ?? libraryCwd(withAgent, context) ?? rendered.cwd, context.consumer);
    containPath(withAgent.cwd, context.consumer, `agents.${agent.id}.cwd`, context);
    // A participant has no provider chain, and running the chain logic over one produced the STRING
    // "undefined" as its cli plus a candidates array to match. Nothing read it — `prepared` skips
    // participants before it gets that far — so it sat in the materialized spec looking plausible
    // and would have surfaced in the first dry-run anyone inspected.
    if (withAgent.workflow) {
      delete withAgent.cli;
      delete withAgent.model;
      delete withAgent.candidates;
      return withAgent;
    }
    // Re-parse the chain after rendering: an input may have supplied "codex:gpt-5,claude:fable".
    const chainSource = withAgent.candidates ? withAgent.candidates.map((c) => (c.model ? `${c.cli}:${c.model}` : c.cli)).join(",") : `${withAgent.cli}:${withAgent.model ?? ""}`;
    withAgent.candidates = candidateList(chainSource).filter((c) => c.cli && c.cli !== "none");
    if (withAgent.candidates.length === 0) withAgent.candidates = [{ cli: withAgent.cli, model: withAgent.model || undefined }];
    withAgent.cli = withAgent.candidates[0].cli;
    withAgent.model = withAgent.candidates[0].model;
    if (withAgent.instructions_file) withAgent.instructions = readInstructionsFile(withAgent, context, agentVars);
    return withAgent;
  });
  rendered.inputs_resolved = vars.inputs;
  rendered.run_id = context.runId;
  rendered.consumer = context.consumer;
  return rendered;
}

/** How wide a single fan-out may go before we refuse. Ten PANES was measured flat at 9.6s; ten
 * CHILDREN is ten tmux sessions and ten mailboxes, so width costs far more than depth here. */
export const MAX_FANOUT = 8;

/**
 * Expand every `for_each` participant into one entry per item.
 *
 * The item is available to that child as `{{item}}`, and as `{{item.<key>}}` when it is an object,
 * so a fan-out can pass a whole record down rather than only a string. Ids are derived from the item
 * so they are stable and readable — `per-file.src-index-js` rather than `per-file.0` — because the
 * id is what a conductor types when it wants one of them, and a positional index is a thing nobody
 * can hold in their head across a run.
 */
export function expandForEach(agents, vars, context = {}) {
  const out = [];
  for (const agent of agents) {
    if (agent.for_each === undefined) {
      out.push(agent);
      continue;
    }
    const raw = renderDeep(agent.for_each, vars);
    const items = Array.isArray(raw) ? raw : String(raw).split(",").map((item) => item.trim()).filter(Boolean);
    const max = Number.isInteger(context.maxFanout) ? context.maxFanout : MAX_FANOUT;
    if (items.length === 0) {
      fail("TOPOLOGY_FANOUT_EMPTY", `agents.${agent.id}.for_each resolved to nothing, so there is no team to launch. Give it a non-empty list, or drop the entry.`);
    }
    if (items.length > max) {
      fail("TOPOLOGY_FANOUT_TOO_WIDE", `agents.${agent.id}.for_each has ${items.length} items; the limit is ${max}. Each one is a whole tmux session and mailbox, not a pane — raise it with --max-fanout if this machine can carry it.`);
    }
    const seen = new Set();
    for (const item of items) {
      const label = slug(typeof item === "object" && item ? String(item.id ?? item.name ?? JSON.stringify(item)) : String(item));
      let id = `${agent.id}.${label}`;
      // Two items that slug to the same thing would silently collapse into one child, so the
      // collision is resolved rather than ignored — one lost reviewer is worse than an ugly id.
      let n = 2;
      while (seen.has(id)) id = `${agent.id}.${label}-${n++}`;
      seen.add(id);
      const { for_each: _dropped, ...rest } = agent;
      out.push(renderDeep({ ...rest, id, fanout_of: agent.id, fanout_item: item }, { ...vars, item }));
    }
  }
  return out;
}

/**
 * A spec may not launch outside the repo that invoked it. `cwd: "~"`, `cwd: "/"` and
 * `cwd: "../../other-repo"` all used to resolve and launch there; a spec is frequently committed to
 * a repo, so an unconstrained path is a way for a checkout to run an agent anywhere on the machine.
 * `allowOutside` exists for the deliberate case and has to be asked for explicitly.
 */
export function containPath(candidate, consumer, field, context = {}) {
  if (context.allowOutside) return candidate;
  invariant(
    isInside(consumer, candidate),
    "TOPOLOGY_PATH_ESCAPES_REPO",
    `${field} resolves to ${candidate}, which is outside this repository (${consumer}). A spec may not launch an agent outside the repo that invoked it. Pass --allow-outside if that is genuinely intended.`,
  );
  return candidate;
}

/**
 * Where workflow specs are looked for, most specific first.
 *
 * Every location is listed twice: the `workflows` name, then the `templates` name it used to have.
 * A repo that laid its specs out under the old name keeps working with no migration step and no
 * warning — the same new-then-legacy shape `consumerResourceDirs` already uses for the `.bytedesk`
 * versus `.orchestration` move. First hit wins, so a repo that has both is running the new one.
 */
export function workflowDirs({ pluginRoot, consumer, home, extra = [] }) {
  const dirs = [...extra];
  if (consumer) dirs.push(...consumerResourceDirs(consumer, "workflows"), ...consumerResourceDirs(consumer, "templates"));
  if (home) dirs.push(join(home, ".config", "agent-orchestration", "workflows"), join(home, ".config", "agent-orchestration", "templates"));
  if (pluginRoot) dirs.push(join(pluginRoot, "workflows"), join(pluginRoot, "templates", "orchestrations"));
  return dirs;
}

/** @deprecated Kept so an out-of-tree caller keeps resolving; `workflowDirs` is the name. */
export const templateDirs = workflowDirs;

export async function listWorkflows(dirs) {
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

/** Resolve `--workflow <name|path>` or `--spec <path>` to a validated spec plus its source path. */
export async function loadSpec({ workflow, template, specPath, dirs }) {
  const name = workflow ?? template;
  if (specPath) {
    const path = absolutize(specPath);
    invariant(await exists(path), "TOPOLOGY_SPEC_NOT_FOUND", `Spec file not found: ${path}`);
    return { spec: validateSpec(await readJson(path)), path };
  }
  invariant(name, "TOPOLOGY_SPEC_REQUIRED", "Pass --workflow <name> or --spec <file.json>.");
  if (name.endsWith(".json")) {
    const path = absolutize(name);
    if (await exists(path)) return { spec: validateSpec(await readJson(path)), path };
  }
  for (const dir of dirs) {
    const path = join(dir, `${name}.json`);
    if (await exists(path)) return { spec: validateSpec(await readJson(path)), path };
  }
  // The code keeps its old spelling: it is matched by name in tests, in the live harness and in at
  // least one consumer's error handling, and a rename there buys nothing a caller can use.
  fail("TOPOLOGY_TEMPLATE_NOT_FOUND", `No workflow named "${name}". Searched:\n- ${dirs.join("\n- ")}\nRun \`ao-topology workflows\` to list what exists.`);
}

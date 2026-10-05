// Configuration files. Three layers, lowest precedence first:
//
//   plugin defaults   <pluginRoot>/config.defaults.json       ships the templates; never edited
//   global            $XDG_CONFIG_HOME/agent-orchestration/config.json  (or ~/.config/...)
//   repo additions    <consumer>/.bytedesk/agent-orchestration/config.json
//
// The lead's template/provider/model, the reviewer's, reusable agent templates and the common and
// role-specific prompt files all come from here — nothing about them is hardcoded in the launcher.
// Repo files are ADDITIONS: they merge over the global layer, they do not replace it.
//
// Bad config is a first-class outcome, not an exception: a layer that does not parse or that fails
// the shape check contributes nothing and is reported in `errors`, so a refresh path can keep a
// running agent on its last-valid prompt with the error visible instead of applying half a config.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { withLock } from "./lockfile.mjs";
import { expandHome, fail, invariant, readJson, writeJson } from "./util.mjs";

export function defaultsConfigPath(pluginRoot) {
  return join(pluginRoot, "config.defaults.json");
}

export function globalConfigPath(home = homedir(), env = process.env) {
  const base = env.XDG_CONFIG_HOME || join(home, ".config");
  return join(base, "agent-orchestration", "config.json");
}

export function repoConfigPath(consumer) {
  return join(consumer, ".bytedesk", "agent-orchestration", "config.json");
}

const isPlainObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Deep-merge one layer over another. Objects merge key by key; anything else — scalars, arrays —
 * is replaced wholesale, because an array from two layers concatenated is a config nobody wrote.
 */
export function mergeConfig(base, addition) {
  if (!isPlainObject(base) || !isPlainObject(addition)) return addition === undefined ? base : addition;
  const out = { ...base };
  for (const [key, value] of Object.entries(addition)) {
    Object.defineProperty(out, key, { value: Object.hasOwn(out, key) ? mergeConfig(out[key], value) : value, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

const TEMPLATE_KEYS = new Set(["role", "cli", "candidates", "model", "prompt", "instructions", "skills", "mcp", "args", "env", "auto_approve", "reports_to", "name"]);

/**
 * TM-296. A prompt entry is a plain string — a Markdown path, appended, exactly as before — or
 * `{ "file" | "text": ..., "mode": "append" | "replace" }`. `replace` drops the same slot's text
 * from every wider layer. Returns { file, text, mode } or null for anything that is not an entry.
 */
export function promptEntry(value) {
  if (typeof value === "string") return value.trim() ? { file: value, text: null, mode: "append" } : null;
  if (!isPlainObject(value)) return null;
  return { file: typeof value.file === "string" ? value.file : null, text: typeof value.text === "string" ? value.text : null, mode: value.mode ?? "append" };
}

export const PROMPT_MODES = ["append", "replace"];

export function promptEntryErrors(value, where, { mode = true } = {}) {
  if (typeof value === "string") return value.trim() ? [] : [`${where} must be a nonempty Markdown path`];
  if (!isPlainObject(value)) return [`${where} must be a Markdown path or an object with "file" or "text"`];
  const errors = [];
  const allowed = mode ? ["file", "text", "mode"] : ["file", "text"];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) errors.push(`${where} has unknown key "${key}"`);
  const sources = ["file", "text"].filter((key) => value[key] !== undefined);
  if (sources.length !== 1) errors.push(`${where} must have exactly one of "file" or "text"`);
  else if (typeof value[sources[0]] !== "string" || !value[sources[0]].trim()) errors.push(`${where} field "${sources[0]}" must be a nonempty string`);
  if (mode && value.mode !== undefined && !PROMPT_MODES.includes(value.mode)) errors.push(`${where} field "mode" must be "append" or "replace"`);
  return errors;
}

/** Valid but ignored content, by layer: the prefix is honoured only from the global layer. */
export function layerWarnings(raw, scope, label = scope) {
  return scope !== "global" && raw?.prompts?.prefix !== undefined
    ? [`${label}: "prompts.prefix" is honoured only in the global config layer; ignored here`]
    : [];
}

/** TM-368: `management.autonomy`, lowest first. `pr` (the default) stops at the reviewed pull request,
 * `merge` integrates it, `publish` also releases it (ADR-0001 External class; the policy is the grant). */
export const AUTONOMY_LEVELS = Object.freeze(["pr", "merge", "publish"]);

/** The effective autonomy and the layer that set it, nearest layer winning; `pr` when none does. */
export function autonomyOf(loaded) {
  for (const scope of PRECEDENCE) {
    const layer = loaded.layers.find((l) => l.scope === scope && l.ok && l.present);
    const level = layer?.raw?.management?.autonomy;
    if (level !== undefined) return { level, scope, path: layer.path };
  }
  return { level: "pr", scope: "built-in", path: null };
}

/** Shape check, forgiving by design: every problem is reported, none aborts the other layers. */
export function validateConfigShape(raw, label) {
  const errors = [];
  if (!isPlainObject(raw)) return [`${label}: top level must be a JSON object`];
  for (const key of ["lead", "reviewer"]) {
    if (raw[key] === undefined) continue;
    if (!isPlainObject(raw[key])) { errors.push(`${label}: "${key}" must be an object`); continue; }
    for (const field of ["template", "provider", "model"]) {
      if (raw[key][field] !== undefined && raw[key][field] !== null && typeof raw[key][field] !== "string") {
        errors.push(`${label}: "${key}.${field}" must be a string`);
      }
    }
  }
  if (raw.templates !== undefined) {
    if (!isPlainObject(raw.templates)) errors.push(`${label}: "templates" must be an object`);
    else {
      for (const [name, template] of Object.entries(raw.templates)) {
        if (!isPlainObject(template)) { errors.push(`${label}: template "${name}" must be an object`); continue; }
        for (const field of ["role", "cli", "model", "prompt", "instructions", "reports_to", "name"]) {
          if (template[field] !== undefined && (typeof template[field] !== "string" || (field === "prompt" && !template[field].trim()))) {
            errors.push(`${label}: template "${name}.${field}" must be a nonempty path or string`);
          }
        }
        for (const key of Object.keys(template)) {
          if (!TEMPLATE_KEYS.has(key)) errors.push(`${label}: template "${name}" has unknown key "${key}"`);
        }
      }
    }
  }
  if (raw.prompts !== undefined) {
    if (!isPlainObject(raw.prompts)) errors.push(`${label}: "prompts" must be an object`);
    else if (raw.prompts.roles !== undefined && !isPlainObject(raw.prompts.roles)) {
      errors.push(`${label}: "prompts.roles" must be an object mapping role to a Markdown path`);
    } else if (raw.prompts.common_by_role !== undefined && !isPlainObject(raw.prompts.common_by_role)) {
      errors.push(`${label}: "prompts.common_by_role" must be an object mapping role to a Markdown path`);
    }
  }
  if (isPlainObject(raw.prompts)) {
    const byRole = isPlainObject(raw.prompts.common_by_role) ? Object.fromEntries(Object.entries(raw.prompts.common_by_role).map(([role, path]) => [`common_by_role.${role}`, path])) : {};
    const paths = { common: raw.prompts.common, ...byRole, ...(isPlainObject(raw.prompts.roles) ? raw.prompts.roles : {}) };
    for (const [key, value] of Object.entries(paths)) {
      if (value !== undefined) errors.push(...promptEntryErrors(value, `${label}: prompt "${key}"`));
    }
    // TM-296: the prefix is placed by position, never merged, so it takes no mode.
    if (raw.prompts.prefix !== undefined) errors.push(...promptEntryErrors(raw.prompts.prefix, `${label}: prompt "prefix"`, { mode: false }));
  }
  if (raw.management !== undefined && !isPlainObject(raw.management)) errors.push(`${label}: "management" must be an object`);
  // TM-368: how far a lead lands on its own. An unknown value never widens: the layer is rejected.
  if (isPlainObject(raw.management) && raw.management.autonomy !== undefined && !AUTONOMY_LEVELS.includes(raw.management.autonomy)) {
    errors.push(`${label}: "management.autonomy" must be one of ${AUTONOMY_LEVELS.join(", ")}`);
  }
  // TM-375: environment variable NAMES a worker inherits from whoever launches it. Never values.
  if (raw.workers !== undefined && (!isPlainObject(raw.workers) || (raw.workers.passEnv !== undefined
    && !(Array.isArray(raw.workers.passEnv) && raw.workers.passEnv.every((name) => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))))) {
    errors.push(`${label}: "workers.passEnv" must be an array of environment variable names (names only, never values)`);
  }
  // ADR-0030: `node.name` names this node in session names and as its NATS leaf node. AO_NODE_NAME wins.
  if (raw.node !== undefined && (!isPlainObject(raw.node) || (raw.node.name !== undefined && (typeof raw.node.name !== "string" || !raw.node.name.trim())))) {
    errors.push(`${label}: "node" must be an object whose "name" is a nonempty string`);
  }
  // TM-279: `nats.domain` is the hub's JetStream domain, for a leaf node whose own server runs JetStream.
  if (raw.nats !== undefined && (!isPlainObject(raw.nats) || (raw.nats.domain !== undefined && (typeof raw.nats.domain !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(raw.nats.domain))))) {
    errors.push(`${label}: "nats" must be an object whose "domain" is 1-64 letters, digits, hyphen or underscore`);
  }
  // TM-308 / ADR-0032: `nats.port` is this machine's managed NATS port, chosen once and kept.
  if (isPlainObject(raw.nats) && raw.nats.port !== undefined && !(Number.isInteger(raw.nats.port) && raw.nats.port >= 1024 && raw.nats.port <= 65535)) {
    errors.push(`${label}: "nats.port" must be an integer from 1024 to 65535`);
  }
  // TM-167: enrollment reads `enabled` from the repo layer (repo-enrollment.mjs), and a non-boolean
  // there fails closed as `enabled: false`. Reporting it here too makes the refusal visible.
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") errors.push(`${label}: "enabled" must be true or false`);
  return errors;
}

/**
 * Load and merge all three layers. Never throws on bad content: each layer reports
 * { path, scope, ok, error } and the caller decides — a refresh keeps last-valid, a fresh
 * creation may proceed on the layers that did load, and every surface can show the error.
 */
export async function loadConfig({ consumer = null, home = homedir(), pluginRoot = null, env = process.env } = {}) {
  const wanted = [
    pluginRoot ? { path: defaultsConfigPath(pluginRoot), scope: "defaults" } : null,
    { path: globalConfigPath(home, env), scope: "global" },
    consumer ? { path: repoConfigPath(consumer), scope: "repo" } : null,
  ].filter(Boolean);

  const layers = [];
  const errors = [];
  let merged = {};
  for (const layer of wanted) {
    let raw = null;
    try {
      raw = await readJson(layer.path);
    } catch (error) {
      if (error?.code === "ENOENT") {
        layers.push({ ...layer, ok: true, present: false });
        continue;
      }
      // readJson wraps parse failures in TOPOLOGY_INVALID_JSON; either way the layer is unusable.
      layers.push({ ...layer, ok: false, present: true, error: error.message });
      errors.push({ path: layer.path, scope: layer.scope, message: error.message });
      continue;
    }
    const shapeErrors = validateConfigShape(raw, layer.path);
    if (shapeErrors.length > 0) {
      layers.push({ ...layer, ok: false, present: true, error: shapeErrors.join("; ") });
      for (const message of shapeErrors) errors.push({ path: layer.path, scope: layer.scope, message });
      continue;
    }
    layers.push({ ...layer, ok: true, present: true, dir: dirname(layer.path), raw });
    merged = mergeConfig(merged, raw);
  }
  return { config: merged, layers, errors };
}

/** Highest precedence first — the order a named thing is looked up in. */
export const PRECEDENCE = ["repo", "global", "defaults"];

/**
 * Find a named template, nearest layer winning. Returns { name, template, scope, dir } or null —
 * the dir matters because the template's prompt path resolves against the layer that defined it,
 * not against wherever the lookup happens to run.
 */
export function findTemplate(layers, name) {
  if (!name) return null;
  for (const scope of PRECEDENCE) {
    const layer = layers.find((item) => item.scope === scope && item.ok && item.present);
    const templates = layer?.raw?.templates;
    const template = templates && Object.hasOwn(templates, name) ? templates[name] : null;
    if (template && typeof template === "object") {
      return { name, template, scope, dir: layer.dir ?? dirname(layer.path) };
    }
  }
  return null;
}

/**
 * A prompt path in a config file, made absolute. Relative paths resolve against the directory of
 * the config file that named them — a global config's prompts live beside it, a repo's beside its
 * own — and `~` is honoured for operators who keep prompts elsewhere.
 */
export function resolveConfigPath(value, baseDir) {
  if (typeof value !== "string" || !value) return null;
  const expanded = expandHome(value);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(baseDir, expanded);
}

/** The directory each layer's relative prompt paths resolve against, keyed by scope. */
export function layerDirs(layers) {
  const dirs = {};
  for (const layer of layers) if (layer.ok && layer.present) dirs[layer.scope] = layer.dir ?? dirname(layer.path);
  return dirs;
}

// ── Layer documents (TM-296) ─────────────────────────────────────────────────
// The gateway settings UI reads and writes config only through `ao-topology config get|set`, so
// these are the contract: the raw document of ONE layer, never the merge, and a revision that is
// the sha256 of the file's bytes so a writer can refuse to overwrite an edit it never saw.

export const ABSENT_REVISION = "absent";
export const CONFIG_SCOPES = ["global", "repo"];

export function configLayerPath(scope, { consumer = null, home = homedir(), env = process.env } = {}) {
  invariant(CONFIG_SCOPES.includes(scope), "TOPOLOGY_CONFIG_SCOPE", 'Use --scope global or --scope repo.');
  if (scope === "global") return globalConfigPath(home, env);
  invariant(consumer, "TOPOLOGY_CONFIG_SCOPE", "The repo scope needs --consumer <repo>.");
  return repoConfigPath(consumer);
}

/** { scope, path, present, revision, document, errors, warnings } — invalid JSON is reported, not thrown. */
export async function readConfigLayer(scope, options = {}) {
  const path = configLayerPath(scope, options);
  let bytes;
  try { bytes = await readFile(path); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return { scope, path, present: false, revision: ABSENT_REVISION, document: null, errors: [], warnings: [] };
  }
  const revision = createHash("sha256").update(bytes).digest("hex");
  let document;
  try { document = JSON.parse(bytes.toString("utf8")); }
  catch (error) { return { scope, path, present: true, revision, document: null, errors: [`${path} is not valid JSON: ${error.message}`], warnings: [] }; }
  return { scope, path, present: true, revision, document, errors: validateConfigShape(document, path), warnings: layerWarnings(document, scope, path) };
}

/** Validate BEFORE writing, refuse a stale revision, write atomically (temp + rename). */
export async function writeConfigLayer(scope, document, { ifRevision = null, ...options } = {}) {
  const path = configLayerPath(scope, options);
  const errors = validateConfigShape(document, path);
  invariant(errors.length === 0, "TOPOLOGY_CONFIG_INVALID", `Refusing to write ${path}: ${errors.join("; ")}`, { errors });
  return withLock(`${path}.lock`, async () => {
    const before = await readConfigLayer(scope, options);
    if (ifRevision && ifRevision !== before.revision) {
      fail("TOPOLOGY_CONFIG_STALE", `${path} changed since revision ${ifRevision}; it is now ${before.revision}. Re-read it and apply your change again.`, { expected: ifRevision, actual: before.revision });
    }
    await writeJson(path, document);
    const after = await readConfigLayer(scope, options);
    return { ok: true, scope, path, previous_revision: before.revision, revision: after.revision, warnings: after.warnings };
  });
}

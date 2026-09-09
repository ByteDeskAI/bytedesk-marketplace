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
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { expandHome, readJson } from "./util.mjs";

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
    }
  }
  if (isPlainObject(raw.prompts)) {
    const paths = { common: raw.prompts.common, ...(isPlainObject(raw.prompts.roles) ? raw.prompts.roles : {}) };
    for (const [key, value] of Object.entries(paths)) {
      if (value !== undefined && (typeof value !== "string" || !value.trim())) errors.push(`${label}: prompt "${key}" must be a nonempty Markdown path`);
    }
  }
  if (raw.management !== undefined && !isPlainObject(raw.management)) errors.push(`${label}: "management" must be an object`);
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

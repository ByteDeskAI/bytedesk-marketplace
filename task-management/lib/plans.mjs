/**
 * Plans are not a KINDS entity. The store keeps files under p.plans and an
 * `epic.plan` pointer (repo-relative path). The inbox is a derived readdir,
 * never `list("plan")` / `index.plans`.
 *
 * ExitPlanMode writes `~/.claude/plans/*.md`. The chooser uses the hook
 * payload path when that file exists, otherwise newest-mtime. Capture copies
 * into p.plans and sets epic.plan.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, extname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { parseManifest } from "./goals.mjs";
import { create, list, logEvent, now, slug, state, update, writeState } from "./store.mjs";

const URI = /^[a-zA-Z][a-zA-Z0-9+.-]+:/;

export function claudePlansDir() {
  return join(homedir(), ".claude", "plans");
}

export function relativeToRoot(abs, p) {
  const prefix = p.root.endsWith(sep) ? p.root : p.root + sep;
  if (abs.startsWith(prefix)) return abs.slice(prefix.length);
  return abs.replace(`${p.root}/`, "");
}

function resolvePlanTarget(ref, p) {
  return isAbsolute(ref) ? ref : join(p.root, ref);
}

/** True of a string that names a file rather than a plan body or Codex step list. */
function looksLikePath(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t || t.includes("\n")) return false;
  return t.includes("/") || t.endsWith(".md") || t.endsWith(".plan.json") || t.endsWith(".json");
}

/**
 * Path the ExitPlanMode payload named, or null. `tool_input.plan` is only a
 * path when it looks like one — Codex `update_plan` sends an array of steps.
 */
export function payloadPlanPath(input) {
  const ti = input?.tool_input || input?.toolInput || {};
  const tr = input?.tool_response || input?.toolResponse || {};
  const candidates = [
    ti.file_path,
    ti.filePath,
    ti.path,
    ti.plan_path,
    ti.planPath,
    ti.planFilePath,
    tr.file_path,
    tr.path,
    input?.file_path,
    input?.path,
    looksLikePath(ti.plan) ? ti.plan : null,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

/** Newest `.md` / `*.plan.json` in dir by mtime. ExitPlanMode writes the former. */
export function newestPlanFile(dir, fs = { existsSync, readdirSync, statSync }) {
  if (!dir || !fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") || f.endsWith(".plan.json"))
    .map((f) => ({ f, m: fs.statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? join(dir, files[0].f) : null;
}

/** Payload path if present and exists, else newest-mtime in dir. */
export function choosePlanSource(input, { dir, exists = existsSync, newest = newestPlanFile } = {}) {
  const hinted = payloadPlanPath(input);
  if (hinted && exists(hinted)) return hinted;
  return newest(dir);
}

function planTitle(src, text) {
  if (src.endsWith(".plan.json")) {
    const m = parseManifest(text);
    if (!m.error) return m.epicTitle || m.plan || basename(src, ".plan.json");
  }
  return (text.match(/^#\s+(.+)$/m) || [, basename(src, extname(src) || ".md")])[1];
}

function destLeaf(src, title, date) {
  const ext = src.endsWith(".plan.json") ? ".plan.json" : extname(src) || ".md";
  return `${date}-${slug(title)}${ext}`;
}

/**
 * Copy the chosen source into p.plans and point the active epic at it
 * (creating one when none is active). Returns null when there is no source.
 */
export function capturePlan(input, p, { stamp = {}, claudePlans, exists = existsSync } = {}) {
  const src = choosePlanSource(input, { dir: claudePlans ?? claudePlansDir(), exists });
  if (!src) return null;
  mkdirSync(p.plans, { recursive: true });
  const text = readFileSync(src, "utf8");
  const title = planTitle(src, text);
  const dest = join(p.plans, destLeaf(src, title, now().slice(0, 10)));
  if (!existsSync(dest)) copyFileSync(src, dest);
  const rel = relativeToRoot(dest, p);

  let epicId = state(p).activeEpic;
  let created = false;
  if (!epicId) {
    const e = create("epic", { title, plan: rel, ...stamp }, `Plan: ${rel}\n`, p);
    writeState({ activeEpic: e.id }, p);
    epicId = e.id;
    created = true;
  } else {
    update(epicId, { plan: rel }, p);
  }
  logEvent("plan_captured", { id: epicId, plan: dest }, p);
  return { src, dest, rel, epicId, created };
}

export function samePlan(a, b, p) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ra = resolvePlanTarget(a, p);
  const rb = resolvePlanTarget(b, p);
  try {
    return realpathSync(ra) === realpathSync(rb);
  } catch {
    return resolve(ra) === resolve(rb);
  }
}

function isInboxFile(name, dir) {
  if (!name || name.startsWith(".") || name.startsWith(".tm-tmp-") || name.endsWith(".tmp")) return false;
  try {
    return statSync(join(dir, name)).isFile();
  } catch {
    return false;
  }
}

/**
 * Derived inbox: files in p.plans joined with the epic that points at each.
 * Empty / missing dir → []. Unlinked files stay visible.
 */
export function listPlans(p) {
  if (!p.plans || !existsSync(p.plans)) return [];
  const names = readdirSync(p.plans).filter((f) => isInboxFile(f, p.plans)).sort();
  if (!names.length) return [];
  const epics = list("epic", {}, p);
  return names.map((name) => {
    const abs = join(p.plans, name);
    const path = relativeToRoot(abs, p);
    const linked = epics
      .filter((e) => e.plan && samePlan(e.plan, path, p))
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    return {
      path,
      name,
      ...(linked ? { linkedEpic: linked.id } : {}),
      exists: existsSync(abs),
    };
  });
}

/**
 * Absolute path the dashboard may serve, or null. Fail closed: missing ref,
 * URI, broken symlink, missing file, or a realpath outside p.plans — unless
 * that realpath is exactly a referenced epic.plan file.
 */
export function servablePlanPath(ref, p) {
  if (typeof ref !== "string" || !ref) return null;
  if (URI.test(ref)) return null;
  const target = resolvePlanTarget(ref, p);
  let file;
  try {
    file = realpathSync(target);
  } catch {
    return null;
  }
  try {
    if (!statSync(file).isFile()) return null;
  } catch {
    return null;
  }
  try {
    const dir = realpathSync(p.plans);
    if (file === dir || file.startsWith(dir + sep)) return file;
  } catch {
    /* plans/ missing — still allow an exact epic.plan hit */
  }
  for (const e of list("epic", {}, p)) {
    if (!e.plan) continue;
    try {
      if (realpathSync(resolvePlanTarget(e.plan, p)) === file) return file;
    } catch {
      /* dangling pointer is not servable */
    }
  }
  return null;
}

/** Bytes + parsed manifest when the ref is servable; null otherwise. */
export function readPlanFile(ref, p) {
  const dest = servablePlanPath(ref, p);
  if (!dest) return null;
  const content = readFileSync(dest, "utf8");
  const name = basename(dest);
  const out = { ref, name, content };
  if (name.endsWith(".plan.json")) out.manifest = parseManifest(content);
  return out;
}

/** Report-only: dangling epic.plan and unreferenced files in p.plans. */
export function planFindings(p, finding) {
  const out = [];
  const onDisk = [];
  if (p.plans && existsSync(p.plans)) {
    for (const name of readdirSync(p.plans)) {
      if (!isInboxFile(name, p.plans)) continue;
      onDisk.push(relativeToRoot(join(p.plans, name), p));
    }
  }

  const referenced = [];
  for (const e of list("epic", {}, p)) {
    if (!e.plan) continue;
    const target = resolvePlanTarget(e.plan, p);
    if (!existsSync(target)) {
      out.push(
        finding(
          "warning",
          "dangling-plan",
          e.id,
          `plan ${e.plan} is recorded but the file is gone`,
        ),
      );
      continue;
    }
    referenced.push(e.plan);
  }

  for (const rel of onDisk) {
    if (referenced.some((plan) => samePlan(plan, rel, p))) continue;
    out.push(
      finding(
        "warning",
        "unreferenced-plan",
        null,
        `${rel} is not linked from any epic.plan`,
      ),
    );
  }
  return out;
}

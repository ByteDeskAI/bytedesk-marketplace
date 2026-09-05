/**
 * Dispatch backends: the interface every worker-launcher speaks, and the registry
 * that picks one.
 *
 * A backend is `{ name, available(caps), spawn(req) }`:
 *   name           the registry key and the value recorded on the task's `dispatched`
 *   available(caps) whether this host can use it, given detectHostCaps() output
 *   spawn(req)     launch the worker; req = { task, worktree, prompt, session, actor, p }
 *                  returns { ok, run?, reason?, detail? } — `run` is a human-readable
 *                  handle for the thing that started ("tmux:tm-TM-062"), `reason` the
 *                  refusal when ok is false
 *
 * Why a registry and not a switch statement: the ORDER backends take precedence in is
 * policy, and policy belongs here, in one list. Modules are lazy-imported so a missing
 * or broken backend is simply unavailable, never a crash at import time — dispatch must
 * always reach `manual`, the floor.
 */
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "../store.mjs";
import { paths } from "../paths.mjs";

/**
 * The fallback order when config `dispatch.backends` does not say otherwise.
 *
 * ADR-0001 (agent-orchestration/docs/adr/0001-authoritative-orchestration-layer.md)
 * settles this list: `topology` is the authoritative layer for dispatched work —
 * it reuses tm's worktree, so one task means one checkout. Raw `tmux` sits beneath
 * it as the migration fallback and goes once topology passes the same contract
 * tests. `orchestration` is DEMOTED to an explicit `--backend orchestration`
 * choice for untrusted autonomous writes: it derives its own detached worktree by
 * invariant, so it costs a second checkout per task. `manual` never disappears.
 */
export const DEFAULT_ORDER = ["topology", "tmux", "orchestration", "manual"];

/** Registry: name → module specifier, imported on first use. */
const MODULES = {
  topology: "./topology.mjs",
  orchestration: "./orchestration.mjs",
  tmux: "./tmux.mjs",
  manual: "./manual.mjs",
};

/**
 * Host capabilities, tolerantly. lib/hostcaps.mjs is built in parallel with this
 * module, so a missing (or broken) file cannot be a hard dependency: it means
 * "nothing detected", i.e. every backend unavailable except the manual floor.
 */
export async function loadCaps() {
  try {
    const mod = await import("../hostcaps.mjs");
    return mod.detectHostCaps();
  } catch {
    return { backends: { manual: { available: true } } };
  }
}

/**
 * Load one backend module by name. An absent module (a typo'd config entry, a
 * retired backend still named in config) resolves to null — unavailable, not an error.
 */
export async function loadBackend(name) {
  const spec = MODULES[name];
  if (!spec) return null;
  try {
    return await import(spec);
  } catch {
    return null;
  }
}

/** Configured backend order, or the default. An empty list is a mistake, not a choice. */
export function backendOrder(p = paths()) {
  const configured = config(p).dispatch?.backends;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_ORDER;
}

/**
 * The surfaces' injection seam. A registry is a bag of functions: dispatch()
 * takes one in-process as the `registry` opt, but the CLI is a subprocess and
 * an MCP/HTTP test that wants the same fake cannot hand an object over argv or
 * a wire either. TM_DISPATCH_REGISTRY names an .mjs module whose default (or
 * named `registry`) export is that bag; every surface reads it through here so
 * all three inject identically. Unset: null, and the real registry is used.
 */
export async function envRegistry(env = process.env) {
  const spec = env.TM_DISPATCH_REGISTRY;
  if (!spec) return null;
  const mod = await import(pathToFileURL(isAbsolute(spec) ? spec : resolve(spec)).href);
  return mod.default ?? mod.registry ?? null;
}

/**
 * Pick the first backend that is present and says this host can run it.
 *
 * `requested` pins one backend by name (a `--backend tmux` flag); the fallback walk
 * is skipped — asking for one explicitly and silently getting another is how work
 * lands in a harness nobody is watching.
 *
 * `registry` and `caps` are injectable for tests: the real registry hits the
 * filesystem, the real caps probe the host.
 *
 * Returns `{ name, backend, tried }` where `tried` records why each skipped backend
 * lost — when dispatch refuses, "nothing available" without the why is useless.
 */
export async function resolveBackend({ requested = null, caps = null, registry = null, p = paths() } = {}) {
  const capsNow = caps ?? (await loadCaps());
  const names = requested ? [requested] : backendOrder(p);
  const tried = [];
  for (const name of names) {
    const mod = registry && name in registry ? registry[name] : await loadBackend(name);
    if (!mod || typeof mod.spawn !== "function") {
      tried.push({ name, reason: "module not present" });
      continue;
    }
    const usable = typeof mod.available !== "function" ? true : await mod.available(capsNow);
    if (!usable) {
      tried.push({ name, reason: "unavailable on this host" });
      continue;
    }
    return { name, backend: mod, tried };
  }
  return { name: null, backend: null, tried };
}

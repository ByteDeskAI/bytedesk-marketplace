/**
 * A fake backend registry for dispatch-surfaces.test.mjs.
 *
 * TM_DISPATCH_REGISTRY points at this file: the surfaces (CLI subprocess, MCP,
 * HTTP) import it through envRegistry() and get a backend that launches nothing
 * but reports a run, so dispatch can be exercised end to end — claim, start,
 * real worktree — without spawning a worker.
 */
const fake = {
  name: "fake",
  available: () => true,
  spawn: () => ({ ok: true, run: "fake:run-1" }),
};

export default { fake };

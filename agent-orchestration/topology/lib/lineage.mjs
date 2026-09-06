/**
 * Who launched this run, and what it launched in turn.
 *
 * Nesting already happens: an agent is a process in a pane with a shell, and `ao-topology launch` is
 * on its PATH, so a conductor that decides it wants a sub-team can simply start one. That worked
 * before this file existed — what did not work was knowing about it afterwards. The child recorded
 * no parent, the parent journalled no spawn, `stop` on the parent left the child running, and
 * nothing stopped a workflow that included itself from including itself again.
 *
 * The lineage is carried two ways on purpose, because each covers the other's blind spot:
 *
 *   - `parent` in the child's `run.json` is the durable record. It survives the process, which is
 *     what makes an orphan findable the morning after.
 *   - `AO_PARENT_*` in every agent's environment is what lets a child that nobody planned — one a
 *     model started by hand, mid-run — still record its lineage. The launcher reads its own
 *     environment, so a hand-rolled `launch` inherits the chain without being told about it.
 *
 * A run that has no parent is the root: `parent` is null and depth is 0. That is a fact worth
 * storing rather than inferring, because "no parent field" and "parent field we failed to write"
 * look identical from the outside.
 */
import { AO_HOME } from "./util.mjs";
import { join } from "node:path";

/** How deep a tree may go before we refuse. A team of teams is reasonable; four levels is a loop. */
export const MAX_DEPTH = 3;

/**
 * The lineage this process was launched with, read from the environment.
 *
 * `env` is a parameter so tests do not have to mutate `process.env`, and so a launcher can pass a
 * child's prospective environment in to compute what the child would see.
 */
export function lineageFromEnv(env = process.env) {
  const runDir = env.AO_PARENT_RUN_DIR || null;
  if (!runDir) return null;
  const depth = Number.parseInt(env.AO_RUN_DEPTH ?? "", 10);
  return {
    run_dir: runDir,
    run_id: env.AO_PARENT_RUN_ID || null,
    agent_id: env.AO_PARENT_AGENT_ID || null,
    // The depth of THIS run, not the parent's: the environment carries the value already
    // incremented, so a run reads its own depth rather than deriving it and getting it off by one.
    depth: Number.isInteger(depth) && depth >= 0 ? depth : 1,
    // The chain of workflow NAMES from the root down to and including the parent. Cycle detection
    // needs names rather than run ids, because the same workflow relaunched is the loop we care
    // about, and every relaunch has a fresh run id.
    chain: (env.AO_RUN_CHAIN || "").split(",").map((name) => name.trim()).filter(Boolean),
  };
}

/**
 * The environment a CHILD should be launched with, given this run and the agent launching it.
 *
 * Every agent gets these, not just ones we expect to nest — that is the point. An agent that starts
 * a run we did not plan for still passes the chain on, because the chain travels in the environment
 * it already has rather than in an argument someone has to remember to pass.
 */
export function childEnv({ runDir, runId, agentId, depth, chain, name }) {
  return {
    AO_PARENT_RUN_DIR: runDir,
    AO_PARENT_RUN_ID: runId,
    AO_PARENT_AGENT_ID: agentId,
    AO_RUN_DEPTH: String((Number.isInteger(depth) ? depth : 0) + 1),
    AO_RUN_CHAIN: [...(chain ?? []), name].filter(Boolean).join(","),
  };
}

/**
 * Refuse a launch that would go too deep, or that would re-enter a workflow already in its own
 * ancestry.
 *
 * Both refusals name the chain, because "too deep" without the path is a number the operator cannot
 * act on. Returns an error message or null — the caller decides which invariant code to raise, so
 * this file stays free of the CLI's error vocabulary.
 */
export function lineageRefusal({ name, lineage, maxDepth = MAX_DEPTH }) {
  if (!lineage) return null;
  const chain = lineage.chain ?? [];
  if (chain.includes(name)) {
    return `workflow "${name}" is already running in its own ancestry (${[...chain, name].join(" → ")}). A workflow that launches itself does not terminate.`;
  }
  if (lineage.depth > maxDepth) {
    return `nesting is ${lineage.depth} deep (${[...chain, name].join(" → ")}); the limit is ${maxDepth}. Raise it with --max-depth if this is genuinely intended.`;
  }
  return null;
}

/** Where a run's children are recorded, so `stop` can walk down without scanning every run. */
export function childrenFile(runDir) {
  return join(runDir, "children.json");
}

/** The runs root for a consumer — used to find orphans whose parent died before it could cascade. */
export function runsRoot(consumer) {
  return join(consumer, AO_HOME, "runs");
}

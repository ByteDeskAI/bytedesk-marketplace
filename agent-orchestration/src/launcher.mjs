/**
 * Where a run was launched from, and what launched it.
 *
 * A snapshot says what a run is doing and in which checkout, but nothing about the terminal a person
 * would have to find to watch it. A reader outside this process had to guess — match working
 * directories and label the result "likely launcher". Everything needed to stop guessing is already
 * in the launching process's environment: the gateway stamps its tab id into the tmux session it
 * owns, tmux names the pane, and `ao-topology` names the agent, its role and the run it belongs to.
 *
 * Read from the environment rather than accepted as input, deliberately. `spawn` arrives over MCP
 * from the very agent whose launcher is being recorded, so an input field would be that agent's
 * claim about itself; the environment is what the process was actually started with.
 */

import { oneLineLabel as label } from "./util.mjs";

const RUN_ID = /^run_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PATH = 1024;

/**
 * The run this process is the worker for, if it is one.
 *
 * A run spawned from inside a worker is that run's child. The worker supervisor sets this variable
 * when it starts the worker, so the link is recorded even when nobody passed a parent.
 */
export function parentRunIdFromEnv(env = process.env) {
  const id = label(env.AGENT_ORCHESTRATION_CURRENT_WORKER_RUN_ID);
  return id && RUN_ID.test(id) ? id : null;
}

/**
 * The launcher binding for a run created by this process, or null when nothing identifies one.
 *
 * Null rather than an object of nulls: "launched from somewhere we cannot name" and "launched from a
 * gateway tab whose id we failed to record" must not look the same to a reader.
 */
export function launcherBinding(env = process.env) {
  const binding = {
    kind: "unknown",
    // The gateway sets both on the tmux session backing one of its tabs; the tab id is what makes a
    // jump exact rather than a search.
    tabId: label(env.BYTEDESK_EMOTE_GATEWAY_TAB_ID),
    tabSession: label(env.BYTEDESK_EMOTE_GATEWAY_TAB_SESSION),
    tmuxPane: label(env.TMUX_PANE),
    // "/tmp/tmux-1000/default,2760865,363" — the socket, then the server pid and session id. Two
    // panes with the same id on different servers are different panes.
    tmuxServer: label(String(env.TMUX ?? "").split(",")[0]),
    // The conductor: which standing agent asked for this run, in which role and session.
    agentId: label(env.AO_AGENT_ID),
    agentRole: label(env.AO_AGENT_ROLE),
    agentSession: label(env.AO_SESSION),
    // The topology run that agent belongs to. `ao-topology` hands every agent the run it should name
    // as the parent of anything it launches, so this is the delegation link, not a guess.
    topologyRunId: label(env.AO_PARENT_RUN_ID),
    topologyRunDir: label(env.AO_PARENT_RUN_DIR, MAX_PATH),
  };
  binding.kind = binding.tabId ? "gateway-tab"
    : binding.tmuxPane ? "tmux"
    : binding.agentId ? "agent"
    : "unknown";
  return binding.kind === "unknown" ? null : binding;
}

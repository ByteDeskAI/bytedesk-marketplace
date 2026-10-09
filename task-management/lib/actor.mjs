/**
 * Who is doing the work.
 *
 * Once several agents share one board, "in progress" is only half the story — the
 * useful half is *which thread*. Claude Code doesn't hand us a name directly, so we
 * take the best signal available, in order:
 *
 *   TM_ACTOR            an agent naming itself (most reliable — set it when spawning)
 *   CLAUDE_AGENT_NAME   a named teammate, when the harness provides one
 *   otherwise           the main session
 *
 * Note what is deliberately NOT used: CLAUDE_CODE_CHILD_SESSION. It is set for
 * ordinary top-level sessions too, so inferring "subagent" from it mislabels the
 * main thread — caught by dogfooding, where this file's own author showed up as
 * `subagent:9855e3`. Opt into that guess with TM_ACTOR_INFER=1 if your setup
 * only sets it for children; a wrong name on the board is worse than a plain one.
 */
import { SESSION_ENV } from "./harness/sessions.mjs";
import { safeGitText } from "./safe-git.mjs";


const SHORT = 6;

/**
 * The session this process belongs to.
 *
 * **`CLAUDE_CODE_SESSION_ID` is the name Claude Code actually sets.** `CLAUDE_SESSION_ID` is
 * not set by anything — and every reader outside this file used to ask for that one alone, so
 * every claim, every gate and every event's `session` column resolved to `null` in production.
 * This function existed with the correct fallback all along; it just was not the thing anyone
 * called. Now it is the only place the question is answered.
 *
 * `CLAUDE_SESSION_ID` is kept, second, as a deliberate override: a wrapper, a CI job or a test
 * harness driving `tm` outside Claude Code has to be able to say who it is, and this is the name
 * this plugin has always documented for that. The real one wins when both are present, because
 * in a Claude Code session the harness is the authority on its own id.
 */
export function sessionId(env = process.env) {
  /**
   * Whichever harness we are in, by the variable it actually sets.
   *
   * The list lives in lib/harness/sessions.mjs so there is one place that knows the difference,
   * and every name in it was read off an installed CLI. `CODEX_SESSION_ID` was in this chain and
   * exists nowhere in Codex — an invented variable is worse than a missing one, because it looks
   * like support and never matches.
   */
  for (const key of SESSION_ENV) if (env[key]) return env[key];
  return null;
}

/**
 * TM-447: agent-orchestration variables a detached or cross-repo child may keep — machine
 * configuration only. Every other `AO_*` is identity or authority (AO_AGENT_ID, AO_CONSUMER,
 * AO_SESSION_*, AO_AGENT_TOKEN, AO_RUN_*, AO_REPLY_*, AO_ORCH_*, …): inherited, a pool or a
 * cross-repo write would act and mail as whichever agent happened to start it. An allowlist, so a
 * variable AO adds later is dropped until someone decides it is configuration.
 */
const AO_CONFIG = /^AO_(HOME|HOME_LEGACY|TRANSPORT|TOPOLOGY_BIN|TMUX_COMMAND|NATS_[A-Z_]+|NTFY_[A-Z_]+|SERVICES_[A-Z_]+|[A-Z_]+_MS)$/;

/**
 * Tunables that widen what agent-orchestration accepts as proof a lead is alive
 * (AO_RESPONSIVE_TTL_MS, AO_LEAD_HEARTBEAT_TTL_MS, AO_LEAD_ACK_GRACE_MS): a caller must not be
 * able to stretch "responsive" for a child that decides ownership on it.
 */
const AO_PROOF_WINDOW = /^AO_[A-Z_]*(TTL|GRACE)[A-Z_]*_MS$/;

/**
 * `env` without agent-orchestration identity — one rule for runTm children, the pool and collect's
 * lead check. TMUX_PANE goes too: `ao-topology manage` falls back to the pane's bound agent
 * (delegation.mjs bindingAgentId), so a pane id is an identity.
 */
export function withoutAoIdentity(env) {
  return Object.fromEntries(Object.entries(env).filter(([k]) => k !== "TMUX_PANE" && (!k.startsWith("AO_") || (AO_CONFIG.test(k) && !AO_PROOF_WINDOW.test(k)))));
}

export function actor(env = process.env) {
  const named = env.TM_ACTOR || env.CLAUDE_AGENT_NAME || null;
  const session = sessionId(env);
  if (named) return { thread: "teammate", name: named, session };
  if (env.TM_ACTOR_INFER && env.CLAUDE_CODE_CHILD_SESSION) {
    return { thread: "subagent", name: null, session };
  }
  return { thread: "main", name: null, session };
}

/** Short form for a board card or a log line: `main`, `@mcp`, `subagent:abcdef`. */
export function actorLabel(a = actor()) {
  if (a.thread === "teammate" && a.name) return `@${a.name}`;
  if (a.thread === "subagent") return `subagent:${(a.session || "unknown").slice(0, SHORT)}`;
  return "main";
}

function gitOut(cwd, args) {
  try {
    return safeGitText(cwd, args); // TM-443
  } catch {
    return "";
  }
}

/**
 * The four fields every write stamps: who, which session, which branch, which checkout.
 *
 * One function, because bin/tm and the dashboard each carried a copy and they had drifted — the
 * CLI recorded `HEAD` as a branch on a detached checkout, the dashboard did not. `checkout` is
 * the directory the caller is standing in (a worktree, not the store root); the caller knows it
 * and this module does not, so it is a parameter rather than a guess.
 */
export function stamp(checkout) {
  // symbolic-ref works on an unborn HEAD (just `git init -b`); rev-parse needs a commit.
  const branch = checkout
    ? gitOut(checkout, ["symbolic-ref", "--short", "HEAD"]) || gitOut(checkout, ["rev-parse", "--abbrev-ref", "HEAD"])
    : "";
  return {
    actor: actorLabel(actor()),
    session: sessionId() || undefined,
    branch: branch && branch !== "HEAD" ? branch : undefined,
    worktree: checkout || undefined,
  };
}

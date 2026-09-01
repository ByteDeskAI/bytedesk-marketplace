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
import { execFileSync } from "node:child_process";
import { SESSION_ENV } from "./harness/sessions.mjs";


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
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
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

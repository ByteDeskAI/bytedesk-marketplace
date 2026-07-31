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
  // Claude Code sets CLAUDE_CODE_SESSION_ID. Codex puts session_id on hook JSON
  // (preferred by callers that pass input through); env fallbacks cover wrappers.
  return (
    env.CLAUDE_CODE_SESSION_ID ||
    env.CLAUDE_SESSION_ID ||
    env.CODEX_THREAD_ID ||
    env.CODEX_SESSION_ID ||
    env.GROK_SESSION_ID ||
    null
  );
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

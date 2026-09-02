/**
 * Which agent CLI is running us, and where it keeps its transcript.
 *
 * Every fact in this file was read off an installed CLI rather than a doc: the env var names come
 * from the shipped binaries (`CODEX_THREAD_ID`, `GROK_SESSION_ID`), and the layouts from the
 * session files those tools had already written on this machine. `CODEX_SESSION_ID` used to sit in
 * the fallback chain and appears nowhere in Codex — an invented name is worse than no name,
 * because it reads as support and silently never matches.
 *
 * The plugin's own surfaces stay harness-agnostic; this is the one module that knows the
 * difference, which is also what makes "the work stream is unavailable here" a sentence the board
 * can say rather than a blank panel.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Claude Code: every `/` AND `.` of the cwd becomes `-`; a worktree path has dots in it. */
const claudeDir = (cwd, home) => join(home, ".claude", "projects", String(cwd).replace(/[/.]/g, "-"));

/** Grok keys sessions by percent-encoded cwd: ~/.grok/sessions/%2Fhome%2F…/<session-id>/ */
const grokDir = (cwd, home) => join(home, ".grok", "sessions", encodeURIComponent(String(cwd)));

/**
 * Kimi keys sessions by an opaque workspace id — `wd_<name>_<hash>` — that is NOT derivable
 * from the cwd. `~/.kimi-code/workspaces.json` holds the mapping (`workspaces[id].root`),
 * and `~/.kimi-code/session_index.jsonl` records sessionId → sessionDir as sessions are made.
 */
const kimiWorkspaceDir = (cwd, home) => {
  try {
    const { workspaces } = JSON.parse(readFileSync(join(home, ".kimi-code", "workspaces.json"), "utf8"));
    for (const [id, w] of Object.entries(workspaces || {})) {
      if (w?.root === String(cwd)) return join(home, ".kimi-code", "sessions", id);
    }
  } catch {
    /* no workspaces file (or unreadable) means Kimi has never opened this project here */
  }
  return null;
};

/** A session's transcript is agents/main/wire.jsonl; subagent wires are the fallback. */
const kimiWireIn = (sessionDir) => {
  const main = join(sessionDir, "agents", "main", "wire.jsonl");
  if (existsSync(main)) return main;
  return newestUnder(sessionDir, (f) => f === "wire.jsonl");
};

/**
 * Pi keys sessions by cwd like Claude, but its sanitizer is NOT Claude's: strip the
 * leading slash, turn every remaining `/`, `\` and `:` into `-`, then wrap in `--`
 * (pi 0.82.0 dist/core/session-manager.js). Dots survive — a worktree path keeps them.
 *   /home/ryan/repo → ~/.pi/agent/sessions/--home-ryan-repo--/
 * The agent dir moves with PI_CODING_AGENT_DIR; like the other harnesses we resolve the
 * default layout only.
 */
const piDir = (cwd, home) =>
  join(home, ".pi", "agent", "sessions", `--${String(cwd).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);

const newestUnder = (dir, match) => {
  if (!existsSync(dir)) return null;
  const hits = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (match(e.name)) hits.push({ full, m: statSync(full).mtimeMs });
    }
  };
  try {
    walk(dir);
  } catch {
    return null; // a directory that vanished mid-walk is simply not an answer
  }
  return hits.sort((a, b) => b.m - a.m)[0]?.full ?? null;
};

/**
 * The harnesses this plugin knows, most specific first.
 *
 * `format` is what the reader has to parse, not what the tool is called: Claude Code and Codex
 * both write JSONL and they are not the same JSONL.
 */
export const HARNESSES = [
  {
    id: "claude",
    label: "Claude Code",
    sessionEnv: ["CLAUDE_CODE_SESSION_ID", "CLAUDE_SESSION_ID"],
    format: "claude-jsonl",
    transcript(cwd, session, home = homedir()) {
      const dir = claudeDir(cwd, home);
      if (session && existsSync(join(dir, `${session}.jsonl`))) return join(dir, `${session}.jsonl`);
      return newestUnder(dir, (f) => f.endsWith(".jsonl"));
    },
  },
  {
    id: "codex",
    label: "Codex CLI",
    sessionEnv: ["CODEX_THREAD_ID"],
    format: "codex-rollout",
    // ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl — dated directories, and
    // the thread id is the tail of the filename rather than the whole of it.
    transcript(_cwd, session, home = homedir()) {
      const root = join(home, ".codex", "sessions");
      if (session) {
        const exact = newestUnder(root, (f) => f.endsWith(`${session}.jsonl`));
        if (exact) return exact;
      }
      return newestUnder(root, (f) => f.startsWith("rollout-") && f.endsWith(".jsonl"));
    },
  },
  {
    id: "grok",
    label: "Grok CLI",
    sessionEnv: ["GROK_SESSION_ID"],
    format: "grok-chat",
    transcript(cwd, session, home = homedir()) {
      const dir = grokDir(cwd, home);
      const own = session ? join(dir, session, "chat_history.jsonl") : null;
      if (own && existsSync(own)) return own;
      return newestUnder(dir, (f) => f === "chat_history.jsonl");
    },
  },
  {
    id: "kimi",
    label: "Kimi Code",
    // Empty on purpose. `env` inside a live Kimi session carries no session variable (measured
    // TM-071), and the binary's only KIMI_SESSION_ID is a `${KIMI_SESSION_ID}` placeholder
    // substituted into skill files, not a variable the CLI exports. Adding the name anyway
    // would be CODEX_SESSION_ID again: it reads as support and silently never matches. Like
    // Codex, the session id arrives on the hook payload (`session_id`), so it reaches the
    // store through TM_SESSION_ID.
    sessionEnv: [],
    format: "kimi-wire",
    // ~/.kimi-code/sessions/<workspace-id>/<session-id>/agents/<agent>/wire.jsonl — typed-event
    // JSONL (tool.call / tool.result wrapped in context.append_loop_event), one wire per agent.
    transcript(cwd, session, home = homedir()) {
      const root = join(home, ".kimi-code", "sessions");
      if (session && existsSync(root)) {
        try {
          for (const ws of readdirSync(root)) {
            const hit = kimiWireIn(join(root, ws, session));
            if (hit) return hit;
          }
        } catch {
          /* a workspace dir that vanished mid-scan is simply not an answer */
        }
      }
      const wsDir = kimiWorkspaceDir(cwd, home);
      if (!wsDir || !existsSync(wsDir)) return null;
      try {
        const sessions = readdirSync(wsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => join(wsDir, e.name))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
        for (const dir of sessions) {
          const hit = kimiWireIn(dir);
          if (hit) return hit;
        }
      } catch {
        return null;
      }
      return null;
    },
  },
  {
    id: "pi",
    label: "Pi",
    // PI_SESSION_ID is real — measured live (TM-081): pi's bash tool deletes any
    // inherited PI_* and re-sets them for the subprocess (dist/core/tools/bash.js,
    // exposeSessionEnvironment defaults to true), so a `tm` the agent runs through
    // bash sees its session. The interactive shell that LAUNCHED pi carries nothing,
    // and extensions read ctx.sessionManager.getSessionId() and pass it on the hook
    // payload instead — the Codex path (session_id → TM_SESSION_ID).
    sessionEnv: ["PI_SESSION_ID"],
    format: "pi-session",
    // ~/.pi/agent/sessions/--<cwd>--/<ISO-timestamp>_<session-uuid>.jsonl — v3 JSONL,
    // tree-linked entries (id/parentId) under a {"type":"session"} header whose id is
    // the session id, so the id is the tail of the filename like Codex's rollouts.
    transcript(cwd, session, home = homedir()) {
      const dir = piDir(cwd, home);
      if (session) {
        const exact = newestUnder(dir, (f) => f.endsWith(`_${session}.jsonl`));
        if (exact) return exact;
      }
      return newestUnder(dir, (f) => f.endsWith(".jsonl"));
    },
  },
];

export const harnessById = (id) => HARNESSES.find((h) => h.id === id) || null;

/**
 * Every session variable any known harness sets, in precedence order.
 *
 * `TM_SESSION_ID` leads: it is the deliberate override, set by a wrapper, by CI, or by the hook
 * entrypoint when a harness hands its session on the payload instead of in the environment. Codex
 * does exactly that — it passes a hook NO environment variables at all, verified by capturing one
 * (tests/fixtures/codex-pre-tool-use.json) — so without this the claim interlock, the Stop gate
 * and every event's `session` column would be null for a whole harness.
 */
export const SESSION_ENV = ["TM_SESSION_ID", ...HARNESSES.flatMap((h) => h.sessionEnv)];

/**
 * The harness running this process, by whichever session variable is set.
 *
 * Null is a real answer — a bare shell, CI, a wrapper — and callers must handle it rather than
 * assuming Claude Code, which is the assumption this whole module exists to remove.
 */
export function currentHarness(env = process.env) {
  return HARNESSES.find((h) => h.sessionEnv.some((k) => env[k])) || null;
}

/**
 * Cross-repo tickets (TM-381, TM-357, TM-359, EP-028).
 *
 * Cross-repo work is a TICKET on the target repo's own board. This module files it there, tells the
 * target's lead, wakes the target's pool, and later reports the ticket's progress back to the
 * origin task and the origin lead.
 *
 * Every write to another repo goes through THIS plugin's own `bin/tm`, run with an argv array and
 * `TM_ROOT` pointed at it: this process never opens a foreign store, and never executes code that
 * lives in one (TM-446). The other repo must be registered with agent-orchestration or be a sibling
 * of this one; anything else is refused and logged as `ticket_refused`. agent-orchestration is reached
 * only through its `ao-topology` CLI, and only when it is installed — nothing here imports it, and
 * every step that needs it degrades to "not sent, here is why" when it is absent.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { actor, actorLabel, withoutAoIdentity } from "./actor.mjs";
import { detectHostCaps } from "./hostcaps.mjs";
import { addLink } from "./issue.mjs";
import { paths } from "./paths.mjs";
import { PRIORITIES, logEvent, mutate, read, storeBoard } from "./store.mjs";

const SELF_TM = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "tm");
const STORE = join(".bytedesk", "task-management");
/** The file `runPool`'s sleep watches (lib/dispatch/pool.mjs). Same name in both places. */
export const POOL_WAKE = "pool.wake";

/** Words people use for urgency, mapped onto the store's ladder. */
const ALIASES = { critical: "highest", urgent: "highest", normal: "medium" };
export function ladderPriority(value = "medium") {
  const v = String(value).toLowerCase();
  const mapped = ALIASES[v] || v;
  if (!PRIORITIES.includes(mapped)) throw new Error(`unknown priority "${value}" — use one of: critical, ${PRIORITIES.join(", ")}`);
  return mapped;
}

const hasStore = (dir) => existsSync(join(dir, STORE));
const real = (dir) => {
  try {
    return realpathSync(dir);
  } catch {
    return resolve(dir);
  }
};

/** agent-orchestration's registered repos (its `services/repos.json`), read as a file — never imported. */
function aoRepos(env = process.env) {
  const root = env.AGENT_ORCHESTRATION_STATE_HOME
    ? resolve(env.AGENT_ORCHESTRATION_STATE_HOME)
    : join(env.XDG_STATE_HOME || join(env.HOME || homedir(), ".local", "state"), "bytedesk", "agent-orchestration");
  try {
    const repos = JSON.parse(readFileSync(join(root, "services", "repos.json"), "utf8")).repos;
    return Array.isArray(repos) ? repos.filter((r) => typeof r?.consumer === "string") : [];
  } catch {
    return [];
  }
}

/**
 * TM-446: may this module act on `dir`? Only a repo with a store that agent-orchestration has
 * registered, or a sibling of this store's repo — the same two rules resolveTarget's slugs use. A
 * path a task or a caller supplies is otherwise attacker-chosen: a worker can write any task's
 * `origin` and any directory it likes.
 */
export function knownRepo(dir, p = paths(), env = process.env) {
  if (typeof dir !== "string" || !isAbsolute(dir) || !hasStore(dir)) return false;
  const at = real(dir);
  if (aoRepos(env).some((r) => real(r.consumer) === at)) return true;
  return Boolean(p.root) && dirname(at) === dirname(real(p.root));
}

/** Log and build the refusal for a repo knownRepo turned down. */
function refuse(dir, why, p, fields = {}) {
  const reason = `refusing ${dir}: ${why} — only a repo registered with agent-orchestration or a sibling of this one`;
  logEvent("ticket_refused", { ...fields, repo: String(dir), reason }, p);
  return reason;
}

/**
 * The target repo's root, from: an explicit path; a slug in AO's repo registry; a sibling of this
 * repo with a task-management store. Ambiguity is refused — a ticket is never filed on a guess.
 */
export function resolveTarget(spec, p = paths(), env = process.env) {
  const ref = String(spec || "").trim();
  if (!ref) throw new Error("name the target repo by path or slug");
  const asPath = isAbsolute(ref) ? ref : resolve(process.cwd(), ref);
  if ((isAbsolute(ref) || ref.startsWith(".") || ref.includes("/")) && existsSync(asPath)) {
    if (!hasStore(asPath)) throw new Error(`${asPath} has no task-management store (${STORE}) to file a ticket on`);
    if (!knownRepo(asPath, p, env)) throw new Error(refuse(asPath, "not a known repo", p, { target: ref }));
    return real(asPath); // TM-446 review: run against the path that was checked, not a swappable link
  }
  const slug = ref.toLowerCase();
  const fromAo = [...new Set(aoRepos(env).filter((r) => basename(r.consumer).toLowerCase() === slug || r.key === ref).map((r) => r.consumer))].filter(hasStore);
  if (fromAo.length === 1) return fromAo[0];
  if (fromAo.length > 1) throw new Error(`"${ref}" names ${fromAo.length} registered repos (${fromAo.join(", ")}) — pass the path`);
  const parent = p.root ? dirname(p.root) : null;
  let siblings = [];
  try {
    siblings = parent ? readdirSync(parent).filter((n) => n.toLowerCase() === slug).map((n) => join(parent, n)).filter(hasStore) : [];
  } catch {
    /* unreadable parent: nothing found */
  }
  if (siblings.length === 1) return siblings[0];
  throw new Error(`no repo named "${ref}" with a task-management store (looked: agent-orchestration repos.json, siblings in ${parent ?? "(none)"}) — pass its path`);
}

/**
 * A runTm child's environment. TM_ROOT names the store; CLAUDE_PROJECT_DIR is inherited and would
 * outrank cwd; agent-orchestration identity is dropped (TM-447) — the child works for that store,
 * and `pool ensure` there would otherwise start a pool that claims and mails as the filer.
 */
export function runTmEnv(root, env = process.env) {
  const childEnv = { ...withoutAoIdentity(env), TM_ROOT: root };
  delete childEnv.CLAUDE_PROJECT_DIR;
  delete childEnv.TMUX; // no inherited tmux server: the child must not address the caller's
  return childEnv;
}

/**
 * Run THIS plugin's `tm` against another repo's store. Never the target's own launcher (TM-446):
 * `<repo>/.bytedesk/task-management/bin/tm` is a file in a directory a task or a worker chose, and
 * running it would hand this caller's environment — a lead's, a pool's — to whoever wrote it.
 */
export function runTm(root, args, { env = process.env } = {}) {
  const res = spawnSync(process.execPath, [SELF_TM, ...args], {
    cwd: root,
    env: runTmEnv(root, env),
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { ok: res.status === 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || res.error?.message || "") };
}

/** `ao-topology`, or null when agent-orchestration is not installed. `TM_TOPOLOGY_BIN=""` means absent. */
export function aoTopologyBin(env = process.env) {
  if (env.TM_TOPOLOGY_BIN !== undefined) return env.TM_TOPOLOGY_BIN && existsSync(env.TM_TOPOLOGY_BIN) ? env.TM_TOPOLOGY_BIN : null;
  try {
    return detectHostCaps().backends?.topology?.path || null;
  } catch {
    return null;
  }
}

/** AO's sender identity (session-identity.mjs callerIdentity) — all the mail needs of the caller. */
const SENDER_ENV = ["AO_AGENT_ID", "AO_CONSUMER", "AO_SESSION_AGENT_ID", "AO_SESSION_CONSUMER"];

/** `ao-topology mailbox send`'s env: a runTm child's, plus only who is sending. */
export function mailEnv(root, env = process.env) {
  const next = runTmEnv(root, env);
  for (const k of SENDER_ENV) if (env[k] !== undefined) next[k] = env[k];
  return next;
}

/** One standing mail to a repo's lead through AO's CLI. Never throws: { sent, reason?, argv? }. */
export function mailLead(repoRoot, subject, body, env = process.env) {
  const bin = aoTopologyBin(env);
  if (!bin) return { sent: false, reason: "agent-orchestration is not installed — no mail sent" };
  const argv = ["mailbox", "send", "--to-repo", repoRoot, "--subject", subject, "--body", body];
  const res = spawnSync(bin, argv, { cwd: repoRoot, env: mailEnv(repoRoot, env), encoding: "utf8", timeout: 60_000, stdio: ["ignore", "pipe", "pipe"] });
  if (res.status === 0) return { sent: true };
  // ao-topology reports refusals as {ok:false,message} on stdout (TM-153), so read both streams.
  const why = `${res.stderr || ""} ${res.stdout || ""}`.trim() || res.error?.message || `exit ${res.status}`;
  return { sent: false, reason: `ao-topology mailbox send failed: ${why.slice(0, 400)}` };
}

/**
 * Wake the target's pool: a file its sleep watches, plus `pool ensure` so a pool that idled out
 * comes back. `ensure` is a no-op when a pool is live or `dispatch.enabled` is false.
 *
 * TM-467: a dispatched worker only drops the wake file — it never STARTS a pool in another repo.
 * A same-UID worker can make any directory "known" (a sibling with a store, a line in AO's
 * repos.json); starting a pool there would run that repo's dispatch loop on the worker's say-so.
 * A live pool still sees the wake; an idle one waits for its own lead or operator. The residual
 * risk is recorded in docs/adr/0001-known-repos-are-same-uid-writable.md.
 */
export function wakePool(root, detail = {}, env = process.env) {
  try {
    writeFileSync(join(root, STORE, POOL_WAKE), `${JSON.stringify({ at: new Date().toISOString(), ...detail })}\n`);
  } catch (err) {
    return { woke: false, reason: err.message };
  }
  if (env.TM_DISPATCH_WORKER) return { woke: true, pool: "not started: a dispatched worker does not start pools in other repos (TM-467)" };
  const ensure = runTm(root, ["pool", "ensure"]);
  return { woke: true, pool: ensure.stdout.trim() || ensure.stderr.trim() };
}

/**
 * TM-450: the first word that looks like a flag, or undefined. One rule for the CLI (leftover argv)
 * and fileTicket (every caller, MCP included), so `--title "X"` never becomes a ticket titled
 * "--title X" on one surface while the other refuses it.
 */
export function strayFlag(words) {
  return words.find((w) => String(w).startsWith("--"));
}

/** TM-381 + TM-357: file the ticket, link it both ways, notify the target lead, wake the target pool. */
export function fileTicket({ target, title, priority = "medium", acceptance = [], body = "", fromTask = null, agent = null } = {}, p = paths()) {
  if (!String(title || "").trim()) throw new Error("a ticket needs a title");
  const stray = strayFlag(String(title).split(/\s+/));
  if (stray) throw new Error(`unknown option ${stray} in the title — a flag left in a title is a typo, not text`);
  const level = ladderPriority(priority);
  const root = resolveTarget(target, p);
  if (p.root && resolve(root) === resolve(p.root)) throw new Error("that is this repo — use `tm task new` for local work");
  if (fromTask && !read(fromTask, p)) throw new Error(`not found: ${fromTask}`);

  const originBoard = storeBoard(p);
  const origin = { repo: p.root, board: originBoard, task: fromTask || null, agent: agent || process.env.AO_AGENT_ID || actorLabel(actor()) };
  const from = `${originBoard}${fromTask ? `#${fromTask}` : ""}`;
  const text = [`Filed from ${from} by ${origin.agent} via \`tm ticket\`.`, String(body || "").trim()].filter(Boolean).join("\n\n");
  const acs = acceptance.flatMap((a) => ["--ac", String(a)]);

  const made = runTm(root, ["task", "new", title, "--body", text, ...acs, "--origin", JSON.stringify(origin)]);
  const id = (made.stdout.match(/^(TM-\d+)/m) || [])[1];
  if (!made.ok || !id) throw new Error(`the target refused the ticket: ${(made.stderr || made.stdout).trim()}`);
  runTm(root, ["priority", id, level]);
  let board = basename(root).toLowerCase();
  try {
    board = JSON.parse(runTm(root, ["show", id, "--json"]).stdout).board || board;
  } catch {
    /* the directory name is the fallback board id, as paths.boardId does */
  }
  const ref = `${board}#${id}`;
  if (fromTask) {
    runTm(root, ["link", id, "blocks", `${originBoard}#${fromTask}`]);
    addLink(fromTask, "blocked by", ref, p);
  }
  logEvent("ticket_filed", { id: fromTask || null, ref, priority: level }, p);

  const said = String(priority).toLowerCase();
  const mail = mailLead(
    root,
    `ticket ${id} (${said})`,
    `${ref} [${said}] ${title}\n\nFrom ${from} (${origin.agent}). Read it: .bytedesk/task-management/bin/tm show ${id}`,
  );
  const wake = wakePool(root, { id, priority: level });
  return { id, ref, root, board, priority: level, origin, mail, wake };
}

// ── TM-359: progress back to the origin ─────────────────────────────────────

/** Event kinds that finish the ticket and so clear the origin's cross-repo blocker. */
const CLEARS = new Set(["merged", "done"]);
export const EVENT_KINDS = ["pr_opened", "review", "merged", "published", "failed", "done"];

/**
 * A store event row → the origin event it means, or null. One table, used by the logEvent bridge
 * (notify-hook.mjs → `tm ticket notify`) so every surface that logs these events reports them.
 */
export function originEventFor(row = {}) {
  const pr = (s) => /^https:\/\/\S+\/pull\/\d+/.test(String(s || ""));
  if (row.event === "done") return { kind: "done", key: "done", detail: "closed on the target board" };
  if (row.event === "git_link" && pr(row.ref)) return { kind: "pr_opened", key: `pr:${row.ref}`, detail: row.ref };
  if (row.event === "task_result") {
    if (["failed", "blocked"].includes(row.outcome)) return { kind: "failed", key: `failed:${row.run ?? row.ts}`, detail: `worker ${row.outcome}` };
    if (pr(row.pr)) return { kind: "pr_opened", key: `pr:${row.pr}`, detail: row.pr };
  }
  return null;
}

/**
 * Report one progress event on a ticket to its origin: a comment on the origin task (the ORIGIN's
 * own `tm comment`), standing mail to the origin lead, and on merged/done the origin's blocker is
 * removed. Idempotent: the key is recorded on the ticket before anything is sent, so a repeat is a
 * no-op. TM-450: a ticket finishes once, so merged and done are keyed by kind alone — the bridge's
 * `done` and a manual `tm ticket event <id> done …` are the same event. And a send that reached
 * nobody (no comment landed, no mail went) gives its key back, so a retry is not a duplicate.
 */
export function notifyOrigin(id, { kind, key: given = kind, detail = "" }, p = paths()) {
  const key = CLEARS.has(kind) ? kind : given;
  const task = read(id, p);
  if (!task?.origin?.repo) return { ok: false, reason: `${id} has no origin — it was not filed with tm ticket` };
  if (!EVENT_KINDS.includes(kind)) throw new Error(`unknown event "${kind}" — use one of: ${EVENT_KINDS.join(", ")}`);
  // Before the key is recorded: a refused origin is not a reported one.
  if (!knownRepo(task.origin.repo, p)) return { ok: false, refused: true, reason: refuse(task.origin.repo, "the origin is not a known repo", p, { id, kind }) };
  let fresh = !(task.originNotified || []).includes(key);
  // Re-checked under the lock, so two notifiers racing on one event send it once.
  if (fresh) {
    mutate(id, (doc) => {
      const seen = doc.originNotified || [];
      fresh = !seen.includes(key);
      return { originNotified: [...new Set([...seen, key])] };
    }, p);
  }
  if (!fresh) return { ok: true, duplicate: true, kind, key };

  const { task: originTask } = task.origin;
  const repo = real(task.origin.repo); // the path knownRepo checked, resolved once
  const ref = `${task.board || storeBoard(p)}#${id}`;
  const line = `${ref} ${kind}${detail ? `: ${detail}` : ""}`;
  const comment = originTask ? runTm(repo, ["comment", originTask, line]) : { ok: false, stderr: "no origin task" };
  const cleared = originTask && CLEARS.has(kind) ? runTm(repo, ["link", originTask, "blocked", "by", ref, "--remove"]) : null;
  const mail = mailLead(repo, `${ref} ${kind}`, `${line}\n\n${task.title}`);
  if (!comment.ok && !mail.sent) mutate(id, (doc) => ({ originNotified: (doc.originNotified || []).filter((k) => k !== key) }), p);
  logEvent("origin_notified", { id, kind, key, comment: comment.ok, mail: mail.sent, cleared: cleared?.ok ?? null }, p);
  return { ok: true, kind, key, comment: comment.ok || comment.stderr.trim(), cleared: cleared ? cleared.ok : null, mail };
}

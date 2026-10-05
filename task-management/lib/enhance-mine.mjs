/**
 * enhance-mine — find issues, enhancements and optimisations in what already happened (TM-380).
 *
 * Sources, each reporting its own coverage so an empty run reads differently from a skipped one:
 *   transcripts  ~/.claude/projects/<sanitized project root>*\/**\/*.jsonl changed within N days
 *   board        stale in-progress tasks, and recently done tasks with no evidence
 *   pool         <store>/pool.log failure lines (optional)
 *   tests        --test-log <file> failure lines (optional)
 *
 * Findings cluster by signature (an error code, a tool error's first line, a workaround, a user
 * theme) and rank by frequency × severity × userPain. Nothing is written unless `apply` is set.
 *
 * Every string is redacted at ingestion, before any signature, sample or title is derived from it,
 * so a secret in a transcript cannot reach the report, the state file or the board.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { propose } from "./capability.mjs";
import { addComment } from "./issue.mjs";
import { list, staleTasks, writeAtomic } from "./store.mjs";

const TM_BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "tm");
const MARK = "enhance-mine:"; // stamped into filed bodies so a re-run matches by signature

// ── redaction ────────────────────────────────────────────────────────────────

const SECRET_RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[REDACTED:private-key]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED:token]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED:token]"],
  [/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[REDACTED:token]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED:aws-key]"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED:jwt]"],
  // key: value / key=value / "key": "value" where the key names a secret.
  [
    /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization)[A-Za-z0-9_.-]*)(["']?\s*[:=]\s*["']?)(?!\[REDACTED)[^\s"',;}]+/gi,
    "$1$2[REDACTED]",
  ],
  // Prose: "the password is hunter2", "pwd hunter2".
  [/\b(password|passwd|pwd)(\s+(?:is\s+|was\s+)?)(?!\[REDACTED)\S+/gi, "$1$2[REDACTED]"],
  [/\b[a-f0-9]{32,}\b/gi, "[REDACTED:hex]"],
  // ponytail: mixed-case-plus-digit runs of 40+ are treated as base64 secrets; paths survive
  // because they rarely mix all three without a '.' breaking the run.
  [/(?=[A-Za-z0-9+/_-]*\d)(?=[A-Za-z0-9+/_-]*[A-Z])(?=[A-Za-z0-9+/_-]*[a-z])[A-Za-z0-9+/_-]{40,}={0,2}/g, "[REDACTED:blob]"],
];

export function redact(text) {
  let s = String(text ?? "");
  for (const [re, to] of SECRET_RULES) s = s.replace(re, to);
  return s;
}

// ── classification ───────────────────────────────────────────────────────────

/** Uppercase codes need an underscore; env-var-shaped names are not error codes. */
const UPPER_CODE = /\b[A-Z][A-Z0-9_]{6,}\b/g;
const NOT_A_CODE = /^(CLAUDE_|TM_|GIT_|NODE_)|_(DIR|ROOT|PATH|HOME|ID|URL|FILE|ENV)$|^REDACTED/;
/** A code in a code position — `"code":"unknown_recipient"`, `code=TOPOLOGY_X`. */
const CODE_FIELD = /\bcode["']?\s*[:=]\s*["']?([A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+)/g;

const WORKAROUNDS = [
  ["tmux-send-keys", /\btmux\s+send-keys\b/],
  ["sleep", /\bsleep\s+\d/],
  ["mailbox-inbox", /\bmailbox\s+inbox\b/],
  ["capture-pane", /\bcapture-pane\b/],
];

/** First match wins. Order puts the most specific signals first. */
const USER_THEMES = [
  ["interrupted", /\[Request interrupted/i],
  ["permission-prompts", /\b(permission|approv(e|al)|prompted)\b/i],
  ["repeating-myself", /\b(again|still|already (told|said)|as i said|i said|keeps? (doing|asking))\b/i],
  ["wrong-result", /\b(wrong|incorrect|broken|doesn'?t work|not working|not what i)\b/i],
  ["slow-or-stuck", /\b(slow|hangs?|hanging|stuck|timed? ?out|takes forever)\b/i],
  ["stop-doing", /\b(don'?t|do not|stop|never)\b/i],
  ["feature-request", /\b(can you|could you|please add|i want|we need|should be able)\b/i],
];
// ponytail: a correction is short; long user messages are task briefs, not complaints.
const MAX_CORRECTION = 500;

const SEVERITY = { "error-code": 3, "tool-error": 3, pool: 3, test: 3, user: 2, board: 2, workaround: 1 };
const BUG_KINDS = new Set(["error-code", "tool-error", "pool", "test"]);

const normalizeLine = (s) =>
  s
    .toLowerCase()
    .replace(/<\/?[a-z_]+>/g, " ")
    .replace(/\S*\/\S*/g, "<path>")
    .replace(/\b[0-9a-f]{7,}\b/g, "<h>")
    .replace(/\d+/g, "<n>")
    .replace(/[^a-z<>\s_-]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(" ");

/** The first line that says something — Bash errors open with a bare "Exit code N". */
function headline(text) {
  for (const raw of text.split("\n")) {
    const line = raw.replace(/<\/?tool_use_error>/g, "").trim();
    if (line && !/^exit code \d+$/i.test(line)) return line;
  }
  return "";
}

/**
 * Codes with the line each came from (the line is the sample). In an error result an uppercase
 * code counts only on a line that reads as an error, or that it leads — so a failing command that
 * dumps a diff does not turn every constant in the source into a finding.
 */
const ERRORISH = /error|fail|refus|denied|reject|throw|invalid|not ok|✖|✗/i;
function codesIn(text, isError) {
  const out = new Map();
  for (const line of text.split("\n")) {
    for (const m of line.matchAll(CODE_FIELD)) if (!out.has(m[1])) out.set(m[1], line.trim());
    if (!isError) continue;
    for (const m of line.matchAll(UPPER_CODE)) {
      const code = m[0];
      if (out.has(code) || !code.includes("_") || NOT_A_CODE.test(code)) continue;
      if (ERRORISH.test(line) || /^\W*$/.test(line.slice(0, m.index))) out.set(code, line.trim());
    }
  }
  return [...out].map(([code, line]) => ({ code, line }));
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((b) => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("\n")
      : "";

// ── sources ───────────────────────────────────────────────────────────────────

/** `/` and `.` both become `-` — see .claude/rules/parsing-claude-jsonl.md. */
export const sanitizeCwd = (dir) => dir.replace(/[/.]/g, "-");

function jsonlFiles(dir, since, acc = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name);
    if (name.isDirectory()) jsonlFiles(full, since, acc);
    else if (name.name.endsWith(".jsonl") && statSync(full).mtimeMs >= since) acc.push(full);
  }
  return acc;
}

const SELF_REPORT = /\benhance-mine\b/;
const CODE_READ = /^\s*(?:cd [^;&|]+(?:&&|;)\s*)?(?:grep|rg|cat|sed -n|head|tail|less|git (?:diff|show|log)|gh pr diff|graft)\b/;

async function mineTranscripts(projectRoot, days, add) {
  const src = { source: "transcripts", files: 0, entries: 0, badLines: 0, findings: 0 };
  const base = join(homedir(), ".claude", "projects");
  const prefix = sanitizeCwd(projectRoot);
  const dirs = existsSync(base) ? readdirSync(base).filter((d) => d.startsWith(prefix)).map((d) => join(base, d)) : [];
  if (!dirs.length) return { ...src, skipped: `no transcript dir ~/.claude/projects/${prefix}*` };
  src.dirs = dirs.length;
  const since = Date.now() - days * 86_400_000;
  const files = dirs.flatMap((d) => jsonlFiles(d, since));
  for (const file of files) {
    src.files += 1;
    const session = basename(file, ".jsonl");
    const fallbackTs = new Date(statSync(file).mtimeMs).toISOString();
    const tools = new Map();
    const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        src.badLines += 1; // partial writes mid-flush are normal
        continue;
      }
      src.entries += 1;
      const ts = typeof e.timestamp === "string" ? e.timestamp : fallbackTs;
      const content = e.message?.content;
      const hit = (f) => {
        src.findings += 1;
        add({ ts, session, ...f });
      };
      if (e.type === "assistant" && Array.isArray(content)) {
        for (const b of content) {
          if (b?.type !== "tool_use") continue;
          const cmd = b.name === "Bash" ? String(b.input?.command || "") : "";
          tools.set(b.id, { name: b.name, cmd });
          for (const [kind, re] of WORKAROUNDS) {
            if (re.test(cmd)) hit({ kind: "workaround", key: kind, sample: cmd });
          }
        }
      } else if (e.type === "user") {
        const results = Array.isArray(content) ? content.filter((b) => b?.type === "tool_result") : [];
        for (const r of results) {
          const origin = tools.get(r.tool_use_id) || {};
          // Our own report quotes every code it found, and reading source or a diff quotes the
          // constants it defines: neither is an occurrence. Errors from those commands still count.
          if (SELF_REPORT.test(origin.cmd || "")) continue;
          if (r.is_error !== true && (origin.name === "Read" || origin.name === "Grep" || CODE_READ.test(origin.cmd || ""))) continue;
          const text = redact(textOf(r.content));
          const codes = codesIn(text, r.is_error === true);
          for (const { code, line } of codes) hit({ kind: "error-code", key: code, sample: line });
          if (r.is_error === true && !codes.length) {
            const head = headline(text);
            hit({ kind: "tool-error", key: `${origin.name || "tool"}: ${normalizeLine(head) || "(no message)"}`, sample: head });
          }
        }
        if (results.length || e.isMeta || e.isSidechain || e.toolUseResult) continue;
        const said = textOf(content).trim();
        if (!said || said.length > MAX_CORRECTION || /^(<|Caveat:)/.test(said)) continue;
        const theme = USER_THEMES.find(([, re]) => re.test(said));
        if (theme) hit({ kind: "user", key: theme[0], sample: redact(said), complaint: true });
      }
      // every other type — attachment, system, ai-title, ones not invented yet — is skipped
    }
  }
  return src;
}

function mineBoard(p, days, add) {
  const src = { source: "board", files: 0, entries: 0, findings: 0 };
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const tasks = list("task", {}, p);
  src.entries = tasks.length;
  const hit = (t, why) => {
    src.findings += 1;
    // The task's creation time, not now: a re-run sees the same evidence and comments nothing.
    add({ kind: "board", key: `${why}:${t.id}`, target: t.id, ts: t.created || "", session: "board", sample: `${t.id} ${t.title}` });
  };
  for (const t of staleTasks(p)) hit(t, "stale-in-progress");
  for (const t of tasks) {
    if (t.status === "done" && (t.updated || "") >= since && !(t.evidence || []).length) hit(t, "done-without-evidence");
  }
  return src;
}

const FAILURE_LINE = /\b(fail(ed|ure)?|error|refused|exited \d+)\b/i;

function mineLog(source, file, kind, lineRe, add) {
  const src = { source, files: 1, entries: 0, findings: 0 };
  const ts = new Date(statSync(file).mtimeMs).toISOString();
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    if (!raw.trim()) continue;
    src.entries += 1;
    if (!lineRe.test(raw)) continue;
    const line = redact(raw.trim());
    const codes = codesIn(line, true);
    src.findings += 1;
    add({ kind, key: codes[0]?.code || normalizeLine(line), ts, session: basename(file), sample: line });
  }
  return src;
}

// ── clustering ────────────────────────────────────────────────────────────────

function cluster(findings) {
  const by = new Map();
  for (const f of findings) {
    const sig = `${f.kind}:${f.key}`;
    const c = by.get(sig) || { signature: sig, kind: f.kind, key: f.key, target: f.target, count: 0, sessions: new Set(), samples: [], newest: "", tss: [] };
    c.count += 1;
    c.sessions.add(f.session);
    c.tss.push(f.ts);
    if (f.ts > c.newest) c.newest = f.ts;
    const sample = redact(f.sample || "").replace(/\s+/g, " ").slice(0, 160);
    if (sample && c.samples.length < 3 && !c.samples.includes(sample)) c.samples.push(sample);
    by.set(sig, c);
  }
  const complained = new Set(findings.filter((f) => f.complaint).map((f) => f.session));
  return [...by.values()]
    .map((c) => {
      // ponytail: userPain is a heuristic — 3 when a person said it, 2 when an error landed in a
      // session where a person also complained, else 1. Upgrade when there is a real signal.
      const userPain = c.kind === "user" ? 3 : BUG_KINDS.has(c.kind) && [...c.sessions].some((s) => complained.has(s)) ? 2 : 1;
      return { ...c, sessions: c.sessions.size, severity: SEVERITY[c.kind], userPain, score: c.count * SEVERITY[c.kind] * userPain };
    })
    .sort((a, b) => b.score - a.score || a.signature.localeCompare(b.signature));
}

// ── dedupe and filing ─────────────────────────────────────────────────────────

const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
const overlap = (a, b) => (a.size && b.size ? [...a].filter((w) => b.has(w)).length / Math.max(a.size, b.size) : 0);

function titleFor(c) {
  switch (c.kind) {
    case "error-code": return `enhance-mine: ${c.key} error recurs`;
    case "tool-error": return `enhance-mine: ${c.key.split(":")[0]} fails with "${c.key.split(": ").slice(1).join(": ")}"`;
    case "pool": return `enhance-mine: pool failure "${c.key}"`;
    case "test": return `enhance-mine: test failure "${c.key}"`;
    case "workaround": return `enhance-mine: agents work around with ${c.key}`;
    case "user": return `enhance-mine: users report ${c.key.replace(/-/g, " ")}`;
    default: return `enhance-mine: ${c.signature}`;
  }
}

function existing(c, p) {
  if (c.target) return c.target;
  const want = words(titleFor(c));
  for (const kind of ["task", "capability"]) {
    for (const d of list(kind, {}, p)) {
      const body = d.body || "";
      if (body.includes(`${MARK}${c.signature}`)) return d.id;
      // Title overlap is for hand-filed items only: mined titles share a template, so two
      // different signatures would collide on it. Those match by their stamped signature above.
      if (d.status !== "done" && d.status !== "deleted" && !body.includes(MARK) && overlap(want, words(d.title)) >= 0.7) return d.id;
    }
  }
  return null;
}

const evidenceText = (c, n) =>
  [`${n} occurrence(s) across ${c.sessions} session(s), newest ${c.newest || "unknown"}.`, ...c.samples.map((s) => `- \`${s.replace(/`/g, "'")}\``)].join("\n");

function fileTask(c, p) {
  const body = `Found by enhance-mine.\n\n${MARK}${c.signature}\n\n## Evidence\n\n${evidenceText(c, c.count)}\n`;
  const ac = [
    `\`${c.signature}\` is reproduced by a failing test or command`,
    `a 14-day enhance-mine run no longer reports \`${c.signature}\`, or the behaviour is documented as expected`,
  ];
  try {
    const outText = execFileSync("node", [TM_BIN, "task", "new", titleFor(c), "--body", body, ...ac.flatMap((a) => ["--ac", a])], {
      encoding: "utf8",
      // TM_ALLOW_DUP: dedupe already ran above, by signature. tm's title-overlap guard would
      // call TOPOLOGY_A and TOPOLOGY_B duplicates, because their titles differ only in the code.
      env: { ...process.env, TM_ROOT: p.root, TM_ALLOW_DUP: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { filed: outText.match(/\bTM-\d+/)?.[0] };
  } catch (e) {
    const why = String(e.stderr || e.message).trim();
    return { refused: why.split("\n")[0] };
  }
}

function fileCap(c, p) {
  const body = [
    "## Problem", "", `Found by enhance-mine. ${MARK}${c.signature}`, "",
    "## Evidence", "", evidenceText(c, c.count), "",
    "## Acceptance criteria", "",
    `- [ ] the need behind \`${c.signature}\` is met by a supported command or behaviour`,
    `- [ ] a 14-day enhance-mine run shows \`${c.signature}\` falling`, "",
  ].join("\n");
  const card = propose({ title: titleFor(c), area: c.kind === "user" ? "ux" : "ops", impact: c.score >= 30 ? "H" : "M", source: "enhance-mine", body }, p);
  return { filed: card.id };
}

const stateFile = (p) => join(p.base, "enhance-mine.json");
function readState(p) {
  try {
    return JSON.parse(readFileSync(stateFile(p), "utf8"));
  } catch {
    return { signatures: {} };
  }
}

/**
 * What happens to one cluster. Dry-run answers the same question without the write.
 * State per signature holds the matched/filed id and the newest evidence timestamp, so a re-run
 * with nothing newer files nothing and comments nothing.
 */
function act(c, p, st, apply) {
  const seen = st.signatures[c.signature];
  if (seen && c.newest <= seen.lastSeen) return { action: "no new evidence", id: seen.id };
  const target = seen?.id || existing(c, p);
  if (target) {
    const fresh = seen ? c.tss.filter((t) => t > seen.lastSeen).length : c.count;
    if (apply) {
      addComment(target, `enhance-mine: new evidence for \`${c.signature}\`\n\n${evidenceText(c, fresh)}`, { author: "enhance-mine", p });
      st.signatures[c.signature] = { id: target, lastSeen: c.newest };
    }
    return { action: apply ? "commented" : "would comment", id: target };
  }
  const bug = BUG_KINDS.has(c.kind);
  if (!apply) return { action: bug ? "would file task" : "would file CAP" };
  const res = bug ? fileTask(c, p) : fileCap(c, p);
  if (res.refused) return { action: "refused", reason: res.refused };
  st.signatures[c.signature] = { id: res.filed, lastSeen: c.newest };
  return { action: bug ? "filed task" : "filed CAP", id: res.filed };
}

// ── entry point ───────────────────────────────────────────────────────────────

/**
 * @param {object} o
 * @param {object} o.p            store paths
 * @param {string} [o.project]    project root whose transcripts to read (default: store root)
 * @param {number} [o.days=14]
 * @param {boolean} [o.apply]     write; otherwise dry-run
 * @param {number} [o.top=15]     clusters to act on
 * @param {number} [o.minCount=2] occurrences before a non-board cluster is acted on
 * @param {string[]} [o.testLogs]
 */
export async function mine({ p, project, days = 14, apply = false, top = 15, minCount = 2, testLogs = [] }) {
  const findings = [];
  const add = (f) => findings.push(f);
  const sources = [await mineTranscripts(project || p.root, days, add), mineBoard(p, days, add)];
  const pool = join(p.base, "pool.log");
  sources.push(existsSync(pool) ? mineLog("pool", pool, "pool", FAILURE_LINE, add) : { source: "pool", skipped: "no pool.log in the store" });
  const logs = testLogs.filter((f) => existsSync(f));
  if (!testLogs.length) sources.push({ source: "tests", skipped: "no --test-log given" });
  else if (!logs.length) sources.push({ source: "tests", skipped: `test log not found: ${testLogs.join(", ")}` });
  else for (const f of logs) sources.push(mineLog("tests", f, "test", /^\s*(not ok\b|FAIL\b|✗|✖)/, add));

  const themes = cluster(findings);
  const st = readState(p);
  let acted = 0;
  for (const c of themes) {
    if (acted >= top) break;
    if (c.kind !== "board" && c.count < minCount) continue;
    acted += 1;
    Object.assign(c, act(c, p, st, apply));
  }
  if (apply) writeAtomic(stateFile(p), `${JSON.stringify(st, null, 2)}\n`);
  for (const c of themes) delete c.tss;
  return { mode: apply ? "apply" : "dry-run", days, sources, themes };
}

export function render(r, limit = 25) {
  const lines = [`enhance-mine (${r.mode}, last ${r.days} days)`, "", "Coverage:"];
  for (const s of r.sources) {
    lines.push(
      s.skipped
        ? `  ${s.source.padEnd(12)} skipped: ${s.skipped}`
        : `  ${s.source.padEnd(12)} ${s.files} file(s), ${s.entries} entries${s.badLines ? ` (${s.badLines} bad lines)` : ""}, ${s.findings} finding(s)`,
    );
  }
  lines.push("", r.themes.length ? "Themes (score = frequency × severity × userPain):" : "Themes: none found");
  r.themes.slice(0, limit).forEach((c, i) => {
    lines.push(`  ${String(i + 1).padStart(2)}. [${c.score}] ${c.signature}  ×${c.count} in ${c.sessions} session(s)${c.action ? `  → ${c.action}${c.id ? ` ${c.id}` : ""}${c.reason ? `: ${c.reason}` : ""}` : ""}`);
    if (c.samples[0]) lines.push(`      e.g. ${c.samples[0]}`);
  });
  if (r.themes.length > limit) lines.push(`  … ${r.themes.length - limit} more (--json for all)`);
  return lines.join("\n");
}

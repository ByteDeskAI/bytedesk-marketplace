/**
 * The dispatch worker guard (TM-177).
 *
 * A dispatched worker runs unattended with --dangerously-skip-permissions: nobody is there to answer
 * a permission prompt, so the harness asks none. That is right for local work — edits, commits,
 * tests — and wrong for the two classes fleet's ADR-0001 (hierarchical authorization) says always
 * need a human: repo-destructive actions (force push, branch or tag delete, history rewrite) and
 * external ones (merge, release, deploy, secrets, outbound messages). A worker's finish line is
 * pushing its OWN branch and opening a PR; a human merges.
 *
 * This is the classifier the PreToolUse `pre-bash` hook runs, and only in a worker's environment
 * (TM_DISPATCH_WORKER). It reads a Bash command the way a shell splits it — operators, subshells,
 * substitutions, heredocs, `bash -c` and `eval` — and blocks when any command in it matches a row of
 * RULES. Quoted text is data: `echo "git push --force"` runs echo, not git.
 *
 * ponytail: a command-string classifier stops accidents and obvious moves, not an adversary. A script
 * written to disk and then run, a git alias, `find -exec` and `git rebase --exec` all pass. The
 * upgrade path is server-side: branch protection, and a token that cannot merge, deploy or delete.
 */
import { basename } from "node:path";

const PROTECTED = new Set(["main", "master"]);

// ── argument helpers ─────────────────────────────────────────────────────────

/** Words that are not options, skipping the separate-word value of each option in `valued`. */
function positionals(args, valued = []) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--") return [...out, ...args.slice(i + 1)];
    if (a.startsWith("-") && a !== "-") {
      if (valued.includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** `--name` or `--name=value` is present. */
const hasLong = (args, ...names) => args.some((a) => names.some((n) => a === n || a.startsWith(`${n}=`)));

/** A short-option cluster (`-uf`) contains one of `letters`. */
const hasShort = (args, letters) => args.some((a) => /^-[A-Za-z]+$/.test(a) && [...letters].some((l) => a.includes(l)));

/** The branch this worker may push, or null when there is none it may push. */
function ownBranch(ctx) {
  const b = ctx.branch;
  return b && b !== "HEAD" && !PROTECTED.has(b) ? b : null;
}

/** `git <sub> …` → a predicate over the words after the subcommand. */
const git = (sub, when) => (args, ctx) => args[0] === sub && when(args.slice(1), ctx);

const PUSH_VALUED = ["-o", "--push-option", "--repo", "--receive-pack", "--exec"];
/** The refspecs of a `git push` (the first positional is the remote). */
const refspecs = (args) => positionals(args, PUSH_VALUED).slice(1);

/** Every ref this push writes is the worker's own branch. A push that names none writes HEAD's. */
function pushesOnlyOwnBranch(args, ctx) {
  const own = ownBranch(ctx);
  if (!own) return false;
  const headIsOwn = ctx.head === own;
  const specs = refspecs(args);
  if (specs.length === 0) return headIsOwn;
  return specs.every((spec) => {
    const dst = (spec.includes(":") ? spec.slice(spec.indexOf(":") + 1) : spec).replace(/^refs\/heads\//, "");
    return dst === "HEAD" || dst === "@" ? headIsOwn : dst === own;
  });
}

const REBASE_VALUED = ["--onto", "-s", "--strategy", "-X", "--strategy-option", "-x", "--exec"];
/** The branch a rebase rewrites is main/master: named as `<branch>`, or checked out. */
function rebaseRewritesProtected(args, ctx) {
  return PROTECTED.has(positionals(args, REBASE_VALUED)[1] ?? ctx.head);
}

const GH_VALUED = ["-R", "--repo"];
const gh = (when) => (args) => when(positionals(args, GH_VALUED));

const GH_API_VALUED = ["-X", "--method", "-f", "-F", "--field", "--raw-field", "-H", "--header", "--input", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview", "-R", "--repo"];
const GH_API_SENSITIVE = /(^|\/)(merges?|git\/refs|releases|secrets|variables|deployments|environments|dispatches)(\/|$)/;
/** `gh api` with a writing method against merges, refs, releases, secrets, variables or deployments. */
function ghApiMutates(args) {
  let method = null;
  let body = false;
  args.forEach((a, i) => {
    if (a === "-X" || a === "--method") method = args[i + 1];
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (/^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a)) body = true;
  });
  const verb = String(method ?? (body ? "POST" : "GET")).toUpperCase();
  return verb !== "GET" && GH_API_SENSITIVE.test(positionals(args, GH_API_VALUED)[0] ?? "");
}

const WEBHOOK_HOST = /hooks\.slack\.com|discord(app)?\.com\/api\/webhooks/i;
/** curl/wget sends a body. */
function postish(args) {
  return args.some(
    (a, i) =>
      /^-[dFT]/.test(a) ||
      /^--(data|json|form|upload-file|post-data|post-file)/.test(a) ||
      /^-XPOST$/i.test(a) ||
      /^--(request|method)=POST$/i.test(a) ||
      ((a === "-X" || a === "--request" || a === "--method") && /^POST$/i.test(args[i + 1] ?? "")),
  );
}

const first = (valued, verbs) => (args) => verbs.includes(positionals(args, valued)[0]);

const HUMAN = "that needs a human. Stop at your PR";
const EXTERNAL = `an external action ${HUMAN}.`;

// ── the table ────────────────────────────────────────────────────────────────

/**
 * One row per guarded action. `tools` are command names after wrappers are stripped; `when` gets the
 * words after the tool (for git, starting at the subcommand) and the worker context; `reason` is
 * what the worker reads. The first matching row wins, so specific rows sit above general ones.
 */
export const RULES = [
  // Repo-destructive: always a human, however the worker was spawned.
  {
    id: "git-push-force",
    tools: ["git"],
    when: git("push", (a) => hasLong(a, "--force", "--force-with-lease", "--force-if-includes") || hasShort(a, "f") || refspecs(a).some((s) => s.startsWith("+"))),
    reason: `force-pushing rewrites published history, ${HUMAN}. Push without --force, --force-with-lease or a '+' refspec; if the branch diverged, integrate with a merge or a new commit.`,
  },
  {
    id: "git-push-scope",
    tools: ["git"],
    when: git("push", (a) => hasLong(a, "--all", "--mirror", "--tags", "--follow-tags", "--delete", "--prune") || hasShort(a, "d") || refspecs(a).some((s) => s.startsWith(":"))),
    reason: `--all, --mirror, --tags, --follow-tags, --prune, --delete and ':branch' refspecs push or delete refs beyond this worker's own branch, ${HUMAN}.`,
  },
  {
    id: "git-push-destination",
    tools: ["git"],
    when: git("push", (a, ctx) => !pushesOnlyOwnBranch(a, ctx)),
    reason: (ctx) =>
      ownBranch(ctx)
        ? `a dispatch worker pushes only its own branch, ${ownBranch(ctx)}, and only HEAD while that branch is checked out. Run \`git push -u origin ${ownBranch(ctx)}\` and open a PR; a human merges.`
        : "no own branch is known for this worker (TM_DISPATCH_BRANCH is unset and HEAD is not a task branch), so no push can be confirmed safe. Check out your task's tm/ branch, then push it.",
  },
  { id: "git-branch-delete", tools: ["git"], when: git("branch", (a) => hasLong(a, "--delete") || hasShort(a, "dD")), reason: `deleting a branch is repo-destructive, ${HUMAN}; branches are cleaned up after the merge.` },
  { id: "git-tag-delete", tools: ["git"], when: git("tag", (a) => hasLong(a, "--delete") || hasShort(a, "d")), reason: `deleting a tag is repo-destructive, ${HUMAN}.` },
  { id: "git-reset-hard", tools: ["git"], when: git("reset", (a) => hasLong(a, "--hard")), reason: `git reset --hard discards work irrecoverably, ${HUMAN}. Use \`git restore <path>\` for files, or a revert commit.` },
  { id: "git-filter", tools: ["git"], when: (a) => a[0] === "filter-branch" || a[0] === "filter-repo", reason: `rewriting repository history is repo-destructive, ${HUMAN}.` },
  { id: "git-rebase-protected", tools: ["git"], when: git("rebase", rebaseRewritesProtected), reason: `this rebase rewrites main/master, ${HUMAN}. Rebase your own branch instead, with it checked out: \`git rebase origin/main\`.` },
  { id: "git-update-ref-delete", tools: ["git"], when: git("update-ref", (a) => hasLong(a, "--delete") || hasShort(a, "d")), reason: `deleting a ref is repo-destructive, ${HUMAN}.` },
  {
    // The stash stack is shared by the main checkout and every worktree: drop, clear and pop can
    // destroy another session's entry. push, list, show and apply leave the stack intact.
    id: "git-stash-destroy",
    tools: ["git"],
    when: git("stash", (a) => ["drop", "clear", "pop"].includes(a[0])),
    reason: "the stash stack is shared by the main checkout and every worktree, so dropping, clearing or popping an entry can destroy another session's work. Set work aside with a temporary WIP commit on your own branch instead (`git commit -m WIP`), and undo it later with `git reset --soft HEAD~1`.",
  },

  // External: merges, releases, repository settings.
  { id: "gh-pr-merge", tools: ["gh"], when: gh(([a, b]) => a === "pr" && b === "merge"), reason: "merging is a human's call. Open or update your PR and stop there." },
  { id: "gh-release", tools: ["gh"], when: gh(([a, b]) => a === "release" && !["list", "view", "download"].includes(b)), reason: `publishing or changing a release is ${EXTERNAL}` },
  { id: "gh-repo-delete", tools: ["gh"], when: gh(([a, b]) => a === "repo" && ["delete", "archive", "rename"].includes(b)), reason: `deleting, archiving or renaming a repository is ${EXTERNAL}` },
  { id: "gh-secret", tools: ["gh"], when: gh(([a, b]) => a === "secret" && b !== "list"), reason: `changing repository secrets is ${EXTERNAL}` },
  { id: "gh-variable", tools: ["gh"], when: gh(([a, b]) => a === "variable" && ["set", "delete"].includes(b)), reason: `changing Actions variables is ${EXTERNAL}` },
  { id: "gh-api-mutation", tools: ["gh"], when: (a) => a[0] === "api" && ghApiMutates(a.slice(1)), reason: `this API call writes merges, refs, releases, secrets, variables or deployments — ${EXTERNAL}` },

  // External: deploys, infrastructure, secrets, publishing.
  { id: "wrangler", tools: ["wrangler"], when: (a) => positionals(a).some((w) => w === "deploy" || w === "publish" || w.startsWith("secret")), reason: `deploying a Worker or changing its secrets is ${EXTERNAL}` },
  {
    id: "vercel",
    tools: ["vercel"],
    // Bare `vercel` deploys too; only help and version are read-only without a subcommand.
    when: (a) => hasLong(a, "--prod") || ["deploy", "promote", "rollback"].includes(positionals(a)[0]) || (positionals(a).length === 0 && !hasLong(a, "--help", "--version") && !hasShort(a, "hv")),
    reason: `deploying to Vercel is ${EXTERNAL}`,
  },
  {
    id: "kubectl",
    tools: ["kubectl"],
    when: first(["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server"], ["apply", "delete", "create", "replace", "patch", "scale", "rollout", "edit", "drain", "set"]),
    reason: `changing a Kubernetes cluster is ${EXTERNAL}`,
  },
  { id: "helm", tools: ["helm"], when: first(["-n", "--namespace", "--kube-context", "--kubeconfig"], ["install", "upgrade", "uninstall", "delete", "rollback"]), reason: `changing a Helm release is ${EXTERNAL}` },
  { id: "terraform", tools: ["terraform", "tofu"], when: first([], ["apply", "destroy"]), reason: `applying or destroying infrastructure is ${EXTERNAL}` },
  { id: "flyctl", tools: ["flyctl", "fly"], when: first([], ["deploy", "secrets"]), reason: `deploying to Fly or changing its secrets is ${EXTERNAL}` },
  { id: "infisical", tools: ["infisical"], when: (a) => ["secrets", "secret"].includes(positionals(a)[0]) && ["set", "delete"].includes(positionals(a)[1]), reason: `changing secrets is ${EXTERNAL}` },
  { id: "package-publish", tools: ["npm", "pnpm", "yarn", "bun", "cargo"], when: (a) => positionals(a).some((w) => w === "publish" || w === "unpublish"), reason: `publishing a package is ${EXTERNAL}` },
  { id: "docker-push", tools: ["docker", "podman"], when: (a) => { const [x, y] = positionals(a, ["-H", "--host", "--context", "-c", "--config", "-l", "--log-level"]); return x === "push" || (x === "image" && y === "push"); }, reason: `pushing an image to a registry is ${EXTERNAL}` },
  { id: "hosting-deploy", tools: ["firebase", "netlify"], when: first([], ["deploy"]), reason: `deploying a site is ${EXTERNAL}` },

  // External: outbound messages.
  { id: "outbound-webhook", tools: ["curl", "wget"], when: (a) => a.some((w) => WEBHOOK_HOST.test(w)) || (postish(a) && a.some((w) => /slack|discord|webhook/i.test(w))), reason: `posting to a chat webhook sends an outbound message, ${HUMAN}.` },
  { id: "outbound-mail", tools: ["sendmail", "mail", "mailx"], when: () => true, reason: `sending mail is an outbound message, ${HUMAN}.` },
];

/** What an unreadable command must mention before the guard refuses it rather than letting it run. */
const FAIL_SAFE = /\bgit\b[^\n;&|]*\bpush\b|\bgh\b|\b(wrangler|vercel|kubectl|helm|terraform|tofu|flyctl|fly|infisical|firebase|netlify|sendmail)\b/i;

// ── reading the shell ────────────────────────────────────────────────────────

/** Read one heredoc body starting at `i`; attach it to its command; return where reading resumes. */
function heredoc(src, i, { delim, strip, cmd }) {
  const lines = [];
  while (i < src.length) {
    const nl = src.indexOf("\n", i) < 0 ? src.length : src.indexOf("\n", i);
    const line = src.slice(i, nl);
    i = nl + 1;
    if ((strip ? line.replace(/^\t+/, "") : line) === delim) break;
    lines.push(line);
  }
  cmd.bodies.push(lines.join("\n"));
  return Math.min(i, src.length);
}

/**
 * Split `src` into simple commands the way a shell would, appending `{ words, bodies }` to `out`.
 * Substitutions and subshells run, so their commands are appended too. `bodies` holds heredoc and
 * here-string input. Returns `{ end, ok }` — where reading stopped, and false when the text cannot
 * be read with confidence (an unterminated quote, substitution or group).
 *
 * ponytail: close enough to POSIX sh for what an agent types; `case` patterns, `$'…'` escapes and
 * arithmetic are approximated. A misread that hides a guarded tool is covered by FAIL_SAFE only
 * when the text is flagged unreadable.
 */
function read(src, i, out, closer) {
  let cmd = { words: [], bodies: [] };
  let word = null; // null: no word in progress; "" is a real (empty, quoted) word
  let target = null; // "drop" (a redirection target) | "body" (a here-string) — what the next word is for
  let parens = 0;
  let ok = true;
  const pending = [];

  const endWord = () => {
    if (word === null) return;
    if (target === "body") cmd.bodies.push(word);
    else if (target === null) cmd.words.push(word);
    target = null;
    word = null;
  };
  const endCmd = () => {
    endWord();
    target = null;
    if (cmd.words.length || cmd.bodies.length) out.push(cmd);
    cmd = { words: [], bodies: [] };
  };
  /** Read a nested `$(…)` or backtick body starting at `from`; returns the index after its closer. */
  const nested = (from, close) => {
    const r = read(src, from, out, close);
    if (!r.ok) ok = false;
    return r.end;
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      if (src[i + 1] !== "\n") word = (word ?? "") + (src[i + 1] ?? "");
      i += 2;
    } else if (c === "'" || (c === "$" && src[i + 1] === "'")) {
      const open = c === "$" ? i + 1 : i;
      const close = src.indexOf("'", open + 1);
      if (close < 0) return { end: src.length, ok: false };
      word = (word ?? "") + src.slice(open + 1, close);
      i = close + 1;
    } else if (c === '"') {
      word = word ?? "";
      i++;
      for (;;) {
        if (i >= src.length) return { end: src.length, ok: false };
        const d = src[i];
        if (d === '"') {
          i++;
          break;
        }
        if (d === "\\") {
          word += src[i + 1] ?? "";
          i += 2;
        } else if (d === "$" && src[i + 1] === "(") {
          const end = nested(i + 2, ")");
          word += src.slice(i, end);
          i = end;
        } else if (d === "`") {
          const end = nested(i + 1, "`");
          word += src.slice(i, end);
          i = end;
        } else {
          word += d;
          i++;
        }
      }
    } else if (c === "$" && src[i + 1] === "(") {
      const end = nested(i + 2, ")");
      word = (word ?? "") + src.slice(i, end);
      i = end;
    } else if (c === "$" && src[i + 1] === "{") {
      const close = src.indexOf("}", i);
      if (close < 0) return { end: src.length, ok: false };
      word = (word ?? "") + src.slice(i, close + 1);
      i = close + 1;
    } else if (c === "`") {
      if (closer === "`") {
        endCmd();
        return { end: i + 1, ok: ok && parens === 0 };
      }
      const end = nested(i + 1, "`");
      word = (word ?? "") + src.slice(i, end);
      i = end;
    } else if (c === "#" && word === null) {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === " " || c === "\t" || c === "\r") {
      endWord();
      i++;
    } else if (c === "\n") {
      endCmd();
      i++;
      for (const h of pending.splice(0)) i = heredoc(src, i, h);
    } else if (c === ";" || c === "|" || (c === "&" && src[i + 1] !== ">")) {
      endCmd();
      i++;
    } else if (c === "(") {
      endCmd();
      parens++;
      i++;
    } else if (c === ")") {
      endCmd();
      i++;
      if (parens > 0) parens--;
      else if (closer === ")") return { end: i, ok };
      // otherwise a `case` pattern's `)`: nothing to close
    } else if ((c === "<" || c === ">") && src[i + 1] === "(") {
      endWord();
      i = nested(i + 2, ")"); // process substitution: its commands run
    } else if (c === "<" || c === ">" || c === "&") {
      // A redirection (`&` only reaches here as `&>`). A word of bare digits before it is the fd.
      if (word !== null && /^\d+$/.test(word)) word = null;
      else endWord();
      if (src.startsWith("<<<", i)) {
        i += 3;
        target = "body";
      } else if (src.startsWith("<<", i)) {
        i += 2;
        const strip = src[i] === "-";
        if (strip) i++;
        while (src[i] === " " || src[i] === "\t") i++;
        let delim = "";
        while (i < src.length && !/[\s;&|()<>]/.test(src[i])) {
          const q = src[i];
          if (q === "'" || q === '"') {
            const close = src.indexOf(q, i + 1);
            if (close < 0) return { end: src.length, ok: false };
            delim += src.slice(i + 1, close);
            i = close + 1;
          } else {
            delim += q === "\\" ? (src[++i] ?? "") : q;
            i++;
          }
        }
        pending.push({ delim, strip, cmd });
      } else {
        i++;
        while (i < src.length && ">&|".includes(src[i])) i++;
        if (src[i - 1] === "&" && /[\d-]/.test(src[i] ?? "")) {
          while (/[\d-]/.test(src[i] ?? "")) i++; // >&1, 2>&-: an fd, not a file
        } else {
          target = "drop";
        }
      }
    } else {
      word = (word ?? "") + c;
      i++;
    }
  }
  endCmd();
  return { end: src.length, ok: ok && parens === 0 && closer === null };
}

// ── from words to a command ──────────────────────────────────────────────────

const KEYWORDS = new Set(["!", "{", "}", "then", "do", "else", "elif", "if", "while", "until", "time", "coproc"]);
const NOT_RUN = new Set(["for", "case", "select", "function", "in", "esac", "done", "fi"]);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh"]);
/** Commands that run the command after them, and their options that take a value. */
const WRAPPERS = {
  sudo: ["-u", "-g", "-h", "-p", "-C", "-D", "-U"],
  doas: ["-u"],
  env: ["-u", "-C", "--unset", "--chdir"],
  nohup: [],
  exec: ["-a"],
  command: [],
  builtin: [],
  nice: ["-n"],
  ionice: ["-c", "-n"],
  stdbuf: [],
  chronic: [],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  xargs: ["-I", "-n", "-P", "-L", "-d", "-s", "-E", "-a"],
  npx: ["-p", "--package"],
  bunx: [],
  pnpx: [],
};

/**
 * Strip keywords, assignments and wrappers off a command's words. Returns one of:
 *   null                        — nothing runs (a keyword line, a `for` header)
 *   { scripts: [src…] }         — a shell or eval running source text
 *   { stdinShell: true }        — a shell reading its script from stdin (heredoc bodies)
 *   { unknown: text }           — the command name is an expansion; it cannot be known
 *   { tool, args, elsewhere }   — a command; `elsewhere` when git is pointed at another checkout
 */
function unwrap(words) {
  const w = [...words];
  for (let pass = 0; pass < 16; pass++) {
    while (w.length && (KEYWORDS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w.shift();
    if (!w.length || NOT_RUN.has(w[0])) return null;
    if (/[$`]/.test(w[0])) return { unknown: w.join(" ") };
    const name = basename(w[0]);
    if (name in WRAPPERS) {
      w.shift();
      while (w.length && w[0].startsWith("-") && w[0] !== "--") {
        if (WRAPPERS[name].includes(w.shift())) w.shift();
      }
      if (w[0] === "--") w.shift();
      if (name === "timeout") w.shift(); // the duration
      continue;
    }
    if (["npm", "pnpm", "yarn"].includes(name) && ["exec", "dlx"].includes(w[1])) {
      w.splice(0, 2);
      while (w.length && w[0].startsWith("-")) w.shift();
      continue;
    }
    if (SHELLS.has(name)) {
      const at = w.findIndex((a, k) => k > 0 && /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
      if (at < 0) return { stdinShell: true };
      const script = w.slice(at + 1).find((a) => !a.startsWith("-"));
      return { scripts: script === undefined ? [] : [script] };
    }
    if (name === "eval") return { scripts: [w.slice(1).join(" ")] };
    if (name.startsWith("git-")) return { tool: "git", args: [name.slice(4), ...w.slice(1)], elsewhere: false };
    if (name === "git") {
      let k = 1;
      let elsewhere = false;
      while (k < w.length && w[k].startsWith("-")) {
        const a = w[k];
        if (a === "-C" || a === "--git-dir" || a === "--work-tree") {
          elsewhere = true;
          k += 2;
        } else if (a === "-c" || a === "--namespace" || a === "--config-env") {
          k += 2;
        } else {
          if (/^--(git-dir|work-tree)=/.test(a)) elsewhere = true;
          k++;
        }
      }
      return { tool: "git", args: w.slice(k), elsewhere };
    }
    return { tool: name, args: w.slice(1), elsewhere: false };
  }
  return { unknown: w.join(" ") };
}

// ── the verdict ──────────────────────────────────────────────────────────────

const ALLOW = Object.freeze({ allow: true, reason: null, rule: null });
const block = (rule, reason) => ({ allow: false, reason, rule });
const UNREADABLE = (what) => block("unparsed", `${what} cannot be read with confidence and it mentions git push, gh or a deploy/secret tool, so it is refused rather than guessed at. Run the guarded command on its own, spelled out.`);

function check(src, ctx, depth) {
  if (depth > 8) return FAIL_SAFE.test(src) ? UNREADABLE("a command nested this deeply") : ALLOW;
  const commands = [];
  const { ok } = read(src, 0, commands, null);
  for (const { words, bodies } of commands) {
    const cmd = unwrap(words);
    if (!cmd) continue;
    const scripts = cmd.scripts ?? (cmd.stdinShell ? bodies : null);
    if (scripts) {
      for (const script of scripts) {
        const verdict = check(script, ctx, depth + 1);
        if (!verdict.allow) return verdict;
      }
      continue;
    }
    if (cmd.unknown !== undefined) {
      if (FAIL_SAFE.test(cmd.unknown)) return UNREADABLE(`\`${cmd.unknown}\` runs a command named by an expansion, which`);
      continue;
    }
    const here = cmd.elsewhere ? { ...ctx, head: null } : ctx;
    for (const rule of RULES) {
      if (rule.tools.includes(cmd.tool) && rule.when(cmd.args, here)) {
        return block(rule.id, typeof rule.reason === "function" ? rule.reason(here) : rule.reason);
      }
    }
  }
  if (!ok && FAIL_SAFE.test(src)) return UNREADABLE("this command");
  return ALLOW;
}

/**
 * Classify one Bash command for a dispatch worker.
 *
 * `branch` is the worker's own branch (pinned at spawn as TM_DISPATCH_BRANCH); `head` is the branch
 * checked out where the command runs, when known. Returns `{ allow, reason, rule }` — `rule` is the
 * RULES id that blocked, or "unparsed" for the fail-safe.
 */
export function guardCommand(command, { branch = null, head = branch } = {}) {
  return check(String(command ?? ""), { branch: branch || null, head: head || null }, 0);
}

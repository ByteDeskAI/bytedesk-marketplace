/**
 * The dispatch worker guard (TM-177).
 *
 * A dispatched worker runs unattended with --dangerously-skip-permissions: nobody is there to answer
 * a permission prompt, so the harness asks none. That is right for local work — edits, commits,
 * tests — and wrong for the two classes fleet's ADR-0001 (hierarchical authorization) says always
 * need a human: repo-destructive actions (force push, branch or tag delete, history rewrite) and
 * external ones (release, deploy, secrets, outbound messages, merging anyone else's PR). A worker's finish line is
 * pushing its OWN branch and opening a PR. TM-481: a governed worker stops there — merging is the
 * lead's landing path after the independent review; an ungoverned one may also merge that PR, without
 * --admin, once every required check has passed.
 *
 * This is the classifier the PreToolUse `pre-bash` hook runs, and only for a dispatch worker — decided
 * by recorded dispatch ancestry or the TM_DISPATCH_WORKER marker (./worker-identity.mjs). It reads a Bash command the way a shell splits it — operators, subshells,
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

/** TM-481: every -R/--repo spelling — `-R x`, `-Rx`, a cluster ending in R, `--repo x`, `--repo=x`. */
const hasRepoOption = (args) => args.some((a) => a === "--repo" || a.startsWith("--repo=") || /^-[A-Za-z]*R/.test(a));

const MERGE_VALUED = ["-b", "--body", "-F", "--body-file", "-t", "--subject", "--match-head-commit", "-A", "--author-email"];
/** `gh … pr merge …`, whatever the flags around it. */
const isPrMerge = (args) => {
  const [sub, verb] = positionals(args, [...GH_VALUED, ...MERGE_VALUED]);
  return sub === "pr" && verb === "merge";
};

/**
 * TM-481 H2: gh's own top-level commands (gh 2.100 `gh help`). Anything else — an extension, a user
 * alias such as the default `co`, `copilot`, `skill` — runs code this table cannot see.
 */
const GH_KNOWN = new Set([
  "auth", "browse", "codespace", "discussion", "gist", "issue", "org", "pr", "project", "release", "repo", "cache", "run",
  "workflow", "agent-task", "alias", "api", "attestation", "completion", "config", "gpg-key", "label", "licenses", "preview",
  "ruleset", "search", "secret", "ssh-key", "status", "variable", "help", "version",
  "accessibility", "actions", "environment", "exit-codes", "formatting", "mintty", "reference", "telemetry",
]);

/** TM-481 H1: a `gh api` endpoint or body field whose text is an expansion or percent-encoded. */
function ghApiTainted(args) {
  const values = [positionals(args, GH_API_VALUED)[0] ?? ""];
  args.forEach((a, i) => {
    if (["-f", "-F", "--field", "--raw-field"].includes(a)) values.push(String(args[i + 1] ?? ""));
    else if (/^--(field|raw-field)=/.test(a)) values.push(a.slice(a.indexOf("=") + 1));
    else if (/^-[fF]./.test(a)) values.push(a.slice(2));
  });
  return values.some((v) => /[$%`]/.test(v));
}

const XARGS_VALUED = ["-I", "-i", "-n", "-P", "-L", "-l", "-d", "-s", "-E", "-e", "-a", "--arg-file", "--delimiter", "--max-args", "--max-procs", "--replace"];

/** TM-481 H1: interpreters whose inline code (`-c`, `-e`, `--eval`, …) or stdin script is inspected. */
const INTERPRETERS = ["python", "python2", "python3", "node", "nodejs", "perl", "ruby", "bun", "deno", "php", "lua", "tclsh", "Rscript", "osascript", "awk", "gawk", "mawk", "nawk"];
const CODE_FLAGS = ["-c", "-e", "-E", "--eval", "-p", "--print", "-r", "--exec"];
/** Code that runs gh, pushes, or spawns a process at all — a spawn can build any command name. */
const RUNS_GUARDED = /\bgh\b|\bgit\b[\s\S]*\bpush\b|child_process|subprocess|\bos\.(system|exec|spawn|popen)|popen|\bsystem\s*\(|\bexec\w*\s*\(|\bspawn\w*\s*\(|\bBun\.\$|Deno\.(run|Command)|\bqx\b/;
/** In these, a backtick runs a shell command (in JS it is only a template string). */
const BACKTICK_RUNS = new Set(["perl", "ruby", "php"]);

/** The inline code an interpreter call runs: flagged code, awk's program, `deno eval`, or a stdin script. */
function interpreterCode(tool, args, bodies = []) {
  const code = [];
  args.forEach((a, i) => {
    if (CODE_FLAGS.includes(a) || /^-[A-Za-z]*[ceEp]$/.test(a)) code.push(String(args[i + 1] ?? ""));
    else if (/^--(eval|print|exec)=/.test(a)) code.push(a.slice(a.indexOf("=") + 1));
    else if (/^-[ceE]./.test(a)) code.push(a.slice(2));
  });
  const pos = positionals(args, ["-f", "-F", "-v", "-I", "-m", "-W", "--import", "--require", "-r", ...CODE_FLAGS]);
  if (tool === "deno" && pos[0] === "eval") code.push(pos.slice(1).join(" "));
  if (/awk$/.test(tool) && pos[0] !== undefined && !hasShort(args, "f")) code.push(pos[0]); // awk's program text
  if (!code.length && (pos.length === 0 || pos[0] === "-")) code.push(...bodies); // a script on stdin
  return code;
}

/** Commands that may take the word `gh` as an argument without running it. */
const READS_GH = new Set(["echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "which", "type", "whereis", "man", "info", "cat", "less", "head", "tail", "wc", "ls", "test", "[", "tm", "apropos", "hash"]);

/** TM-481: a GraphQL call that names a merge mutation, or whose query this guard cannot read. */
const graphqlMayMerge = (args) =>
  args.some((a) => /mergePullRequest|enablePullRequestAutoMerge/i.test(a) || /^--input(=|$)/.test(a) || a.includes("=@") || /\$\(|`|\$\{/.test(a));

/** The value of a `--name value` / `--name=value` / `-x value` option; the last occurrence wins. */
function optionValue(args, names) {
  let val;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (names.includes(a)) {
      val = args[i + 1];
      i++;
      continue;
    }
    const eq = names.find((n) => n.startsWith("--") && a.startsWith(`${n}=`));
    if (eq) val = a.slice(eq.length + 1);
  }
  return val;
}

/** The PR base this worker must open against (pinned at spawn as TM_DISPATCH_INTEGRATION_BRANCH), or null when unknown. */
const ownBase = (ctx) => ctx.integrationBranch || null;

const GH_API_VALUED = ["-X", "--method", "-f", "-F", "--field", "--raw-field", "-H", "--header", "--input", "-q", "--jq", "-t", "--template", "--hostname", "--cache", "-p", "--preview", "-R", "--repo"];
const GH_API_SENSITIVE = /(^|\/)(merges?|git\/refs|releases|secrets|variables|deployments|environments|dispatches)(\/|\?|$)/;
const GH_API_PULLS = /(^|\/)repos\/[^/]+\/[^/]+\/pulls(\/\d+)?(\?|$)/;

/** Read a `gh api` call: its HTTP verb (gh defaults to POST once a body field is given), endpoint, body field names, and whether a body file was passed. */
function ghApiRequest(args) {
  let method = null;
  const fields = [];
  let input = false;
  args.forEach((a, i) => {
    if (a === "-X" || a === "--method") method = args[i + 1];
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (["-f", "-F", "--field", "--raw-field"].includes(a)) fields.push(String(args[i + 1] ?? "").split("=")[0]);
    else if (/^--(field|raw-field)=/.test(a)) fields.push(a.slice(a.indexOf("=") + 1).split("=")[0]);
    else if (/^--input(=|$)/.test(a)) input = true;
  });
  const verb = String(method ?? (fields.length || input ? "POST" : "GET")).toUpperCase();
  return { verb, endpoint: positionals(args, GH_API_VALUED)[0] ?? "", fields, input };
}

/** `gh api` with a writing method against merges, refs, releases, secrets, variables or deployments. */
function ghApiMutates(args) {
  const { verb, endpoint } = ghApiRequest(args);
  return verb !== "GET" && GH_API_SENSITIVE.test(endpoint);
}

/**
 * `gh api` creating or patching a pull request with a `base` field — the raw-API way to open or
 * retarget a PR off the integration branch. A body file (`--input`) cannot be read here, so it
 * counts as carrying one.
 */
function ghApiSetsPrBase(args) {
  const { verb, endpoint, fields, input } = ghApiRequest(args);
  return verb !== "GET" && GH_API_PULLS.test(endpoint) && (input || fields.includes("base"));
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
        ? `a dispatch worker pushes only its own branch, ${ownBranch(ctx)}, and only HEAD while that branch is checked out. Run \`git push -u origin ${ownBranch(ctx)}\` and open a PR.`
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

  {
    // TM-481 H2: gh resolves which repository a bare `gh pr …` means from the git remotes and their
    // `gh-resolved` config. Repointing a remote, adding one, or writing gh-resolved retargets it.
    id: "git-remote-retarget",
    tools: ["git"],
    when: (a) =>
      (a[0] === "remote" && ["set-url", "add", "rename", "set-head"].includes(a[1])) ||
      (a[0] === "config" && !hasLong(a, "--get", "--get-all", "--get-regexp", "--list") && !hasShort(a, "l") && !["get", "list"].includes(a[1]) &&
        a.some((w) => /^remote\.[^=]+\.(url|pushurl|gh-resolved)(=|$)/i.test(w) || /gh-resolved/i.test(w))),
    reason: `repointing a git remote or writing its gh-resolved setting changes which repository gh merges in, ${HUMAN}.`,
  },

  // Indirection: commands that run another command where this table cannot see its name (H1).
  {
    id: "xargs-command",
    tools: ["xargs"],
    when: (a) => positionals(a, XARGS_VALUED).length > 0,
    reason: `\`xargs <command>\` runs a command built from its input, which this guard cannot read, so it is refused. Run the command directly.`,
  },
  {
    id: "interpreter-runs-gh",
    tools: INTERPRETERS,
    when: (a, ctx, cmd) => interpreterCode(cmd.tool, a, cmd.bodies).some((code) => RUNS_GUARDED.test(code) || (BACKTICK_RUNS.has(cmd.tool) && code.includes("`"))),
    reason: `inline interpreter code that mentions gh, git push or spawns a process can run a guarded command where this guard cannot read it, so it is refused. Run the command directly in the shell.`,
  },
  {
    id: "indirect-gh",
    tools: [],
    when: () => false, // matched in check(): any non-reading command passed `gh` as an argument
    reason: `this command runs \`gh\` (or \`git push\`) through another program, where the guard cannot read what it does, so it is refused. Run gh directly.`,
  },

  // External: merges, releases, repository settings.
  {
    // TM-481: a GOVERNED worker never merges — not even its own PR. It finishes at ready-for-review;
    // the independent review verdict and the lead's landing path do the rest.
    id: "gh-pr-merge-governed",
    tools: ["gh"],
    when: (a, ctx) => ctx.governed && isPrMerge(a),
    reason: `this task is governed (or its store task cannot be identified, which counts as governed): its worker finishes at ready-for-review, and merging is the lead's landing path after the independent review verdict — ${HUMAN} or the lead.`,
  },
  {
    // Operator policy 2026-10-05: an UNGOVERNED worker merges its OWN PR once its review is clean
    // and required checks are green — named by its branch, in this repository, keeping the branch.
    // A bare merge resolves the PR from whatever is checked out when gh runs, and a number cannot be
    // tied to this worker, so both are refused. Any -R/--repo form, or GH_REPO/GH_HOST anywhere in
    // the command, would merge a same-named PR elsewhere; --delete-branch is a branch delete.
    // TM-481: --admin is never a worker's (it overrides failing checks and the review), and the
    // hook asks gh that every REQUIRED check has passed (ctx.requiredChecksPass) before allowing it.
    id: "gh-pr-merge",
    tools: ["gh"],
    when: (a, ctx) => {
      if (!isPrMerge(a)) return false;
      const [, , target, ...rest] = positionals(a, [...GH_VALUED, ...MERGE_VALUED]);
      const own = ownBranch(ctx);
      // H2: only as the ONE simple command on the line, named `gh` with no prefix — no cd, source,
      // export/declare, GH_* or wrapper before it, nothing piped or chained around it.
      if (!ctx.standalone || !own || target !== own || rest.length > 0 || ctx.ghOverride || hasRepoOption(a) || hasLong(a, "--delete-branch", "--admin") || hasShort(a, "d")) return true;
      return typeof ctx.requiredChecksPass !== "function" || ctx.requiredChecksPass(own) !== true;
    },
    reason: (ctx) =>
      ownBranch(ctx)
        ? `a dispatch worker merges only its own PR, named by its branch, in its pinned repository, keeping the branch, without --admin, and only once every required check has passed — as a command on its own line: \`gh pr merge ${ownBranch(ctx)} --merge\`. No PR number, no -R/--repo/GH_REPO, no cd/source/export before it, no --delete-branch, no --admin. Check with \`gh pr checks ${ownBranch(ctx)} --required\`.`
        : "no own branch is pinned for this worker (TM_DISPATCH_BRANCH is unset and no dispatch record names one), so no merge can be confirmed to be its own PR.",
  },
  {
    // TM-481: `gh repo set-default` changes which repository every later bare gh command targets.
    id: "gh-repo-set-default",
    tools: ["gh"],
    when: (args) => {
      const [a, b, repo] = positionals(args, GH_VALUED);
      // `--view` alone only prints the current default.
      return a === "repo" && b === "set-default" && (repo !== undefined || !(hasLong(args, "--view") || hasShort(args, "v")));
    },
    reason: `\`gh repo set-default\` repoints every later gh command at another repository, ${HUMAN}.`,
  },
  {
    // TM-481: an alias is a merge under another name (`gh alias set m 'pr merge'`, then `gh m 12`).
    id: "gh-alias-set",
    tools: ["gh"],
    when: gh(([a, b]) => a === "alias" && ["set", "import"].includes(b)),
    reason: `a gh alias can rename a guarded command such as \`pr merge\`, ${HUMAN}.`,
  },
  {
    // TM-481 H2: `gh config set` writes gh's own config (aliases, hosts, protocol).
    id: "gh-config-write",
    tools: ["gh"],
    when: gh(([a, b]) => a === "config" && ["set", "clear-cache"].includes(b)),
    reason: `changing gh's configuration can repoint or rename later gh commands, ${HUMAN}.`,
  },
  {
    // TM-481 H2: an extension, an alias from config.yml, or a subcommand from a newer gh can run
    // anything under a name this table does not know — so only gh's own known commands run.
    id: "gh-unknown-command",
    tools: ["gh"],
    when: gh(([a]) => a !== undefined && !GH_KNOWN.has(a)),
    reason: `this gh command is not one the worker guard recognises (an extension, an alias or an unknown subcommand), so it is refused rather than guessed at — ${HUMAN}.`,
  },
  {
    // TM-481 H1: a `gh api` endpoint or field built from an expansion (`$E`, `$(…)`) or percent-encoded
    // (`merg%65`) cannot be read here, so it is refused.
    id: "gh-api-unreadable",
    tools: ["gh"],
    when: (a) => a[0] === "api" && ghApiTainted(a.slice(1)),
    reason: `a \`gh api\` endpoint or field containing \`$\`, \`%\` or a backtick cannot be checked against the merge, ref, release and secret endpoints, so it is refused. Spell the endpoint and values out literally.`,
  },
  {
    // TM-481: the GraphQL merge mutations. A query read from a file or stdin, or built by a shell
    // substitution, cannot be inspected here, so it is refused rather than guessed at.
    id: "gh-api-graphql-merge",
    tools: ["gh"],
    // N1: `graphql`, `/graphql`, `graphql/`, `https://api.github.com/graphql` are all the GraphQL endpoint.
    when: (a) => a[0] === "api" && /(^|\/)graphql\/?(\?|$)/i.test(positionals(a.slice(1), GH_API_VALUED)[0] ?? "") && graphqlMayMerge(a.slice(1)),
    reason: `a GraphQL mergePullRequest / enablePullRequestAutoMerge call (or a query this guard cannot read: --input, a field from @file, a $(…) substitution) merges a PR, ${HUMAN}.`,
  },
  {
    // TM-235: a `gh pr create` with no --base (or the wrong one) targets the repository default
    // branch, not this repo's configured integration branch — that shipped merged develop commits
    // onto main. Missing and wrong are the same failure: an unstated base. `gh pr new` is gh's
    // alias for create and is read the same way.
    id: "gh-pr-create-base",
    tools: ["gh"],
    when: (a, ctx) => {
      const [sub, verb] = positionals(a, GH_VALUED);
      return sub === "pr" && (verb === "create" || verb === "new") && optionValue(a, ["--base", "-B"]) !== ownBase(ctx);
    },
    reason: (ctx) =>
      ownBase(ctx)
        ? `a dispatch worker opens its PR against ${ownBase(ctx)}, this repo's configured integration branch — not the repository default. Run \`gh pr create --base ${ownBase(ctx)} ...\`.`
        : "no integration branch is known for this worker (TM_DISPATCH_INTEGRATION_BRANCH is unset), so no PR base can be confirmed safe. Ask the dispatcher to set dispatch.integrationBranch and re-dispatch.",
  },
  {
    // TM-235: the base set at create time must stay put. Retargeting is refused whether it is done
    // through `gh pr edit --base` or through the raw API with a `base` field.
    id: "gh-pr-retarget",
    tools: ["gh"],
    when: (a, ctx) => {
      const [sub, verb] = positionals(a, GH_VALUED);
      if (sub === "pr" && verb === "edit") {
        const base = optionValue(a, ["--base", "-B"]);
        return base !== undefined && base !== ownBase(ctx);
      }
      return sub === "api" && ghApiSetsPrBase(a.slice(a.indexOf("api") + 1));
    },
    reason: (ctx) =>
      ownBase(ctx)
        ? `a dispatch worker's PR stays based on ${ownBase(ctx)}, this repo's configured integration branch; moving it is a change ${HUMAN}. Open the PR with \`gh pr create --base ${ownBase(ctx)} ...\` and leave its base alone.`
        : "no integration branch is known for this worker (TM_DISPATCH_INTEGRATION_BRANCH is unset), so no PR base can be confirmed safe. Ask the dispatcher to set dispatch.integrationBranch and re-dispatch.",
  },
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
  // TM-481 H1: xargs is NOT a wrapper — the command it runs is built from input it reads. See xargs-command.
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
  let ghOverride = false; // a GH_REPO/GH_HOST assignment points gh at another repository
  for (let pass = 0; pass < 16; pass++) {
    while (w.length && (KEYWORDS.has(w[0]) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) {
      if (/^GH_(REPO|HOST)=/.test(w[0])) ghOverride = true;
      w.shift();
    }
    if (!w.length || NOT_RUN.has(w[0])) return null;
    if (/[$`]/.test(w[0])) return { unknown: w.join(" ") };
    const name = basename(w[0]);
    if (name === "command" && (w[1] === "-v" || w[1] === "-V")) return null; // a lookup, nothing runs
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
    return { tool: name, args: w.slice(1), elsewhere: false, ghOverride };
  }
  return { unknown: w.join(" ") };
}

// ── the verdict ──────────────────────────────────────────────────────────────

const ALLOW = Object.freeze({ allow: true, reason: null, rule: null });
const block = (rule, reason) => ({ allow: false, reason, rule });
const UNREADABLE = (what) => block("unparsed", `${what} cannot be read with confidence and it mentions git push, gh or a deploy/secret tool, so it is refused rather than guessed at. Run the guarded command on its own, spelled out.`);

function check(src, ctx, depth) {
  if (depth > 8) return FAIL_SAFE.test(src) ? UNREADABLE("a command nested this deeply") : ALLOW;
  // TM-481: GH_REPO/GH_HOST set ANYWHERE in the command (`export GH_REPO=x; gh pr merge …`) points gh elsewhere.
  if (/\bGH_(REPO|HOST)\s*=/.test(src)) ctx = { ...ctx, ghOverride: true };
  const commands = [];
  const { ok } = read(src, 0, commands, null);
  // TM-481 H2: a merge must be the whole line — one simple command whose first word IS gh.
  const standalone = depth === 0 && ok && commands.length === 1 && basename(commands[0].words[0] ?? "") === "gh";
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
    // TM-481 H1: a command NAMED by an expansion (`$G`, `$(printf …)`) could be anything. Fail closed.
    if (cmd.unknown !== undefined) return block("unparsed", `\`${cmd.unknown}\` runs a command named by an expansion, which this guard cannot read, so it is refused. Spell the command name out.`);
    const here = { ...(cmd.elsewhere ? { ...ctx, head: null } : ctx), ghOverride: Boolean(cmd.ghOverride || ctx.ghOverride), standalone };
    const full = { ...cmd, bodies };
    for (const rule of RULES) {
      if (rule.tools.includes(cmd.tool) && rule.when(cmd.args, here, full)) {
        return block(rule.id, typeof rule.reason === "function" ? rule.reason(here) : rule.reason);
      }
    }
    // TM-481 H1: another program handed `gh` (or `git … push`) as an argument runs it out of sight:
    // `setsid gh …`, `find -exec gh …`, `watch git push …`.
    if (!["gh", "git"].includes(cmd.tool) && !READS_GH.has(cmd.tool)) {
      const names = cmd.args.map((a) => basename(a));
      if (names.includes("gh") || (names.includes("git") && cmd.args.includes("push"))) {
        const rule = RULES.find((r) => r.id === "indirect-gh");
        return block(rule.id, rule.reason);
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
 * checked out where the command runs, when known; `integrationBranch` is the PR base this worker
 * must target (pinned at spawn as TM_DISPATCH_INTEGRATION_BRANCH). TM-481: `governed` refuses every
 * merge; `requiredChecksPass(branch)` must return true before an ungoverned worker's own-PR merge is
 * allowed — absent, no merge is. Returns `{ allow, reason, rule }` — `rule` is the RULES id that
 * blocked, or "unparsed" for the fail-safe.
 */
export function guardCommand(command, { branch = null, head = branch, integrationBranch = null, governed = false, requiredChecksPass = null, allowlist = true } = {}) {
  const src = String(command ?? "");
  const ctx = { branch: branch || null, head: head || null, integrationBranch: integrationBranch || null, governed: Boolean(governed), requiredChecksPass };
  // TM-481: the allowlist goes first and fails closed; the table below is defense in depth behind it.
  // `allowlist: false` exists only so tests can exercise the table rows on their own — the hook never passes it.
  if (allowlist) {
    const verdict = allowlisted(src, ctx);
    if (!verdict.allow) return verdict;
  }
  return check(src, ctx, 0);
}

// ── the worker allowlist (TM-481, fail closed) ───────────────────────────────

/**
 * Every round of review found a new shape that reached gh or a push past the block list (a
 * `/graphql` spelling, a launcher with a quoted command, `bash <(…)`, a contents write). So for a
 * worker the guard is inverted: a command whose text mentions gh, a git push, GraphQL or the GitHub
 * API at all — raw, or with quotes and backslashes stripped (`g""h`, `g\h`) — is refused unless the
 * WHOLE line is one of the strict simple forms below. Everything else about it still goes through
 * the table afterwards (own branch, required checks, pinned repo, -R/GH_*, remotes, aliases).
 *
 * ponytail: still best effort — a script written to disk and run, or a name built from pieces that
 * never spell `gh`, is not seen. The real control is TM-489: a worker credential with no merge rights.
 */
export const MENTIONS_GUARDED = /\bgh\b|\bgit\b[\s\S]*\bpush\b|graphql|api\.github\.com/i;
/**
 * Shell syntax a simple command must not contain: `;`, `&`/`&&`, `|`/`||`, backticks, any `$` (`$(`,
 * `${`, `$VAR`), `<`/`>` (`<(`, `>(`, `<<`, redirection), backslashes and newlines.
 */
const NOT_SIMPLE = /[;&|`<>$\\\n\r]/;
const READ_VERBS = { pr: ["view", "status", "checks", "diff", "list"], run: ["view", "list", "watch"], issue: ["view", "list"] };
const MERGE_METHODS = ["--merge", "--squash", "--rebase"];

export const ALLOWED_FORMS = [
  "gh pr create --base <integration branch> --title … --body-file <file> (no -R/--repo)",
  "gh pr view|status|checks|diff|list …",
  "gh run view|list|watch …",
  "gh issue view|list …",
  "gh pr merge <your branch> --merge|--squash|--rebase [--auto] (ungoverned only, required checks green)",
  "git push [-u] origin <your branch>",
  "git push origin HEAD:<your branch>",
];

/**
 * U1: programs that only read or record text and cannot run a command, so a line made of ONE of them
 * may mention gh or a push freely (`git commit -m "retry the push"`, `rg graphql lib/`). Only when the
 * line is plain and the program is the first word with nothing before it. Nothing that takes a command
 * to run (`find -exec`, `xargs`, `watch`) is here, and the options that make these run one are refused.
 */
const TEXT_ONLY = new Set(["grep", "rg", "cat", "head", "tail", "less", "wc", "tm", ".bytedesk/task-management/bin/tm", "./.bytedesk/task-management/bin/tm"]);
const TEXT_ONLY_GIT = new Set(["commit", "log", "diff", "show", "status"]);
/** Options that make a "text only" program run another one: rg's preprocessor, git's external diff/textconv. */
const RUNS_HELPER = /^(--pre(=|$)|--pre-glob|--ext-diff|--textconv|--exec)/;

function textOnly(w) {
  if (w.some((a) => RUNS_HELPER.test(a))) return false;
  if (TEXT_ONLY.has(w[0])) return true;
  return w[0] === "git" && TEXT_ONLY_GIT.has(w[1]); // `git <sub>` directly: no -c, -C or other global option first
}

function allowlisted(src, ctx) {
  const stripped = src.replace(/['"\\]/g, "");
  if (!MENTIONS_GUARDED.test(src) && !MENTIONS_GUARDED.test(stripped)) return ALLOW;
  const refuse = (why) =>
    block("worker-allowlist", `${why} A dispatch worker may run gh or git push only as one plain command on its own line, in one of these forms: ${ALLOWED_FORMS.map((f) => `\`${f}\``).join("; ")}. Refused, with what to use instead: bare \`git push\` or \`--set-upstream\` → \`git push -u origin <your branch>\`; an inline --body with backticks, $, <, > or ; → \`gh pr create --body-file <file>\`; \`--delete-branch\` → leave the branch, it is cleaned up after the merge; anything chained with && or ; → run each command on its own. Anything else that mentions gh, git push, GraphQL or api.github.com is refused — that needs a human.`);
  if (NOT_SIMPLE.test(src)) {
    if (/^\s*gh\s+pr\s+(create|new)\b/.test(src)) return refuse("This `gh pr create` has shell syntax in it (often Markdown in an inline --body): use --body-file <file> for the body.");
    return refuse("This line chains, pipes, substitutes, redirects, expands or escapes.");
  }
  const commands = [];
  const { ok } = read(src, 0, commands, null);
  if (!ok || commands.length !== 1 || commands[0].bodies.length) return refuse("This is not exactly one simple command.");
  const w = commands[0].words;
  if (textOnly(w)) return ALLOW; // U1: the table behind still checks it
  if (w[0] === "gh") {
    if (hasRepoOption(w)) return refuse("No -R/--repo.");
    const [, noun, verb, ...rest] = w;
    if (noun === "pr" && verb === "create") return ALLOW;
    if (READ_VERBS[noun]?.includes(verb)) return ALLOW;
    if (noun === "pr" && verb === "merge") {
      const [target, ...flags] = rest;
      const methods = flags.filter((f) => MERGE_METHODS.includes(f));
      if (flags.some((f) => f === "--delete-branch" || f === "-d")) return refuse("No --delete-branch: a worker never deletes a branch.");
      const extra = flags.filter((f) => !MERGE_METHODS.includes(f) && f !== "--auto");
      if (target && !target.startsWith("-") && methods.length === 1 && !extra.length) return ALLOW; // the table decides own/checks/repo
      return refuse("A merge is `gh pr merge <your branch>` with exactly one of --merge/--squash/--rebase, and optionally --auto.");
    }
    return refuse(`\`gh ${noun ?? ""} ${verb ?? ""}\` is not an allowed form.`);
  }
  if (w[0] === "git" && w[1] === "push") {
    const own = ownBranch(ctx);
    const args = w.slice(2);
    const forms = own ? [["origin", own], ["-u", "origin", own], ["origin", `HEAD:${own}`]] : [];
    if (forms.some((f) => f.length === args.length && f.every((x, i) => x === args[i]))) return ALLOW;
    if (own && args.length === 0) return refuse(`A bare \`git push\` relies on upstream config; name the branch: \`git push -u origin ${own}\`.`);
    if (own && args.includes("--set-upstream")) return refuse(`Use the short form: \`git push -u origin ${own}\`.`);
    return refuse(own ? `A push is \`git push -u origin ${own}\` or \`git push origin HEAD:${own}\` — nothing else: no --force, no +refspec, no other branch.` : "No own branch is pinned for this worker, so no push is allowed.");
  }
  return refuse("This command mentions gh, git push, GraphQL or the GitHub API without being an allowed gh or git push form (a launcher, wrapper, interpreter or env prefix).");
}

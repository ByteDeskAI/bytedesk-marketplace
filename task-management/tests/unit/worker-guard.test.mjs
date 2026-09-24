/**
 * TM-177 — the dispatch worker guard.
 *
 * Unattended dispatch workers run with --dangerously-skip-permissions. The guard is what still stops
 * them doing what ADR-0001 reserves for a human: repo-destructive git, merges and releases, deploys,
 * secrets and outbound messages. Three layers are tested:
 *   1. guardCommand, the classifier — every row of its table has blocked samples, blocked BY THAT ROW;
 *   2. the shell forms a worker actually writes — compound, wrapped, heredoc'd;
 *   3. the hook glue — tm-hook.sh starts no Node outside a worker, and exits 2 inside one.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempRepo } from "./helpers.mjs";
import { RULES, guardCommand } from "../../lib/worker-guard.mjs";
import { ensureDirs, paths } from "../../lib/paths.mjs";
import { create, seedGitContract, update } from "../../lib/store.mjs";

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK = join(PLUGIN_ROOT, "hooks", "tm-hook.sh");
const OWN = "tm/TM-001-fix-the-thing";
const AT_HOME = { branch: OWN, head: OWN, integrationBranch: "main" };

const trash = [];
after(() => cleanup(...trash));

/** Blocked samples, keyed by the table row that must block them. */
const BLOCKED = {
  "git-push-force": [
    `git push --force origin ${OWN}`,
    "git push -f",
    `git push --force-with-lease origin ${OWN}`,
    `git push origin +${OWN}`,
    "git push -uf origin HEAD",
    "git push --force-if-includes",
  ],
  "git-push-scope": [
    "git push --all origin",
    "git push --mirror origin",
    "git push --tags",
    "git push --follow-tags origin HEAD",
    `git push origin --delete ${OWN}`,
    "git push -d origin old",
    `git push origin :${OWN}`,
  ],
  "git-push-destination": [
    "git push origin main",
    "git push origin HEAD:main",
    "git push origin v1.0.0",
    "git push origin refs/heads/someone-else",
    `git push origin ${OWN} main`,
  ],
  "git-branch-delete": ["git branch -D old", "git branch -d old", "git branch --delete old", "git branch -dr origin/old"],
  "git-tag-delete": ["git tag -d v1", "git tag --delete v1"],
  "git-reset-hard": ["git reset --hard origin/main", "git reset --hard"],
  "git-filter": ["git filter-branch --tree-filter 'rm x' HEAD", "git filter-repo --path secrets", "git-filter-repo --invert-paths --path x"],
  "git-rebase-protected": ["git rebase origin/main main", "git rebase --onto origin/main HEAD~3 master"],
  "git-update-ref-delete": ["git update-ref -d refs/heads/main"],
  "git-stash-destroy": ["git stash drop", "git stash drop stash@{1}", "git stash clear", "git stash pop", "git stash pop --index stash@{0}"],
  "gh-pr-merge": ["gh pr merge 12 --squash", "gh -R o/r pr merge 12 --admin"],
  "gh-pr-create-base": ["gh pr create --title x --body y", "gh pr create --base develop --title x", "gh -R o/r pr create --base wrong --fill", "gh pr new --title x", "gh pr new --base develop --title x"],
  "gh-pr-retarget": [
    "gh pr edit 12 --base develop",
    "gh pr edit 12 -B develop",
    "gh -R o/r pr edit 12 --title y --base=develop",
    "gh api -X PATCH repos/o/r/pulls/12 -f base=develop",
    "gh api repos/o/r/pulls -f title=x -f head=tm/x -f base=develop",
    "gh api --method PATCH repos/{owner}/{repo}/pulls/12 --field=base=main",
    "gh api -X PATCH https://api.github.com/repos/o/r/pulls/12 --input body.json",
  ],
  "gh-release": ["gh release create v1.0.0", "gh release delete v1.0.0 --yes"],
  "gh-repo-delete": ["gh repo delete o/r --yes", "gh repo archive o/r"],
  "gh-secret": ["gh secret set TOKEN --body x", "gh secret delete TOKEN"],
  "gh-variable": ["gh variable set NAME --body x", "gh variable delete NAME"],
  "gh-api-mutation": [
    "gh api -X PUT repos/o/r/pulls/1/merge",
    "gh api --method DELETE repos/o/r/git/refs/heads/main",
    "gh api repos/o/r/releases -f tag_name=v1",
  ],
  wrangler: ["wrangler deploy", "npx wrangler publish", "wrangler secret put API_KEY", "wrangler pages deploy dist"],
  vercel: ["vercel --prod", "vercel deploy", "vercel"],
  kubectl: ["kubectl apply -f deploy.yaml", "kubectl -n prod delete pod web-1"],
  helm: ["helm install web ./chart", "helm upgrade web ./chart"],
  terraform: ["terraform apply -auto-approve", "terraform destroy", "tofu apply"],
  flyctl: ["flyctl deploy", "fly deploy --remote-only", "fly secrets set A=b"],
  infisical: ["infisical secrets set A=b"],
  "package-publish": ["npm publish", "pnpm publish --access public", "yarn npm publish", "cargo publish"],
  "docker-push": ["docker push ghcr.io/o/web:latest"],
  "hosting-deploy": ["firebase deploy", "netlify deploy --prod"],
  "outbound-webhook": [
    `curl -X POST -H 'Content-type: application/json' --data '{"text":"hi"}' https://hooks.slack.com/services/T0/B0/XX`,
    "wget --post-data='content=hi' https://discord.com/api/webhooks/1/abc",
    'curl -d @msg.json "$SLACK_WEBHOOK_URL"',
  ],
  "outbound-mail": ["sendmail ops@example.com < msg.txt", "mail -s 'done' ops@example.com", "mailx -s hi a@b.c"],
};

/** The commit form Claude Code writes by default: a heredoc inside a substitution inside quotes. */
const CLAUDE_COMMIT = `git commit -m "$(cat <<'EOF'
TM-177: don't git push --force; gh pr merge stays a human's call

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"`;

describe("guardCommand — the table", () => {
  it("every row has blocked samples, and each sample is blocked by THAT row", () => {
    const ids = RULES.map((r) => r.id);
    assert.ok(ids.length >= 20, `the table loaded (${ids.length} rows)`);
    assert.equal(new Set(ids).size, ids.length, "row ids are unique");
    assert.deepEqual(Object.keys(BLOCKED).sort(), [...ids].sort(), "no row without a sample, no sample without a row");
    let n = 0;
    for (const [id, samples] of Object.entries(BLOCKED)) {
      for (const cmd of samples) {
        const v = guardCommand(cmd, AT_HOME);
        assert.equal(v.allow, false, `blocked: ${cmd}`);
        assert.equal(v.rule, id, `${cmd} is blocked by ${id}, not ${v.rule}`);
        assert.ok(typeof v.reason === "string" && v.reason.length > 10, `a reason a worker can act on: ${cmd}`);
        n++;
      }
    }
    console.log(`# worker-guard: ${ids.length} rows, ${n} blocked samples`);
  });

  it("allows the finish line and ordinary work", () => {
    const allowed = [
      "git push",
      "git push origin",
      `git push -u origin ${OWN}`,
      `git push --set-upstream origin ${OWN}`,
      "git push origin HEAD",
      "git push -u origin HEAD",
      `git push origin HEAD:${OWN}`,
      `git push origin refs/heads/${OWN}`,
      "gh pr create --title 'TM-001: fix' --body 'done' --base main",
      "gh pr new --title 'TM-001: fix' --base main",
      "gh pr edit 12 --title 'TM-001: fix' --body 'done'",
      "gh pr edit 12 --base main",
      "gh api -X PATCH repos/o/r/pulls/12 -f title=y",
      "gh api repos/o/r/pulls/12/comments -f body=hi",
      "gh pr view 12",
      "gh pr list",
      "gh pr checks 12",
      "gh release list",
      "gh api repos/o/r/pulls/1",
      "git commit -m 'TM-001: fix'",
      "git add -A",
      "git status --short",
      "git diff HEAD~1",
      "git log --oneline -5",
      "git fetch origin",
      "git pull --ff-only",
      "git rebase origin/main",
      "git branch --show-current",
      "git branch -a",
      "git stash",
      "git stash push -m wip",
      "git stash list",
      "git stash show -p stash@{0}",
      "git stash apply stash@{0}",
      "npm test",
      "node --test --test-concurrency=1 tests/unit/",
      "npm run build",
      "make -j4",
      "kubectl get pods",
      "helm list",
      "terraform plan",
      "wrangler dev",
      "vercel --version",
      "curl -s https://api.github.com/repos/o/r",
      "ls -la && pwd",
      'echo "git push --force"',
      "grep -rn 'gh pr merge' docs/",
      "cat <<'EOF' > notes.md\ngit push --force\ngh pr merge 1\nEOF",
      CLAUDE_COMMIT,
      `git add -A && ${CLAUDE_COMMIT} && git push -u origin ${OWN}`,
    ];
    for (const cmd of allowed) {
      const v = guardCommand(cmd, AT_HOME);
      assert.equal(v.allow, true, `allowed: ${cmd} — refused by ${v.rule}: ${v.reason}`);
    }
  });
});

describe("guardCommand — TM-235: a PR must target the configured integration branch", () => {
  it("blocks a PR with no --base", () => {
    const v = guardCommand("gh pr create --title x --body y", AT_HOME);
    assert.equal(v.allow, false);
    assert.equal(v.rule, "gh-pr-create-base");
    assert.match(v.reason, /main/, "names the expected base");
  });

  it("blocks a PR based against the wrong branch", () => {
    const v = guardCommand("gh pr create --base develop --title x", AT_HOME);
    assert.equal(v.allow, false);
    assert.equal(v.rule, "gh-pr-create-base");
    assert.match(v.reason, /main/, "names the expected base");
  });

  it("allows a PR based against the configured integration branch", () => {
    assert.equal(guardCommand("gh pr create --base main --title x", AT_HOME).allow, true);
    assert.equal(guardCommand("gh pr create --title x --base=main", AT_HOME).allow, true, "the --base=value form");
  });

  it("fails safe when no integration branch is known for this worker", () => {
    const v = guardCommand("gh pr create --base main --title x", { branch: OWN, head: OWN });
    assert.equal(v.allow, false);
    assert.equal(v.rule, "gh-pr-create-base");
    assert.match(v.reason, /TM_DISPATCH_INTEGRATION_BRANCH/);
  });

  it("reads `gh pr new` exactly like `gh pr create`", () => {
    const missing = guardCommand("gh pr new --title x", AT_HOME);
    assert.equal(missing.allow, false);
    assert.equal(missing.rule, "gh-pr-create-base");
    assert.match(missing.reason, /main/, "names the expected base");
    const wrong = guardCommand("gh pr new --base develop --title x", AT_HOME);
    assert.equal(wrong.allow, false);
    assert.equal(wrong.rule, "gh-pr-create-base");
    assert.match(wrong.reason, /main/, "names the expected base");
    assert.equal(guardCommand("gh pr new --base main --title x", AT_HOME).allow, true);
  });

  it("refuses retargeting a PR's base with `gh pr edit --base`", () => {
    const v = guardCommand("gh pr edit 12 --base develop", AT_HOME);
    assert.equal(v.allow, false);
    assert.equal(v.rule, "gh-pr-retarget");
    assert.match(v.reason, /main/, "names the expected base");
    assert.equal(guardCommand("gh pr edit 12 --title y", AT_HOME).allow, true, "an edit that leaves the base alone");
    assert.equal(guardCommand("gh pr edit 12 --base main", AT_HOME).allow, true, "restating the integration branch changes nothing");
    assert.equal(guardCommand("gh pr edit 12 --base main", { branch: OWN, head: OWN }).allow, false, "fails safe with no known base");
  });

  it("refuses raw-API PR writes that carry a base field", () => {
    for (const cmd of [
      "gh api -X PATCH repos/o/r/pulls/12 -f base=develop",
      "gh api -X PATCH repos/o/r/pulls/12 -f base=main",
      "gh api repos/o/r/pulls -f title=x -f head=tm/x -f base=develop",
      "gh api -X POST repos/o/r/pulls --input pr.json",
    ]) {
      const v = guardCommand(cmd, AT_HOME);
      assert.equal(v.allow, false, `refused: ${cmd}`);
      assert.equal(v.rule, "gh-pr-retarget", cmd);
      assert.match(v.reason, /main/, "names the expected base");
    }
    assert.equal(guardCommand("gh api repos/o/r/pulls/12", AT_HOME).allow, true, "reading a PR");
    assert.equal(guardCommand("gh api -X PATCH repos/o/r/pulls/12 -f title=y", AT_HOME).allow, true, "a PR write without a base field");
  });
});

describe("guardCommand — the shell a worker actually writes", () => {
  it("blocks a guarded command inside compound, wrapped and nested forms", () => {
    const wrapped = [
      ["npm test && git push --force", "git-push-force"],
      ["echo ok; gh pr merge 3", "gh-pr-merge"],
      ["git log --oneline | head -1 | xargs git tag -d", "git-tag-delete"],
      ["false || git branch -D old", "git-branch-delete"],
      ["(cd sub && git reset --hard)", "git-reset-hard"],
      ["{ git push -f; }", "git-push-force"],
      ["bash -c 'git push --force origin HEAD'", "git-push-force"],
      ['sh -lc "gh release create v1"', "gh-release"],
      ["zsh -c 'cd x; wrangler deploy'", "wrangler"],
      ["echo $(git push -f)", "git-push-force"],
      ["echo `gh secret set X`", "gh-secret"],
      ["sudo -u deploy kubectl apply -f x.yaml", "kubectl"],
      ["env -i HOME=/tmp git push origin main", "git-push-destination"],
      ["CI=1 npm publish", "package-publish"],
      ["/usr/bin/git push --mirror", "git-push-scope"],
      ["bash <<'EOF'\ngit push --force\nEOF", "git-push-force"],
      ["bash <<< 'git push --force'", "git-push-force"],
      ['eval "git push --force"', "git-push-force"],
      ["if true; then\n  terraform destroy\nfi", "terraform"],
      ["for r in a b; do git push origin $r; done", "git-push-destination"],
      ["npm run build 2>&1 && git push -f origin HEAD > /tmp/out", "git-push-force"],
      ["timeout 60 helm upgrade web ./chart", "helm"],
      ["nohup git filter-repo --path x &", "git-filter"],
      [`bash -c "bash -c 'git push -f'"`, "git-push-force"],
      ["git -C ../elsewhere push origin HEAD", "git-push-destination"],
      ["npm test\ngit push origin main", "git-push-destination"],
    ];
    for (const [cmd, rule] of wrapped) {
      const v = guardCommand(cmd, AT_HOME);
      assert.equal(v.allow, false, `blocked: ${JSON.stringify(cmd)}`);
      assert.equal(v.rule, rule, `${JSON.stringify(cmd)} blocked by ${rule}, not ${v.rule}`);
    }
  });

  it("fails safe on what it cannot read, but only when it mentions git push, gh or a guarded tool", () => {
    for (const cmd of ["$GIT push --force", 'git push -f "unterminated', "$(echo gh) pr merge 1", "`which wrangler` deploy"]) {
      const v = guardCommand(cmd, AT_HOME);
      assert.equal(v.allow, false, `fail safe: ${cmd}`);
      assert.equal(v.rule, "unparsed", `${cmd} refused as unparsed, not ${v.rule}`);
    }
    for (const cmd of ['echo "unterminated', "$CMD --version", '"$(git rev-parse --show-toplevel)/scripts/test.sh"']) {
      assert.equal(guardCommand(cmd, AT_HOME).allow, true, `unreadable but unguarded: ${cmd}`);
    }
  });

  it("a push that relies on HEAD is allowed only while HEAD is the worker's own branch", () => {
    const onMain = { branch: OWN, head: "main" };
    for (const cmd of ["git push", "git push origin", "git push origin HEAD", "git push -u origin HEAD"]) {
      const v = guardCommand(cmd, onMain);
      assert.equal(v.allow, false, `blocked with HEAD on main: ${cmd}`);
      assert.equal(v.rule, "git-push-destination");
    }
    assert.equal(guardCommand(`git push origin ${OWN}`, onMain).allow, true, "naming the own branch does not depend on HEAD");
  });

  it("with no own branch known, every push is refused and ordinary git still runs", () => {
    for (const ctx of [{}, { branch: null }, { branch: "main", head: "main" }, { branch: "HEAD", head: "HEAD" }]) {
      for (const cmd of ["git push", "git push origin main", `git push origin ${OWN}`]) {
        assert.equal(guardCommand(cmd, ctx).allow, false, `${cmd} with ${JSON.stringify(ctx)}`);
      }
      assert.equal(guardCommand("git status", ctx).allow, true);
    }
  });

  it("a rebase that rewrites main is refused; rebasing the own branch onto main is not", () => {
    const v = guardCommand("git rebase origin/main", { branch: OWN, head: "main" });
    assert.equal(v.allow, false);
    assert.equal(v.rule, "git-rebase-protected");
    assert.equal(guardCommand("git rebase -i origin/main", AT_HOME).allow, true);
  });
});

describe("tm-hook.sh pre-bash — the glue", () => {
  const payload = (command, cwd = tmpdir()) =>
    JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

  /** The ambient env minus any dispatch marker the test runner happens to carry, plus `extra`. */
  function envWith(extra = {}) {
    const env = { ...process.env };
    // Every worker marker AND the store: run from inside a dispatched worker's shell, an inherited
    // TM_ROOT names a real store where the sample task may be done, and the hook releases (TM-235).
    for (const k of ["TM_DISPATCH_WORKER", "TM_DISPATCH_TASK", "TM_DISPATCH_BRANCH", "TM_DISPATCH_INTEGRATION_BRANCH", "TM_ROOT"]) delete env[k];
    return { ...env, ...extra };
  }

  /** A fake `node` first on PATH that records every start. */
  function fakeNode() {
    const dir = mkdtempSync(join(tmpdir(), "tm-guard-fakenode-"));
    trash.push(dir);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "ran.log");
    const marker = join(dir, "node-started");
    writeFileSync(join(bin, "node"), `#!/bin/sh\necho "node $*" >> '${log}'\ntouch '${marker}'\nexit 0\n`);
    chmodSync(join(bin, "node"), 0o755);
    const ran = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
    const run = (event, extra = {}) =>
      spawnSync("sh", [HOOK, event], { input: payload("git push --force"), env: envWith({ PATH: `${bin}:${process.env.PATH}`, ...extra }), encoding: "utf8" });
    return { marker, ran, run };
  }

  it("outside a worker, exits 0 without starting Node — and the same shim does see Node start inside one", () => {
    const outside = fakeNode();
    const res = outside.run("pre-bash");
    const blank = outside.run("pre-bash", { TM_DISPATCH_WORKER: "" });
    console.log(`# pre-bash outside a worker, binaries that ran: ${JSON.stringify(outside.ran())}`);
    assert.equal(res.status, 0);
    assert.equal(blank.status, 0, "an empty marker is unset");
    assert.equal(existsSync(outside.marker), false, "no Node was started");
    assert.deepEqual(outside.ran(), []);

    // The control: without it, an empty list could mean the shim was never on PATH.
    const inside = fakeNode();
    inside.run("pre-bash", { TM_DISPATCH_WORKER: "1" });
    console.log(`# pre-bash inside a worker, binaries that ran: ${JSON.stringify(inside.ran())}`);
    assert.equal(existsSync(inside.marker), true, "the shim records a Node start");
    assert.match(inside.ran()[0], /^node .*bin\/tm-hook pre-bash$/);

    // The fast path is scoped to pre-bash: every other event still reaches Node.
    const other = fakeNode();
    other.run("stop");
    assert.match(other.ran()[0] ?? "", /^node .*bin\/tm-hook stop$/, `stop still starts Node: ${JSON.stringify(other.ran())}`);
  });

  it("in a worker, exits 2 with a reason for one sample of every row, and 0 for the finish line", () => {
    const repo = tempRepo();
    trash.push(repo);
    execFileSync("git", ["-C", repo, "checkout", "-q", "-b", OWN]);
    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: "TM-001", TM_DISPATCH_BRANCH: OWN, TM_DISPATCH_INTEGRATION_BRANCH: "main" });
    const hook = (command) => spawnSync("sh", [HOOK, "pre-bash"], { input: payload(command, repo), env, encoding: "utf8" });

    for (const [id, [sample]] of Object.entries(BLOCKED)) {
      const r = hook(sample);
      assert.equal(r.status, 2, `${id}: ${sample} exits 2 (stderr: ${r.stderr})`);
      assert.match(r.stderr, /TM-001/, `${id}: the reason names the task`);
      assert.ok(r.stderr.trim().length > 40, `${id}: a reason, not a bare refusal`);
    }
    assert.match(hook(`git push --force origin ${OWN}`).stderr, /force/i);

    for (const cmd of [`git push -u origin ${OWN}`, "git push origin HEAD", "gh pr create --fill --base main", "git commit -m x", "npm test"]) {
      const r = hook(cmd);
      assert.equal(r.status, 0, `${cmd}: ${r.stderr}`);
      assert.equal(r.stderr, "");
    }
  });

  it("in a worker without TM_DISPATCH_BRANCH, the own branch is read from the payload's cwd", () => {
    const own = tempRepo();
    const onMain = tempRepo();
    trash.push(own, onMain);
    execFileSync("git", ["-C", own, "checkout", "-q", "-b", OWN]);
    execFileSync("git", ["-C", onMain, "branch", "-M", "main"]);
    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: "TM-001" });
    const hook = (cwd) => spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push origin HEAD", cwd), env, encoding: "utf8" });
    assert.equal(hook(own).status, 0, "HEAD is the worker's branch");
    const r = hook(onMain);
    assert.equal(r.status, 2, "HEAD on main is no own branch at all");
    assert.match(r.stderr, /branch/);
  });

  it("in a worker, an unreadable payload is refused rather than waved through", () => {
    const r = spawnSync("sh", [HOOK, "pre-bash"], { input: "not json", env: envWith({ TM_DISPATCH_WORKER: "1" }), encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /could not read/i);
  });
});

describe("tm-hook.sh pre-bash — the guard releases when the task does", () => {
  const payload = (command, cwd) =>
    JSON.stringify({ session_id: "s", hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, cwd });

  function envWith(extra = {}) {
    const env = { ...process.env };
    // Every worker marker AND the store: run from inside a dispatched worker's shell, an inherited
    // TM_ROOT names a real store where the sample task may be done, and the hook releases (TM-235).
    for (const k of ["TM_DISPATCH_WORKER", "TM_DISPATCH_TASK", "TM_DISPATCH_BRANCH", "TM_DISPATCH_INTEGRATION_BRANCH", "TM_ROOT"]) delete env[k];
    return { ...env, ...extra };
  }

  /** A worker pinned to a real task in a real store, on a branch that is not its own. */
  function worker(status) {
    const root = tempRepo();
    trash.push(root);
    const p = paths(root);
    ensureDirs(p);
    seedGitContract(p);
    const task = create("task", { title: "the work" }, "body", p);
    if (status) update(task.id, { status }, p);
    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: task.id, TM_DISPATCH_BRANCH: "tm/gone-branch", TM_ROOT: root });
    // A command the guard blocks outright, so a 0 can only mean the guard stood down.
    const run = (command = "git push --force origin main") =>
      spawnSync("sh", [HOOK, "pre-bash"], { input: payload(command, root), env, encoding: "utf8" });
    return { task, root, run };
  }

  it("a done task releases it — the branch is gone and the session still works", () => {
    const w = worker("done");
    const r = w.run();
    assert.equal(r.status, 0, `a finished worker is not still guarded (stderr: ${r.stderr})`);
    assert.equal(r.stderr.trim(), "", "and it says nothing on the way out");
  });

  it("a deleted task releases it too", () => {
    assert.equal(worker("deleted").run().status, 0);
  });

  it("an open task does NOT release it", () => {
    const r = worker("in_progress").run();
    assert.equal(r.status, 2, "work still in flight is still guarded");
    assert.match(r.stderr, /force/i);
  });

  it("a task it cannot read does NOT release it — a guard that cannot see must not stand down", () => {
    const root = tempRepo();
    trash.push(root);
    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: "TM-999", TM_ROOT: root, TM_DISPATCH_BRANCH: "tm/x" });
    const r = spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push --force origin main", root), env, encoding: "utf8" });
    assert.equal(r.status, 2, "a missing task is not a release");
  });

  it("without TM_ROOT, the task's recorded branch identifies it", () => {
    // Not every launch path injects TM_ROOT — the one that raised this bug did not.
    // The branch the task records is then the identity: a same-id task elsewhere
    // does not carry this worker's branch name.
    const root = tempRepo();
    trash.push(root);
    const p = paths(root);
    ensureDirs(p);
    seedGitContract(p);
    const task = create("task", { title: "finished elsewhere" }, "body", p);
    const branch = `tm/${task.id}-finished-elsewhere`;
    update(task.id, { status: "done", branch }, p);

    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: task.id, TM_DISPATCH_BRANCH: branch });
    const r = spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push --force origin main", root), env, encoding: "utf8" });
    assert.equal(r.status, 0, `a finished worker releases on its branch alone (stderr: ${r.stderr})`);

    // A branch that is not the one the task recorded identifies nothing.
    const wrong = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: task.id, TM_DISPATCH_BRANCH: "tm/some-other-branch" });
    const r2 = spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push --force origin main", root), env: wrong, encoding: "utf8" });
    assert.equal(r2.status, 2, "a mismatched branch is not an identity");
  });

  it("a same-id task done in ANOTHER store does NOT release it", () => {
    // Task ids are unique only within a store. Resolving the store from cwd rather
    // than TM_ROOT let a finished TM-001 in an unrelated repo release a worker
    // pinned to its own TM-001 — the guard must identify the store, not guess it.
    const theirs = tempRepo();
    const ours = tempRepo();
    trash.push(theirs, ours);
    const tp = paths(theirs);
    ensureDirs(tp);
    seedGitContract(tp);
    const done = create("task", { title: "theirs, finished" }, "body", tp);
    update(done.id, { status: "done" }, tp);

    const op = paths(ours);
    ensureDirs(op);
    seedGitContract(op);
    const mine = create("task", { title: "mine, open" }, "body", op);
    assert.equal(mine.id, done.id, "precondition: the two stores minted the same id");

    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_TASK: mine.id, TM_DISPATCH_BRANCH: "tm/x", TM_ROOT: ours });
    const r = spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push --force origin main", ours), env, encoding: "utf8" });
    assert.equal(r.status, 2, "the other store's finished task is not this worker's release");
  });

  it("no pin at all does NOT release it", () => {
    const root = tempRepo();
    trash.push(root);
    const env = envWith({ TM_DISPATCH_WORKER: "1", TM_DISPATCH_BRANCH: "tm/x", TM_ROOT: root });
    const r = spawnSync("sh", [HOOK, "pre-bash"], { input: payload("git push --force origin main", root), env, encoding: "utf8" });
    assert.equal(r.status, 2, "an unnamed task is not a release");
  });
});

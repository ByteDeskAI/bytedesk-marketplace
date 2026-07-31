/**
 * TM-001 — the store belongs to the *executing project*, is shared by all of that
 * project's worktrees, and is never created inside an installed copy of the plugin.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { addWorktree, cleanup, tempRepo } from "./helpers.mjs";
import { currentCheckout, legacyStore, pluginInstallRoot, resolveRoot } from "../../lib/paths.mjs";

const created = [];
const repo = () => {
  const r = tempRepo();
  created.push(r);
  return r;
};

/** resolveRoot() reads the environment; give it one without leaking into other tests. */
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const cwd = process.cwd();
  try {
    if (env.__cwd) process.chdir(env.__cwd);
    return fn();
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

after(() => cleanup(...created));

describe("resolveRoot", () => {
  it("prefers an explicit TM_ROOT over everything else", () => {
    const a = repo();
    const b = repo();
    const got = withEnv({ TM_ROOT: a, CLAUDE_PROJECT_DIR: b, __cwd: b }, resolveRoot);
    assert.equal(resolve(got), resolve(a));
  });

  it("prefers the executing project over the terminal's cwd", () => {
    const project = repo();
    const elsewhere = repo();
    const got = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: project, __cwd: elsewhere }, resolveRoot);
    assert.equal(resolve(got), resolve(project), "CLAUDE_PROJECT_DIR must win — the store follows the project, not the shell");
  });

  it("falls back to the cwd's repo when no project is declared", () => {
    const r = repo();
    const got = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: undefined, __cwd: r }, resolveRoot);
    assert.equal(resolve(got), resolve(r));
  });

  it("resolves a worktree to its main checkout so both share one store", () => {
    const main = repo();
    const wt = addWorktree(main, "shared");
    created.push(wt);
    const fromMain = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: undefined, __cwd: main }, resolveRoot);
    const fromWorktree = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: undefined, __cwd: wt }, resolveRoot);
    assert.equal(resolve(fromWorktree), resolve(fromMain), "a worktree must not get its own isolated store");
  });

  it("resolves a worktree named as the executing project to the main checkout too", () => {
    const main = repo();
    const wt = addWorktree(main, "declared");
    created.push(wt);
    const got = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: wt, __cwd: wt }, resolveRoot);
    assert.equal(resolve(got), resolve(main));
  });

  it("treats the plugin's own source checkout as an ordinary project", () => {
    const here = resolve(import.meta.dirname, "..", "..");
    assert.equal(pluginInstallRoot(), null, "a source checkout is not a managed install");
    const got = withEnv({ TM_ROOT: undefined, CLAUDE_PROJECT_DIR: here, __cwd: here }, resolveRoot);
    assert.ok(got, "the marketplace repo must resolve a store like any other project — no TM_ROOT required");
  });

  it("refuses to put a store inside an installed copy of the plugin", () => {
    const home = repo();
    const install = join(home, ".claude", "plugins", "task-management", "lib");
    mkdirSync(install, { recursive: true });
    // The guard reads the plugin's own location, so exercise it through a child that
    // imports paths.mjs from a path shaped like a managed install.
    cpSync(resolve(import.meta.dirname, "..", "..", "lib"), install, { recursive: true });
    const target = dirname(install);
    const script = `import { resolveRoot } from ${JSON.stringify(join(install, "paths.mjs"))};
      process.stdout.write(String(resolveRoot()));`;
    const got = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: target,
      encoding: "utf8",
      env: { ...process.env, TM_ROOT: "", CLAUDE_PROJECT_DIR: target },
    });
    assert.equal(got, "null", "/plugin update would wipe a store written there");
  });
});

describe("currentCheckout", () => {
  it("reports the worktree you are actually in, not the store root", () => {
    const main = repo();
    const wt = addWorktree(main, "checkout");
    created.push(wt);
    const got = withEnv({ __cwd: wt }, currentCheckout);
    assert.equal(resolve(got), resolve(wt));
  });
});

describe("legacyStore", () => {
  it("finds a pre-v0.2 store stranded in a worktree", () => {
    const main = repo();
    const wt = addWorktree(main, "legacy");
    created.push(wt);
    mkdirSync(join(wt, ".bytedesk", "task-management", "tasks"), { recursive: true });
    const found = withEnv({ __cwd: wt }, () => legacyStore(main));
    assert.equal(resolve(found), resolve(join(wt, ".bytedesk", "task-management")));
  });

  it("reports nothing when there is no stranded store", () => {
    const main = repo();
    const wt = addWorktree(main, "nolegacy");
    created.push(wt);
    assert.equal(withEnv({ __cwd: wt }, () => legacyStore(main)), null);
  });
});

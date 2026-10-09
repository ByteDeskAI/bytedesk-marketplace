// TM-443: task-management's host-side git goes through lib/safe-git.mjs (a byte-identical copy of
// agent-orchestration's; agent-orchestration's suite checks the two match). This suite stands alone.
import { after, it } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, git, tempRepo } from "./helpers.mjs";
import { ghResolver, governanceGit, runGh } from "../../lib/governance-check.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const trash = [];
after(() => cleanup(...trash));

it("TM-443: a planted fsmonitor, hook, pager, external diff and filter never run through governanceGit", () => {
  const repo = tempRepo(); trash.push(repo);
  const marker = join(repo, "..", `planted-${process.pid}-${Date.now()}`), script = `${marker}.sh`;
  writeFileSync(script, `#!/bin/sh\necho "$0 $*" >> '${marker}'\ncat\n`); chmodSync(script, 0o755);
  writeFileSync(join(repo, "a.txt"), "one\n"); git(repo, "add", "a.txt"); git(repo, "commit", "-qm", "a");
  for (const [key, value] of [["core.fsmonitor", script], ["core.hooksPath", repo], ["diff.external", script], ["core.pager", script], ["filter.p.clean", script], ["filter.p.required", "true"]]) git(repo, "config", key, value);
  writeFileSync(join(repo, ".git", "info", "attributes"), "* filter=p\n");
  writeFileSync(join(repo, "a.txt"), "two\n");
  assert.match(governanceGit(repo, "status", "--porcelain"), /a\.txt/);
  assert.match(governanceGit(repo, "diff"), /two/);
  const fired = (() => { try { return readFileSync(marker, "utf8"); } catch { return ""; } })();
  assert.equal(fired, "", "a planted vector ran");
});

it("TM-443 follow-up: governance gh is the root-owned binary at a pinned path; a gh planted first on PATH never runs", () => {
  const repo = tempRepo(); trash.push(repo);
  const bin = join(repo, "home-bin"), marker = join(repo, "PLANTED-GH");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\ntouch '${marker}'\necho planted\n`); chmodSync(join(bin, "gh"), 0o755);
  const saved = process.env.PATH; process.env.PATH = `${bin}:${saved}`;
  try {
    const r = runGh(["--version"], repo);
    assert.equal(existsSync(marker), false, "the planted ~/bin gh ran");
    if (r.status === 0) assert.match(r.stdout, /gh version/); else assert.equal(r.status, 127);
  } finally { process.env.PATH = saved; }
});

it("TM-475: governance gh refuses a config that redirects it, and never passes GH_*/proxy/CA env", () => {
  const repo = tempRepo(); trash.push(repo);
  const fake = join(repo, "..", `fake-gh-${process.pid}-${Date.now()}`);
  trash.push(fake);
  // A gh whose `config get http_unix_socket` answers from a file, and which otherwise prints its env.
  const answer = `${fake}.socket`;
  trash.push(answer);
  writeFileSync(fake, `#!/bin/sh\nif [ "$1" = config ]; then [ "$3" = http_unix_socket ] && cat '${answer}'; exit 0; fi\nenv\n`); chmodSync(fake, 0o755);
  const saved = { resolve: ghResolver.resolve, env: {} };
  const planted = { GH_HOST: "evil.example", GH_REPO: "evil/r", GH_CONFIG_DIR: "/tmp/evil-gh", HTTPS_PROXY: "http://127.0.0.1:9", ALL_PROXY: "socks5://127.0.0.1:9", SSL_CERT_FILE: "/tmp/evil.pem", SSL_CERT_DIR: "/tmp/evil-ca", TM475_KEEP: "kept" };
  for (const [k, v] of Object.entries(planted)) { saved.env[k] = process.env[k]; process.env[k] = v; }
  ghResolver.resolve = () => fake;
  try {
    writeFileSync(answer, "");
    const r = runGh(["api", "repos/o/r/compare/a...b"], repo);
    assert.equal(r.status, 0, r.stderr);
    // Compare names only: the child's environment holds the operator's tokens and must not reach test output.
    const names = r.stdout.split("\n").map((line) => line.split("=")[0]);
    assert.ok(names.includes("TM475_KEEP"), "the fake printed its environment, so absence below is meaningful");
    assert.deepEqual(Object.keys(planted).filter((n) => n !== "TM475_KEEP" && names.includes(n)), []);
    writeFileSync(answer, "/tmp/worker.sock\n");
    const refused = runGh(["api", "repos/o/r/compare/a...b"], repo);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /http_unix_socket/);
    assert.doesNotMatch(refused.stdout, /TM475_KEEP/, "the request never ran");
  } finally {
    ghResolver.resolve = saved.resolve;
    for (const [k, v] of Object.entries(saved.env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

it("TM-443: no raw git spawn outside lib/safe-git.mjs", () => {
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  const files = [...walk(join(ROOT, "lib")).filter((f) => /\.mjs$/.test(f)), ...walk(join(ROOT, "bin"))];
  assert.ok(files.length >= 40, `scanned only ${files.length} files`);
  const RAW = /\b\w+\(\s*(['"])(?:\/usr\/bin\/)?git(?:\.exe)?\1\s*,/g;
  // The generated launcher template locates lib/ and so cannot import it; it runs only rev-parse.
  const allowed = new Set(["lib/launcher.mjs", "lib/safe-git.mjs"]);
  const hits = files.flatMap((f) => [...readFileSync(f, "utf8").matchAll(RAW)].map((m) => relative(ROOT, f)));
  assert.ok(hits.includes("lib/launcher.mjs"), "the pattern no longer finds the known launcher call");
  assert.deepEqual(hits.filter((f) => !allowed.has(f)), []);
});

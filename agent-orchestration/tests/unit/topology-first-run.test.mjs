// TM-155. Three conditions an operator currently meets as a stalled pane, a raw tmux error, or a
// sentence that names nothing — all knowable before anything is launched.
//
// Found by running the EP-018 demo four times. The first run died on the folder-trust modal in a
// repository Claude had never been trusted in; the second proved that a TRUSTED repository's agent
// subdirectories inherit that trust, which corrected my own filing; both wasted a run on a socket
// path over the kernel's limit and on a template override whose refusal named neither the template
// nor the file.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { socketPathProblem } from "../../topology/lib/tmux.mjs";
import { promptErrorDetail } from "../../topology/lib/prompts.mjs";
import { doctor } from "../../topology/lib/doctor.mjs";

test("a TMUX_TMPDIR too long for a unix socket is refused with the reason", () => {
  // Measured during the demo: tmux answers "File name too long", which reads like a filename
  // problem and is not — it is sun_path, and the fix is a shorter directory, not a shorter name.
  const long = `/tmp/${"x".repeat(120)}`;
  const problem = socketPathProblem({ TMUX_TMPDIR: long }, 1000);
  assert.equal(problem.code, "TMUX_SOCKET_PATH_TOO_LONG");
  assert.match(problem.message, /kernel limit/);
  assert.match(problem.message, /File name too long/, "name what tmux will say, or nobody connects the two");
  assert.match(problem.fix.note, /short directory/);
});

test("an ordinary TMUX_TMPDIR, and an unset one, say nothing", () => {
  assert.equal(socketPathProblem({ TMUX_TMPDIR: "/tmp/ao-demo" }, 1000), null);
  assert.equal(socketPathProblem({}, 1000), null, "unset means tmux picks its own, which is short");
});

test("a prompt refusal names the key that is wrong", () => {
  // The two shapes that actually happened. Before this, both produced only
  // "Invalid lead prompt; refusing restart." — a sentence naming neither the template nor the file.
  assert.match(
    promptErrorDetail([{ layer: "template", path: "./prompts/lead.md", note: "ENOENT: no such file or directory" }]),
    /template \.\/prompts\/lead\.md — ENOENT/,
    "the copied-default case: the path is relative to the layer that declares it",
  );
  assert.match(
    promptErrorDetail([{ layer: "template", path: null, note: 'template "lead-default" has no prompt' }]),
    /has no prompt/,
    "the partial-override case: a template is replaced, not merged",
  );
  assert.equal(promptErrorDetail([]), "", "and a healthy compose adds nothing to the sentence");
});

test("doctor reports the first-run trust gate for a repository Claude has never been trusted in", async (t) => {
  const home = await mkdtemp(join(tmpdir(), "ao-trust-"));
  const consumer = await mkdtemp(join(tmpdir(), "ao-repo-"));
  await writeFile(join(home, ".claude.json"), JSON.stringify({ projects: {} }), "utf8");

  const report = await doctor({
    adapters: new Map([["claude", { id: "claude", command: process.execPath }]]),
    workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [],
    consumer, env: {}, home,
  });

  const found = report.problems.find((problem) => problem.code === "CLAUDE_FOLDER_UNTRUSTED");
  assert.ok(found, "an untrusted repository must be reported before a launch stalls on the modal");
  assert.match(found.message, /No, exit/, "name the highlighted answer: Enter there exits the provider");
  assert.match(found.fix.note, /per-repository/, "and say it is asked once per repo, not per agent directory");
  assert.equal(report.trust.trusted, false);
});

test("doctor says nothing about trust once the repository is trusted", async () => {
  const home = await mkdtemp(join(tmpdir(), "ao-trust-ok-"));
  const consumer = await mkdtemp(join(tmpdir(), "ao-repo-ok-"));
  await writeFile(join(home, ".claude.json"), JSON.stringify({ projects: { [consumer]: { hasTrustDialogAccepted: true } } }), "utf8");

  const report = await doctor({
    adapters: new Map([["claude", { id: "claude", command: process.execPath }]]),
    workflowDirs: [], skillDirs: [], roleDirs: [], providerDirs: [],
    consumer, env: {}, home,
  });

  assert.equal(report.problems.find((problem) => problem.code === "CLAUDE_FOLDER_UNTRUSTED"), undefined);
  assert.equal(report.trust.trusted, true);
});

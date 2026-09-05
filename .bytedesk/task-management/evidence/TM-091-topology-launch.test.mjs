// Launch-time behaviour that has to hold without a tmux server: the auto_approve consent gate,
// readiness (the shell-prompt false positive, the reachable ready:false, the failure matcher), the
// per-agent memory declaration each provider carries, and session naming for concurrent spawns.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import { evaluateScreen, launchRun, screenSince, uniqueSessionName } from "../../topology/lib/launch.mjs";
import {
  GENERIC_ADAPTER,
  MEMORY_SCOPES,
  buildArgv,
  failureOnScreen,
  grantsDirs,
  memoryLocation,
  normalizeAdapter,
  sanitizeCwd,
} from "../../topology/lib/providers.mjs";
import { materializeSpec, validateSpec } from "../../topology/lib/spec.mjs";
import { ensureRunsIgnored } from "../../topology/lib/util.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const providersDir = join(here, "..", "..", "providers");

const adapter = (overrides = {}) => normalizeAdapter({ id: "test", ...overrides }, "test");
const claudeAdapters = () =>
  new Map([
    ["generic", normalizeAdapter({ id: "generic" }, "generic")],
    ["claude", normalizeAdapter({ id: "claude", command: "claude", add_dir_args: ["--add-dir", "{{dir}}"] }, "claude")],
  ]);

// ---------------------------------------------------------------- TM-090 auto_approve consent

const autoApproveSpec = (consumer) =>
  materializeSpec(
    validateSpec({
      name: "gate",
      agents: [
        { id: "conductor", role: "orchestrator", cli: "claude", auto_approve: true },
        { id: "hand", role: "worker", cli: "claude", auto_approve: true },
      ],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );

test("a spec with auto_approve refuses to launch without explicit consent — dry run included", async () => {
  const spec = autoApproveSpec(process.cwd());
  // A dry run is how an operator inspects a spec, so the gate has to fire there too: learning about
  // it only after panes exist is learning about it too late.
  for (const dryRun of [false, true]) {
    await assert.rejects(
      () => launchRun({ spec, adapters: claudeAdapters(), skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun }),
      (error) => {
        assert.equal(error.code, "TOPOLOGY_AUTO_APPROVE_UNCONFIRMED");
        assert.match(error.message, /auto_approve/, "the harness greps the message for auto_approve");
        assert.match(error.message, /conductor \(orchestrator\)/, "the error must name the affected agents");
        assert.match(error.message, /hand \(worker\)/);
        assert.match(error.message, /--allow-auto-approve/, "the error must name the flag that grants consent");
        return true;
      },
      `dryRun: ${dryRun}`,
    );
  }
});

test("consent gets past the gate, and the launch still names the agents it applies to", async () => {
  const spec = autoApproveSpec(process.cwd());
  const result = await launchRun({
    spec,
    adapters: claudeAdapters(),
    skillSearchDirs: [],
    roleSearchDirs: [],
    cliBin: "ao",
    dryRun: true,
    allowAutoApprove: true,
  });
  assert.equal(result.dryRun, true);
  assert.ok(result.warnings.some((w) => w.includes("auto_approve is on for conductor, hand")), result.warnings.join("\n"));
});

test("the runs root is gitignored before a run writes into it", async (t) => {
  // `.bytedesk/` is a tree these repos deliberately commit, so without this every mailbox file and
  // journal line lands in the consumer's next diff. launchRun calls this before its first write.
  const repo = await mkdtemp(join(tmpdir(), "ao-ignore-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  const runsRoot = join(repo, ".bytedesk", "agent-orchestration", "runs");

  const marker = await ensureRunsIgnored(join(runsRoot, "20260905-120000-abcd"));
  assert.equal(marker, join(runsRoot, ".gitignore"));
  assert.match(await readFile(marker, "utf8"), /^\*$/m, "everything under the runs root stays local");

  // Idempotent, and it never clobbers a rule someone wrote by hand.
  await writeFile(marker, "custom\n", "utf8");
  await ensureRunsIgnored(join(runsRoot, "20260905-130000-efgh"));
  assert.equal(await readFile(marker, "utf8"), "custom\n");
});

// ---------------------------------------------------------------- TM-091 readiness

test("a shell prompt that looks exactly like the ready pattern does not count as ready", () => {
  const claudeish = adapter({ ready: { pattern: "(^|\\n)\\s*[│|]?\\s*[>❯]\\s", timeout_ms: 1 } });
  // What the pane holds the instant before the launcher is typed: a starship prompt that matches.
  const baseline = "~/repo on  main\n❯ ";
  assert.ok(new RegExp(claudeish.ready.pattern, "m").test(baseline), "precondition: the prompt does match the pattern");

  // Nothing new yet, so nothing to decide on.
  assert.equal(screenSince(baseline, baseline), "");
  assert.equal(evaluateScreen(claudeish, screenSince(baseline, baseline)), null);

  // The echoed launcher line still is not the agent's prompt.
  const echoed = `${baseline}bash /repo/.bytedesk/agent-orchestration/runs/r1/agents/a/launch-0.sh\n`;
  assert.equal(evaluateScreen(claudeish, screenSince(echoed, baseline)), null);

  // Only once the CLI draws its own input box is it ready.
  const drawn = `${echoed}\n╭──────────╮\n│ > ` ;
  assert.deepEqual(evaluateScreen(claudeish, screenSince(drawn, baseline)), { ready: true, failed: false, reason: "ready pattern" });
});

test("screenSince anchors on the last occurrence, because tmux trims trailing blank lines", () => {
  assert.equal(screenSince("abc", ""), "abc", "no baseline means the whole screen");
  assert.equal(screenSince("xxTAILyy", "TAIL"), "yy");
  assert.equal(screenSince("TAIL one TAIL two", "TAIL"), " two");
  assert.equal(screenSince("nothing matches", "TAIL"), "nothing matches", "an unfindable baseline must not hide output");
});

test("the fixed-delay path can return ready:false, so the not-ready warning is reachable", () => {
  const delayed = adapter({ ready: { delay_ms: 10 } });
  const verdict = evaluateScreen(delayed, "   \n  \n");
  assert.equal(verdict.ready, false);
  assert.equal(verdict.failed, false, "silence is not a failure — the CLI may still be starting");
  assert.match(verdict.reason, /no output from test after 10ms/);

  assert.deepEqual(evaluateScreen(delayed, "Welcome to test-cli v2\n"), { ready: true, failed: false, reason: "fixed delay" });
});

test("a dead pane fails whichever readiness path the adapter uses", () => {
  for (const ready of [{ delay_ms: 10 }, { pattern: ">" }]) {
    const verdict = evaluateScreen(adapter({ ready }), "some output", { alive: false });
    assert.deepEqual(verdict, { ready: false, failed: true, reason: "pane exited" });
  }
});

test("failure patterns no longer fire on a word that only appears inside a path", () => {
  const generic = adapter({});
  // The launcher path and the run directory are echoed into the pane. Neither is an error.
  assert.equal(failureOnScreen(generic, "bash /home/me/src/capacity-planning/.bytedesk/runs/quota-work/launch-0.sh"), null);
  assert.equal(failureOnScreen(generic, "cd /srv/billing-api && claude"), null);
  assert.equal(failureOnScreen(generic, "see https://docs.example.com/errors/quota for details"), null);

  // Real failure text still matches.
  assert.equal(failureOnScreen(generic, "Error: you have exceeded your quota for this model"), "quota");
  assert.equal(failureOnScreen(generic, "429 Too Many Requests"), "too many requests");
  assert.equal(failureOnScreen(generic, "authentication_error: invalid credentials"), "authentication");
});

test("a failure pattern in fresh output still fails the candidate", () => {
  const verdict = evaluateScreen(adapter({ ready: { pattern: ">" } }), "\nYou have hit your usage limit. Try again later.\n");
  assert.equal(verdict.failed, true);
  assert.match(verdict.reason, /usage limit/);
});

// ---------------------------------------------------------------- TM-102 per-agent memory

test("every shipped provider declares where its memory lives and how it grants a directory", async () => {
  const files = (await readdir(providersDir)).filter((name) => name.endsWith(".json"));
  assert.ok(files.length >= 7, "expected the shipped provider set");
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(providersDir, file), "utf8"));
    const declared = normalizeAdapter(raw, file);
    assert.ok(MEMORY_SCOPES.includes(declared.memory.scope), `${file}: memory.scope`);
    assert.ok("add_dir_args" in raw, `${file}: must declare add_dir_args, even as [] for "cannot"`);
    if (declared.memory.scope !== "none") {
      assert.ok(declared.memory.note.length > 40, `${file}: memory.note must record what was measured`);
    }
  }
});

test("two agents in the same repo do not share memory, and one agent keeps its across spawns", () => {
  const claude = normalizeAdapter(
    { id: "claude", memory: { scope: "cwd", path: "{{home}}/.claude/projects/{{cwd_slug}}/memory" } },
    "claude",
  );
  const home = "/home/me";
  const one = memoryLocation(claude, { cwd: "/repo/.bytedesk/agent-orchestration/agents/a1b2c3d4", home });
  const two = memoryLocation(claude, { cwd: "/repo/.bytedesk/agent-orchestration/agents/9f8e7d6c", home });
  assert.notEqual(one.path, two.path, "a per-agent cwd must produce a per-agent memory");
  assert.equal(one.scope, "cwd");

  // Nothing in the path comes from the run or the spawn, so the same agent finds it again next time.
  const sameAgentLater = memoryLocation(claude, { cwd: "/repo/.bytedesk/agent-orchestration/agents/a1b2c3d4", home });
  assert.equal(sameAgentLater.path, one.path);

  // The sanitizer is Claude's, measured: both "/" and "." become "-".
  assert.equal(sanitizeCwd("/repo/.bytedesk/x"), "-repo--bytedesk-x");
  assert.equal(one.path, "/home/me/.claude/projects/-repo--bytedesk-agent-orchestration-agents-a1b2c3d4/memory");
});

test("the repo is granted through the adapter's own add_dir mechanism, never a hardcoded flag", () => {
  const withAddDir = normalizeAdapter({ id: "claude", command: "claude", add_dir_args: ["--add-dir", "{{dir}}"] }, "x");
  const argv = buildArgv(withAddDir, { args: [], add_dirs: ["/repo", "/repo"] }, {});
  assert.deepEqual(argv, ["claude", "--add-dir", "/repo"], "duplicates collapse; the flag comes from the adapter");

  const gemini = normalizeAdapter({ id: "gemini", command: "gemini", add_dir_args: ["--include-directories", "{{dir}}"] }, "x");
  assert.deepEqual(buildArgv(gemini, { args: [], add_dirs: ["/repo"] }, {}), ["gemini", "--include-directories", "/repo"]);

  const cannot = normalizeAdapter({ id: "grok", command: "grok", add_dir_args: [] }, "x");
  assert.equal(grantsDirs(cannot), false);
  assert.deepEqual(buildArgv(cannot, { args: [], add_dirs: ["/repo"] }, {}), ["grok"], "no mechanism means no invented flag");
});

test("an adapter with a bad memory declaration is rejected at load, not at launch", () => {
  assert.throws(() => normalizeAdapter({ id: "x", memory: { scope: "everywhere" } }, "x"), /memory.scope must be one of/);
  assert.throws(() => normalizeAdapter({ id: "x", memory: { path: 7 } }, "x"), /memory.path must be a string template or null/);
  assert.throws(() => normalizeAdapter({ id: "x", add_dir_args: "--add-dir" }, "x"), /"add_dir_args" must be an array/);
  assert.equal(GENERIC_ADAPTER.memory.scope, "none");
});

test("an agent whose cwd is not the repo is warned about when its CLI cannot be granted the repo", async () => {
  const consumer = process.cwd();
  const spec = materializeSpec(
    validateSpec({
      name: "granting",
      agents: [
        { id: "conductor", role: "orchestrator", cli: "grok", cwd: `${consumer}/topology` },
        { id: "hand", role: "worker", cli: "claude", cwd: `${consumer}/topology` },
      ],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  const adapters = new Map([
    ["grok", normalizeAdapter({ id: "grok", command: "grok", add_dir_args: [] }, "grok")],
    ["claude", normalizeAdapter({ id: "claude", command: "claude", add_dir_args: ["--add-dir", "{{dir}}"] }, "claude")],
  ]);
  const result = await launchRun({ spec, adapters, skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });
  assert.ok(
    result.warnings.some((w) => w.startsWith("agent conductor:") && w.includes("no add_dir_args")),
    result.warnings.join("\n"),
  );
  assert.ok(!result.warnings.some((w) => w.startsWith("agent hand:") && w.includes("no add_dir_args")));

  const granted = result.agents.find((a) => a.id === "hand").candidates[0];
  assert.deepEqual(granted.add_dirs, [consumer], "the repo root is what gets granted");
  assert.ok(granted.command.includes("--add-dir"), granted.command.join(" "));
  assert.ok(granted.command.includes(consumer));
});

// ---------------------------------------------------------------- TM-101 session addressing

test("a session name is the agent's stable id plus a per-spawn discriminator, unique among live sessions", async () => {
  const live = new Set(["a1b2c3d4-0000001"]);
  const minted = ["0000001", "0000001", "beef123"];
  let i = 0;
  const name = await uniqueSessionName("a1b2c3d4", {
    has: async (session) => live.has(session),
    mint: () => minted[i++],
  });
  assert.equal(name, "a1b2c3d4-beef123", "a taken discriminator is re-minted rather than reused");
  assert.equal(i, 3, "each collision costs exactly one re-mint");
});

test("two concurrent spawns of one agent are two distinct, separately addressable sessions", async () => {
  const live = new Set();
  const has = async (session) => live.has(session);
  const first = await uniqueSessionName("a1b2c3d4", { has });
  live.add(first);
  const second = await uniqueSessionName("a1b2c3d4", { has });
  assert.notEqual(first, second);
  for (const session of [first, second]) {
    assert.match(session, /^a1b2c3d4-[0-9a-f]{7}$/, "the agent's address stays readable in the session name");
  }
});

test("minting gives up loudly rather than handing back a name that is already taken", async () => {
  await assert.rejects(
    () => uniqueSessionName("a1b2c3d4", { has: async () => true, mint: () => "fixed12", attempts: 3 }),
    (error) => {
      assert.equal(error.code, "TOPOLOGY_SESSION_NAME_EXHAUSTED");
      return true;
    },
  );
});

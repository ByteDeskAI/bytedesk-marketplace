// Launch-time behaviour that has to hold without a tmux server: the auto_approve consent gate,
// readiness (the shell-prompt false positive, the reachable ready:false, the failure matcher), the
// per-agent memory declaration each provider carries, and session naming for concurrent spawns.
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  decideFromSubscription,
  evaluateScreen,
  launchRun,
  launcherScript,
  mintAgentToken,
  openRoleSession,
  readDeaths,
  roleSessionName,
  roleSessionPath,
  screenSince,
  subscriptionFormat,
  tmuxFailureTrigger,
  tokenDigest,
  uniqueSessionName,
} from "../../topology/lib/launch.mjs";
import * as tmux from "../../topology/lib/tmux.mjs";
import { MIN_PANE_ROWS, windowSizeFor } from "../../topology/lib/tmux.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
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

// ---------------------------------------------------------------- TM-093 per-agent reply tokens

test("an agent token is a capability: long, random, and never repeated", () => {
  const minted = new Set(Array.from({ length: 500 }, () => mintAgentToken()));
  assert.equal(minted.size, 500);
  for (const token of minted) assert.match(token, /^[0-9a-f]{32}$/, "16 random bytes, not a guessable id");
  assert.equal(tokenDigest("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.notEqual(tokenDigest("abc"), "abc", "the record stores a digest, never the secret");
});

test("each agent's launcher exports that agent's token and no other agent's", () => {
  const a = mintAgentToken();
  const b = mintAgentToken();
  const script = (token) =>
    launcherScript({
      agent: { id: "impl", role: "worker", cwd: "/repo" },
      candidate: { cli: "claude" },
      argv: ["claude"],
      env: { AO_AGENT_ID: "impl", AO_AGENT_TOKEN: token },
    });
  const mine = script(a);
  assert.match(mine, new RegExp(`export AO_AGENT_TOKEN=${a}$`, "m"), "the token reaches this pane's environment");
  assert.ok(!mine.includes(b), "and no other agent's token is anywhere in it");
});

test("a spec cannot name the token that decides which agent a pane may answer as", async () => {
  const consumer = process.cwd();
  const spec = materializeSpec(
    validateSpec({
      name: "forgery",
      agents: [{ id: "boss", role: "orchestrator", cli: "claude", env: { AO_AGENT_TOKEN: "chosen-by-the-spec" } }],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  // A spec is data, often committed data. Reached through the launcher the env map builds, the
  // spec's value must lose to the minted one.
  const script = launcherScript({
    agent: spec.agents[0],
    candidate: { cli: "claude" },
    argv: ["claude"],
    env: { ...spec.agents[0].env, AO_AGENT_TOKEN: "minted-at-launch" },
  });
  assert.match(script, /export AO_AGENT_TOKEN=minted-at-launch$/m);
  assert.ok(!script.includes("chosen-by-the-spec"));
});

// ---------------------------------------------------------------- TM-094 coordinator capability

test("a coordinator is launched without the work-tree grant, so it cannot write the repo", async () => {
  const consumer = process.cwd();
  const agentDir = join(consumer, ".bytedesk", "agent-orchestration", "agents", "abc12345");
  const spec = materializeSpec(
    validateSpec({
      name: "coord",
      agents: [
        { id: "lead", role: "orchestrator", cli: "claude", cwd: agentDir, coordinates_only: true },
        { id: "hand", role: "worker", cli: "claude", cwd: agentDir },
      ],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  const adapters = new Map([
    ["generic", normalizeAdapter({ id: "generic" }, "generic")],
    [
      "claude",
      normalizeAdapter(
        { id: "claude", command: "claude", add_dir_args: ["--add-dir", "{{dir}}"], coordinator_args: ["--disallowed-tools", "Write,Edit"] },
        "claude",
      ),
    ],
  ]);
  const result = await launchRun({ spec, adapters, skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });

  const lead = result.agents.find((a) => a.id === "lead").candidates[0];
  assert.deepEqual(lead.add_dirs, [], "a coordinator is granted nothing");
  assert.ok(!lead.command.includes("--add-dir"), lead.command.join(" "));
  assert.ok(!lead.command.includes(consumer), "the work tree must not appear on a coordinator's argv");
  assert.ok(lead.command.join(" ").includes("--disallowed-tools Write,Edit"), lead.command.join(" "));

  // The same agent directory, without coordinates_only, still gets the repo — so the difference is
  // the flag and not the cwd.
  const hand = result.agents.find((a) => a.id === "hand").candidates[0];
  assert.deepEqual(hand.add_dirs, [consumer]);
  assert.ok(hand.command.includes("--add-dir"));
  assert.ok(!hand.command.join(" ").includes("--disallowed-tools"), "only a coordinator is restricted");
});

test("a coordinator on an adapter that cannot drop its write tools is warned about, not quietly trusted", async () => {
  const consumer = process.cwd();
  const spec = materializeSpec(
    validateSpec({
      name: "coord2",
      agents: [{ id: "lead", role: "orchestrator", cli: "grok", cwd: join(consumer, "topology"), coordinates_only: true }],
    }),
    { runId: "r1", consumer, home: consumer, inputs: {} },
  );
  const adapters = new Map([["grok", normalizeAdapter({ id: "grok", command: "grok", coordinator_args: [] }, "grok")]]);
  const result = await launchRun({ spec, adapters, skillSearchDirs: [], roleSearchDirs: [], cliBin: "ao", dryRun: true });
  assert.ok(
    result.warnings.some((w) => w.startsWith("agent lead:") && w.includes("no coordinator_args")),
    result.warnings.join("\n"),
  );
  // It is still contained: nothing outside its own directory was granted.
  assert.deepEqual(result.agents[0].candidates[0].add_dirs, []);
});

test("a restriction beats a permission when one flag expresses both", () => {
  // codex says sandbox mode with a single --sandbox; a coordinator that is also auto_approve must
  // end up read-only, so coordinator_args is appended after auto_approve_args.
  const codex = normalizeAdapter(
    { id: "codex", command: "codex", auto_approve_args: ["--sandbox", "workspace-write"], coordinator_args: ["--sandbox", "read-only"] },
    "codex",
  );
  const argv = buildArgv(codex, { args: [], auto_approve: true, coordinates_only: true }, {});
  assert.deepEqual(argv, ["codex", "--sandbox", "workspace-write", "--sandbox", "read-only"]);
  assert.equal(argv.lastIndexOf("--sandbox") + 1, argv.length - 1);
  assert.equal(argv.at(-1), "read-only", "the last --sandbox value is the one the CLI keeps");
});

test("every shipped provider states a coordinator form, even when that form is 'none'", async () => {
  for (const file of (await readdir(providersDir)).filter((name) => name.endsWith(".json"))) {
    const raw = JSON.parse(await readFile(join(providersDir, file), "utf8"));
    assert.ok("coordinator_args" in raw, `${file}: must declare coordinator_args, even as []`);
    if (raw.coordinator_args.length === 0) {
      assert.match(raw.notes, /[Cc]oordinator form/, `${file}: an empty coordinator_args must say why in notes`);
    }
  }
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


// ---------------------------------------------------------------- TM-099 push, not poll

test("the subscription format asks the server for readiness, failure, death and the exit code", () => {
  const withPattern = adapter({ ready: { tmux_pattern: "^\\s*[>❯]" }, failure_patterns: ["usage limit", "quota"] });
  assert.equal(subscriptionFormat(withPattern), "#{C/r:^\\s*[>❯]}|#{C/r:usage limit|quota}|#{pane_dead}|#{pane_dead_status}");

  // An adapter with no tmux-side pattern still gets death and failure for free; readiness falls back.
  const without = adapter({ failure_patterns: ["quota"] });
  assert.equal(subscriptionFormat(without), "0|#{C/r:quota}|#{pane_dead}|#{pane_dead_status}");
});

test("patterns tmux cannot parse are left out of the trigger rather than breaking the format", () => {
  // Measured: "{" and "}" make tmux return a literal instead of a number, and ":" is the format's
  // own separator — either would make the subscription silently never fire.
  const mixed = adapter({ failure_patterns: ["quota", "a{2}", "host:port", "\\b429\\b"] });
  assert.equal(tmuxFailureTrigger(mixed), "quota|\\b429\\b");
  assert.equal(tmuxFailureTrigger(adapter({ failure_patterns: ["a{2}"] })), null);
  assert.ok(!subscriptionFormat(adapter({ failure_patterns: ["a{2}"] })).includes("a{2}"));
});

test("an adapter whose tmux_pattern tmux cannot parse is rejected at load", () => {
  assert.throws(() => normalizeAdapter({ id: "x", ready: { tmux_pattern: "^a{2}" } }, "x"), /may not contain/);
  assert.throws(() => normalizeAdapter({ id: "x", ready: { tmux_pattern: "[[:space:]]>" } }, "x"), /may not contain/);
});

test("a pushed value decides readiness, and the shell's own prompt still does not count", () => {
  // The pane is cleared before the launcher is sent, so what remains above the agent is the prompt
  // the shell redraws. A content match inside it is the false positive TM-091 removed.
  assert.equal(decideFromSubscription("1|0|0|", { promptLines: 1 }), null, "a match on the prompt line is the prompt");
  assert.equal(decideFromSubscription("2|0|0|", { promptLines: 2 }), null, "a two-line prompt is still the prompt");
  assert.deepEqual(decideFromSubscription("3|0|0|", { promptLines: 2 }), { ready: true, failed: false, reason: "ready pattern (server-side)" });
  assert.equal(decideFromSubscription("0|0|0|", { promptLines: 1 }), null, "no match at all decides nothing");
});

test("a pushed death carries the process's real exit code, not just 'it died'", () => {
  assert.deepEqual(decideFromSubscription("0|0|1|23", {}), {
    ready: false,
    failed: true,
    reason: "pane exited with status 23",
    exit_status: 23,
  });
  // remain-on-exit missing, or killed by a signal: still a death, just without a code.
  assert.deepEqual(decideFromSubscription("0|0|1|", {}), { ready: false, failed: true, reason: "pane exited", exit_status: null });
});

test("a server-side failure hit only asks for a second look; it does not decide", () => {
  // The server has no way to ignore a run path, so letting it decide would reinstate the false
  // positive that a repo called capacity-planning used to trigger.
  assert.deepEqual(decideFromSubscription("0|7|0|", { promptLines: 1 }), { check: "failure" });
});

test("deaths recorded by the pane-died hook parse back with their exit codes", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "ao-deaths-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await readDeaths(dir), [], "no hook output is not an error");
  await writeFile(join(dir, "deaths.tsv"), "%12\t23\n%13\t\n", "utf8");
  assert.deepEqual(await readDeaths(dir), [
    { pane: "%12", status: 23 },
    { pane: "%13", status: null },
  ]);
});

// ---------------------------------------------------------------- TM-096 durable role-sessions

test("a role-session is named from the agent's stable id and never from a run", () => {
  assert.equal(roleSessionName("a1b2c3d4"), "ao-a1b2c3d4");
  assert.equal(roleSessionName("a1b2c3d4", { prefix: "bytedesk" }), "bytedesk-a1b2c3d4");
  // Same name every time: that is what "independent of any single run" means in practice.
  assert.equal(roleSessionName("a1b2c3d4"), roleSessionName("a1b2c3d4"));
});

test("a role-session name refuses the two characters tmux silently mangles", () => {
  // Measured on tmux 3.4: new-session -s "a.b" creates "a_b", and has-session -t "a.b" then fails.
  // A dotted name would make the reattach probe miss and create a second session every call.
  for (const bad of ["a.b", "a:b", "a b", "", "x".repeat(200)]) {
    assert.throws(
      () => roleSessionName(bad),
      (error) => {
        assert.equal(error.code, "TOPOLOGY_SESSION_NAME_INVALID");
        return true;
      },
      `${JSON.stringify(bad)} must be refused`,
    );
  }
});

test("the record lives beside the agent, not inside a run that will be torn down", () => {
  assert.equal(roleSessionPath("/repo/.bytedesk/agent-orchestration/agents", "a1b2c3d4"), "/repo/.bytedesk/agent-orchestration/agents/a1b2c3d4/session.json");
  assert.ok(!roleSessionPath("/repo/agents", "a1").includes("/runs/"));
});

// Real tmux, when there is one. This is the AC that cannot be proved with fakes: the durable state
// IS the session outliving the process, so something has to actually outlive something.
const haveTmux = await promisify(execFile)("tmux", ["-V"]).then(() => true, () => false);

test("reattaching to a live role-session returns the same session rather than a second one", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ao-role-"));
  const agentId = "aatest01";
  const session = roleSessionName(agentId);
  t.after(async () => {
    await promisify(execFile)("tmux", ["kill-session", "-t", `=${session}`]).catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  const open = () =>
    openRoleSession({
      agentsDir: root,
      agentId,
      adapter: normalizeAdapter({ id: "fake", command: "sh" }, "x"),
      argv: ["sh", "-c", "sleep 60"],
      env: { AO_AGENT_ID: agentId },
      role: "lead",
    });

  const first = await open();
  assert.equal(first.created, true);
  assert.equal(first.session, session);

  const second = await open();
  assert.equal(second.created, false, "a second call must not create a second session");
  assert.equal(second.reattached, true);
  assert.equal(second.pane, first.pane, "and it is the same pane, so nothing in flight was lost");

  // The record is what a restore path reads, so it has to be enough to rebuild the session with.
  const record = JSON.parse(await readFile(roleSessionPath(root, agentId), "utf8"));
  assert.equal(record.session, session);
  assert.equal(record.cwd, join(root, agentId));
  assert.match(record.command, /^bash .*session\.sh$/, "one stable entry point, stored verbatim");
  assert.ok(record.command.includes(record.launcher));
  assert.ok(!record.command.includes("/runs/"), "the restore command must not point into a run directory");
  assert.ok(record.restore_contract.length > 40, "the contract is stated in the record, for whoever reads it");
});

// -------------------------------------------------------------------------------------------
// Pane geometry. Readiness is decided by searching what a pane RENDERS, and that search is per
// rendered line, so geometry is a correctness property: a pattern wider than the pane is split
// across two lines and can never match. Both of these are regressions that shipped once.

test("the window is sized so every agent's pane stays wider than a ready pattern", () => {
  // Width is fixed: main-vertical gives the main pane main-pane-width (80) and stacks the rest in
  // one column of the remainder, so the stacked panes get ~139 columns at any agent count.
  for (const agents of [1, 3, 10, 40]) {
    assert.equal(windowSizeFor(agents).width, 220, `${agents} agents must not narrow the window`);
  }
  // Height is what scales — the stacked panes share it, and a pane shorter than a CLI's startup
  // banner scrolls the ready line out of the region the server searches.
  assert.equal(windowSizeFor(3).height, 60, "a small team still gets a usable floor");
  assert.equal(windowSizeFor(10).height, 10 * MIN_PANE_ROWS);
  for (const agents of [8, 12, 30]) {
    assert.ok(
      windowSizeFor(agents).height / agents >= MIN_PANE_ROWS,
      `${agents} agents must still get ${MIN_PANE_ROWS} rows each`,
    );
  }
  // Nonsense in must not produce a zero-sized window, which tmux refuses outright.
  for (const bad of [0, -1, undefined, null, NaN, "x"]) {
    const size = windowSizeFor(bad);
    assert.ok(size.width > 0 && size.height > 0, `${String(bad)} must still give a real size`);
  }
});

test("splitting for a large team re-equalizes, so the seventh agent still gets a pane", { skip: haveTmux ? false : "no tmux" }, async (t) => {
  // split-window -t <window> splits the ACTIVE pane, so consecutive splits halve the same pane —
  // 60 rows becomes 30, 15, 7, 3 — and this used to fail outright with "no space for new pane".
  const session = `aosplit${Math.random().toString(36).slice(2, 8)}`;
  t.after(async () => {
    await promisify(execFile)("tmux", ["kill-session", "-t", `=${session}`]).catch(() => {});
  });
  const size = windowSizeFor(10);
  const firstPane = await tmux.newSession(session, { cwd: tmpdir(), windowName: "main", ...size });
  assert.match(firstPane, /^%\d+$/);

  const ids = await tmux.splitPanes(`${session}:main`, Array.from({ length: 9 }, () => tmpdir()));
  assert.equal(ids.length, 9, "every agent after the first needs its own pane");
  assert.equal(new Set([firstPane, ...ids]).size, 10, "and they must all be distinct panes");

  await tmux.selectLayout(`${session}:main`, "main-vertical");
  const panes = await tmux.listPanes(session);
  assert.equal(panes.length, 10);

  // The geometry is ours, and it survives a client attaching — which is the failure this fixes: on
  // a shared tmux server the window otherwise takes the size of some unrelated session's terminal.
  const widthOf = async () =>
    Number((await promisify(execFile)("tmux", ["display-message", "-p", "-t", `${session}:main`, "#{window_width}"])).stdout.trim());
  assert.equal(await widthOf(), size.width, "the requested width must actually be the window's width");

  const client = new tmux.ControlClient(session);
  t.after(() => client.close());
  if (await client.start()) {
    assert.equal(await widthOf(), size.width, "a control client must not reflow the agents");
  }
});

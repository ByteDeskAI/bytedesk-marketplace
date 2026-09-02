/**
 * TM-081 — Pi (@earendil-works/pi-coding-agent) harness integration, measured off the
 * real 0.82.0 install on this machine.
 *
 * Facts pinned here, all observed rather than documented-from-memory:
 *   - Pi ships seven built-in tools — read, bash, edit, write, grep, find, ls
 *     (dist/core/tools/) — and NO native task/todo tool; the todo list and plan-mode in
 *     its CHANGELOG are example extensions, not shipped tools. A histogram of every
 *     toolCall in this machine's own ~/.pi/agent/sessions found zero task-tool calls.
 *     So the adapter (lib/harness/pi.mjs) is deliberately inert and registers nothing.
 *   - PI_SESSION_ID / PI_SESSION_FILE are set for bash-tool subprocesses (measured live:
 *     the toolResult in tests/fixtures/pi-session.jsonl is a real `env | grep` through
 *     pi's bash tool). Extensions instead read ctx.sessionManager.getSessionId() and put
 *     it on the hook payload — the Codex path (session_id → TM_SESSION_ID).
 *   - Transcripts live at ~/.pi/agent/sessions/--<cwd>--/<ISO-ts>_<session-uuid>.jsonl.
 *     Pi's sanitizer strips the leading slash and turns `/ \ :` into `-`, then wraps in
 *     `--` — dots SURVIVE, unlike Claude's (dist/core/session-manager.js, verified
 *     against the directories pi actually wrote).
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PI_TOOLS, toIntents, wouldCreate } from "../../lib/harness/pi.mjs";
import { adapterFor } from "../../lib/harness/index.mjs";
import { HARNESSES, SESSION_ENV, currentHarness, harnessById } from "../../lib/harness/sessions.mjs";
import { sessionId } from "../../lib/actor.mjs";
import { toMessage, workStream } from "../../lib/transcript.mjs";
import { cleanup } from "./helpers.mjs";

const fixtureLines = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "pi-session.jsonl"),
  "utf8",
)
  .split("\n")
  .filter(Boolean);
const fixture = fixtureLines.map((l) => JSON.parse(l));

const dirs = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "pi-home-"));
  dirs.push(d);
  return d;
};
after(() => cleanup(...dirs));

describe("the captured session fixture", () => {
  it("is verbatim v3 wire: session header first, tree-linked entries after", () => {
    const [head, ...rest] = fixture;
    assert.deepEqual(Object.keys(head).sort(), ["cwd", "id", "timestamp", "type", "version"]);
    assert.equal(head.type, "session");
    assert.equal(head.version, 3);
    assert.equal(head.id, "01a062d5-7659-7e2d-b38e-9b6f20f8305e");
    assert.equal(head.cwd, "/tmp");
    for (const e of rest) {
      assert.ok(e.id && "parentId" in e, "every entry is tree-linked by id/parentId");
    }
  });

  it("carries the live proof that pi's bash tool exports PI_SESSION_ID", () => {
    const toolResult = fixture.find((e) => e.message?.role === "toolResult");
    assert.equal(toolResult.message.toolName, "bash");
    const text = toolResult.message.content.map((c) => c.text).join("\n");
    assert.match(text, /^PI_SESSION_ID$/m);
    assert.match(text, /^PI_SESSION_FILE$/m);
  });
});

describe("the measured-empty adapter", () => {
  it("registers no tools — pi 0.82.0 ships none that track tasks", () => {
    assert.equal(PI_TOOLS.size, 0, "an invented tool name reads as support and never matches");
    for (const name of ["read", "bash", "edit", "write", "grep", "find", "ls"]) {
      assert.equal(adapterFor({ tool_name: name }), null, `pi's built-in ${name} is not a task surface`);
      assert.equal(PI_TOOLS.has(name), false);
    }
  });

  it("maps nothing to intents and gates nothing", () => {
    assert.deepEqual(toIntents({ tool_name: "bash", tool_input: { command: "ls" } }), []);
    assert.deepEqual(toIntents({}), []);
    assert.equal(wouldCreate({ tool_name: "bash", tool_input: { command: "ls" } }), false);
    assert.equal(wouldCreate({}), false);
  });
});

describe("session resolution", () => {
  it("recognises pi by the variable its bash tool actually sets", () => {
    assert.deepEqual(harnessById("pi").sessionEnv, ["PI_SESSION_ID"]);
    assert.equal(currentHarness({ PI_SESSION_ID: "p-1" })?.id, "pi");
    assert.equal(sessionId({ PI_SESSION_ID: "p-1" }), "p-1");
  });

  it("extends the SESSION_ENV chain without disturbing the existing order", () => {
    assert.deepEqual(SESSION_ENV, [
      "TM_SESSION_ID",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_SESSION_ID",
      "CODEX_THREAD_ID",
      "GROK_SESSION_ID",
      "PI_SESSION_ID",
    ]);
  });
});

describe("finding the Pi transcript", () => {
  /** A ~/.pi tree the way the real CLI writes it — fixture content, pattern-named file. */
  function piHome(cwd, session = "01a062d5-7659-7e2d-b38e-9b6f20f8305e") {
    const h = home();
    const dir = join(h, ".pi", "agent", "sessions", `--${cwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`);
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `2026-09-02T15-55-51-769Z_${session}.jsonl`);
    writeFileSync(file, `${fixtureLines.join("\n")}\n`);
    return { h, file };
  }

  it("locates a session by the uuid at the tail of the filename", () => {
    const { h, file } = piHome("/tmp");
    assert.equal(harnessById("pi").transcript("/tmp", "01a062d5-7659-7e2d-b38e-9b6f20f8305e", h), file);
  });

  it("keeps dots in the directory name, unlike Claude's sanitizer", () => {
    const cwd = "/repo/.claude/worktrees/thing";
    const { h, file } = piHome(cwd);
    assert.match(file, /--repo-\.claude-worktrees-thing--/);
    assert.equal(harnessById("pi").transcript(cwd, "01a062d5-7659-7e2d-b38e-9b6f20f8305e", h), file);
  });

  it("falls back to the project's newest session when no id is given", () => {
    const { h, file } = piHome("/repo");
    assert.equal(harnessById("pi").transcript("/repo", null, h), file);
  });

  it("scopes the fallback to the project's own directory", () => {
    const { h } = piHome("/repo");
    assert.equal(harnessById("pi").transcript("/other-project", null, h), null);
  });

  it("returns null rather than guessing when pi has written nothing", () => {
    assert.equal(harnessById("pi").transcript("/tmp", "nope", home()), null);
    for (const h of HARNESSES) assert.equal(h.transcript("/repo", "nope", home()), null);
  });
});

describe("the work stream over a pi transcript", () => {
  it("reads no messages with the claude parser and falls back to raw lines, saying why", () => {
    const h = home();
    const dir = join(h, ".pi", "agent", "sessions", "--tmp--");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "2026-09-02T15-55-51-769Z_01a062d5-7659-7e2d-b38e-9b6f20f8305e.jsonl"),
      `${fixtureLines.join("\n")}\n`,
    );

    // Every pi entry maps to null under the claude-jsonl reader — the format is its own.
    assert.equal(toMessage(fixture[3], "pi-session"), null);

    const s = workStream({}, { session: "01a062d5-7659-7e2d-b38e-9b6f20f8305e" }, "/tmp", h, {
      PI_SESSION_ID: "01a062d5-7659-7e2d-b38e-9b6f20f8305e",
    });
    assert.equal(s.harness, "pi");
    assert.match(s.reason, /format has changed/, "raw beats an empty box that reads as idle");
    assert.ok(s.messages.length > 0, "the raw lines still show what the agent is doing");
  });
});

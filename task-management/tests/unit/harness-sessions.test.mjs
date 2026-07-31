/**
 * TM-039 — the plugin runs under Claude Code, Codex CLI and Grok, or says which it cannot.
 *
 * Every constant here was read off an installed CLI, not a doc: the env names out of the shipped
 * binaries, the layouts off session files those tools had already written. The point of the tests
 * is to keep it that way — `CODEX_SESSION_ID` sat in the fallback chain for a release and exists
 * nowhere in Codex, which reads as support and never matches.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HARNESSES, SESSION_ENV, currentHarness, harnessById } from "../../lib/harness/sessions.mjs";
import { sessionId } from "../../lib/actor.mjs";
import { toMessage, workStream } from "../../lib/transcript.mjs";

const dirs = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "home-"));
  dirs.push(d);
  return d;
};
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("which harness is running", () => {
  it("recognises each CLI by the variable it actually sets", () => {
    assert.equal(currentHarness({ CLAUDE_CODE_SESSION_ID: "a" })?.id, "claude");
    assert.equal(currentHarness({ CODEX_THREAD_ID: "b" })?.id, "codex");
    assert.equal(currentHarness({ GROK_SESSION_ID: "c" })?.id, "grok");
  });

  it("says nobody rather than assuming Claude Code", () => {
    assert.equal(currentHarness({}), null, "a bare shell or CI run is not Claude Code");
  });

  it("carries no variable that does not exist", () => {
    assert.equal(
      SESSION_ENV.includes("CODEX_SESSION_ID"),
      false,
      "Codex sets CODEX_THREAD_ID; the other name was invented and silently never matched",
    );
  });

  it("gives the session id from whichever harness is running", () => {
    assert.equal(sessionId({ CODEX_THREAD_ID: "t-1" }), "t-1");
    assert.equal(sessionId({ GROK_SESSION_ID: "g-1" }), "g-1");
    assert.equal(sessionId({}), null);
  });
});

describe("finding each harness's transcript", () => {
  const cwd = "/repo/.claude/worktrees/thing"; // dots and slashes both, on purpose

  it("locates a Claude Code transcript, sanitising dots as well as slashes", () => {
    const h = home();
    const dir = join(h, ".claude", "projects", "-repo--claude-worktrees-thing");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "sess-1.jsonl"), "");
    assert.equal(harnessById("claude").transcript(cwd, "sess-1", h), join(dir, "sess-1.jsonl"));
  });

  it("locates a Codex rollout by the thread id at the tail of its filename", () => {
    const h = home();
    const dir = join(h, ".codex", "sessions", "2026", "07", "30");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "rollout-2026-07-30T19-12-27-thread-9.jsonl");
    writeFileSync(file, "");
    assert.equal(harnessById("codex").transcript(cwd, "thread-9", h), file, "dated directories, id at the end");
  });

  it("locates a Grok session under its percent-encoded cwd", () => {
    const h = home();
    const dir = join(h, ".grok", "sessions", encodeURIComponent(cwd), "sess-2");
    mkdirSync(dir, { recursive: true });
    const file = join(dir, "chat_history.jsonl");
    writeFileSync(file, "");
    assert.equal(harnessById("grok").transcript(cwd, "sess-2", h), file);
  });

  it("returns null rather than guessing when the harness has written nothing", () => {
    for (const h of HARNESSES) assert.equal(h.transcript(cwd, "nope", home()), null);
  });
});

describe("reading each format", () => {
  it("reads a Codex rollout message and tool call", () => {
    const msg = toMessage(
      { type: "response_item", timestamp: "T", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } },
      "codex-rollout",
    );
    assert.equal(msg.parts[0].text, "done");

    const call = toMessage(
      { type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c1", arguments: '{"cmd":"ls -la"}' } },
      "codex-rollout",
    );
    assert.equal(call.parts[0].toolName, "exec_command");

    assert.equal(
      toMessage({ type: "response_item", payload: { type: "reasoning", summary: "…" } }, "codex-rollout"),
      null,
      "reasoning is internal, like Claude's thinking blocks",
    );
  });

  it("reads a Grok chat entry with its tool calls", () => {
    const msg = toMessage({ role: "assistant", content: "on it", tool_calls: [{ id: "t1", function: { name: "shell", arguments: '{"command":"ls"}' } }] }, "grok-chat");
    assert.deepEqual(msg.parts.map((p) => p.type), ["text", "tool-call"]);
  });

  it("does not read one harness's transcript with another's parser", () => {
    const codexLine = { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "x" }] } };
    assert.equal(toMessage(codexLine, "claude-jsonl"), null, "wrong parser must yield nothing, not nonsense");
  });
});

describe("what the panel actually shows (TM-044)", () => {
  it("drops the harness's own preamble, which is not work", () => {
    // Codex opens every turn by injecting the instruction file, the plugin catalogue and the
    // environment block as a `user` message. Left in, it is the first and largest thing in the
    // panel and the run is buried inside it.
    const preamble = {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<recommended_plugins>\nAtlassian Rovo\n</recommended_plugins>" }] },
    };
    assert.equal(toMessage(preamble, "codex-rollout"), null);

    const real = {
      type: "response_item",
      payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Run one command and stop." }] },
    };
    assert.equal(toMessage(real, "codex-rollout").parts[0].text, "Run one command and stop.");
  });

  it("shows a tool call's arguments whichever harness named the field", () => {
    const codex = toMessage(
      { type: "response_item", payload: { type: "function_call", name: "exec_command", call_id: "c", arguments: '{"cmd":"echo hi"}' } },
      "codex-rollout",
    );
    assert.equal(codex.parts[0].args.cmd, "echo hi", "Codex calls it cmd");

    const grok = toMessage({ role: "assistant", tool_calls: [{ id: "t", function: { name: "read_file", arguments: '{"target_file":"/repo/lib/x.mjs"}' } }] }, "grok-chat", "/repo");
    assert.equal(grok.parts[0].args.target_file, "lib/x.mjs", "Grok calls it target_file — and the path is shortened to the project");
  });

  it("caps a single message so it cannot push the rest of the stream off screen", () => {
    const long = "x".repeat(5000);
    const msg = toMessage({ type: "user", message: { content: [{ type: "text", text: long }] } }, "claude-jsonl");
    assert.ok(msg.parts[0].text.length < 1000, "a live view, not an archive");
    assert.match(msg.parts[0].text, /…$/, "and it says it was cut");
  });

  it("falls back to raw lines when a format changes under us", () => {
    const h = home();
    const dir = join(h, ".codex", "sessions", "2026", "07", "31");
    mkdirSync(dir, { recursive: true });
    // Readable JSON that this version maps to nothing — the shape Codex might ship next.
    writeFileSync(join(dir, "rollout-x-t9.jsonl"), `${JSON.stringify({ type: "turn_item", v: 2, content: "new shape" })}\n`);

    const s = workStream({}, { session: "t9" }, "/repo", h, { CODEX_THREAD_ID: "t9" });
    assert.equal(s.messages.length, 1, "showing it raw beats showing nothing");
    assert.match(s.messages[0].parts[0].text, /turn_item/);
    assert.match(s.reason, /format has changed/, "and the panel says why it looks like that");
  });
});

describe("the work stream says what it cannot do", () => {
  it("names the harness it read from", () => {
    const h = home();
    const dir = join(h, ".codex", "sessions", "2026", "07", "30");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "rollout-x-thread-9.jsonl"),
      `${JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] } })}\n`,
    );

    const s = workStream({}, { session: "thread-9" }, "/repo", h, { CODEX_THREAD_ID: "thread-9" });
    assert.equal(s.harness, "codex");
    assert.equal(s.messages.length, 1);
  });

  it("explains itself when no agent CLI is running, instead of showing an empty panel", () => {
    const s = workStream({}, null, "/repo", home(), {});
    assert.equal(s.harness, null);
    assert.match(s.reason, /no agent CLI/);
    assert.deepEqual(s.messages, []);
  });

  it("distinguishes 'no harness' from 'harness with nothing written yet'", () => {
    const s = workStream({}, null, "/repo", home(), { GROK_SESSION_ID: "g" });
    assert.equal(s.harness, "grok");
    assert.match(s.reason, /Grok CLI has written no transcript/);
  });
});

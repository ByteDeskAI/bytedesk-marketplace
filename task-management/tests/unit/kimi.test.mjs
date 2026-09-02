/**
 * TM-071 — Kimi Code harness adapter, measured off the real install.
 *
 * Facts pinned here, all observed rather than documented-from-memory:
 *   - TodoList payloads carry { todos: [{ title, status: pending|in_progress|done }] }
 *     with NO item ids (tests/fixtures/kimi-todolist-payload.json, captured from a live
 *     session's wire.jsonl), so rows key by a content hash: kimi-todo:<sha1(title)[0:12]>.
 *   - Kimi sets no session env var; `KIMI_SESSION_ID` in the binary is a skill-template
 *     placeholder, not a variable. The session id arrives on the hook payload
 *     (`session_id`) and reaches the store through TM_SESSION_ID — the Codex path.
 *   - Transcripts live at ~/.kimi-code/sessions/<workspace-id>/<session-id>/agents/
 *     <agent>/wire.jsonl; workspaces.json maps workspace id → project root.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { adapterFor, preCreateGate, toIntents } from "../../lib/harness/index.mjs";
import { applyIntents } from "../../lib/harness/apply.mjs";
import { HARNESSES, SESSION_ENV, currentHarness, harnessById } from "../../lib/harness/sessions.mjs";
import { sessionId } from "../../lib/actor.mjs";
import { create, list, writeState } from "../../lib/store.mjs";
import { cleanup, tempStore, withSessionEnv } from "./helpers.mjs";

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "kimi-todolist-payload.json"), "utf8"),
);

const stamp = () => ({ session: "t", branch: "main" });

const dirs = [];
const store = () => {
  const p = tempStore();
  dirs.push(p.root);
  return p;
};
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-home-"));
  dirs.push(d);
  return d;
};
after(() => cleanup(...dirs));

describe("TodoList wire → intents", () => {
  it("strategy map selects the kimi adapter for TodoList only", () => {
    assert.equal(adapterFor({ tool_name: "TodoList" })?.toIntents.name, "toIntents");
    assert.equal(adapterFor({ tool_name: "TodoList" }), adapterFor(fixture));
    assert.equal(adapterFor({ tool_name: "todolist" }), null, "tool name is exactly TodoList");
    assert.equal(adapterFor({ tool_name: "TaskCreate" })?.toIntents.name, "toIntents");
  });

  it("maps the captured fixture to hash-keyed update intents", () => {
    const intents = toIntents(fixture);
    assert.equal(intents.length, 3);
    for (const i of intents) {
      assert.equal(i.op, "update");
      assert.equal(i.via, "kimi");
      assert.match(i.nativeId, /^kimi-todo:[0-9a-f]{12}$/);
    }
    assert.equal(intents[0].status, "done");
    assert.equal(intents[1].status, "in_progress");
    assert.equal(intents[1].title, "Implement the kimi adapter");
    assert.equal(intents[2].status, "open", "pending → open");
  });

  it("gives the same title the same nativeId across calls", () => {
    const a = toIntents({ tool_name: "TodoList", tool_input: { todos: [{ title: "Add fixture-driven tests", status: "pending" }] } });
    const b = toIntents({ tool_name: "TodoList", tool_input: { todos: [{ title: "  Add fixture-driven   tests ", status: "done" }] } });
    assert.equal(a[0].nativeId, b[0].nativeId, "whitespace/case-insensitive hash, like the codex adapter");
    assert.equal(b[0].status, "done");
  });

  it("treats a query-mode call (no todos) as nothing", () => {
    assert.deepEqual(toIntents({ tool_name: "TodoList", tool_input: {} }), []);
    assert.deepEqual(toIntents({ tool_name: "TodoList" }), []);
  });
});

describe("mirroring into the store", () => {
  it("creates then completes by native id without duplicating", () => {
    const p = store();
    create("epic", { title: "K" }, "", p);
    writeState({ activeEpic: list("epic", {}, p)[0].id }, p);

    applyIntents(toIntents(fixture), { p, stamp });
    let tasks = list("task", {}, p);
    assert.equal(tasks.length, 3);
    const wip = tasks.find((t) => t.title === "Implement the kimi adapter");
    assert.match(wip.nativeId, /^kimi-todo:/);
    assert.equal(wip.status, "in_progress");

    // Next TodoList write replaces the list with updated statuses — same titles, same rows.
    applyIntents(
      toIntents({
        tool_name: "TodoList",
        tool_input: {
          todos: [
            { title: "Read the existing harness adapters", status: "done" },
            { title: "Implement the kimi adapter", status: "done" },
            { title: "Add fixture-driven tests", status: "in_progress" },
          ],
        },
      }),
      { p, stamp },
    );
    tasks = list("task", {}, p);
    assert.equal(tasks.length, 3, "same titles update the same rows");
    assert.equal(tasks.find((t) => t.title === "Implement the kimi adapter").status, "done");
    assert.equal(tasks.find((t) => t.title === "Add fixture-driven tests").status, "in_progress");
  });

  it("preCreateGate denies an open todo list without an epic, allows bookkeeping", () => {
    const p = store();
    assert.equal(preCreateGate(fixture, p).allow, false, "pending/in_progress items are new work");

    const done = { tool_name: "TodoList", tool_input: { todos: [{ title: "x", status: "done" }] } };
    assert.equal(preCreateGate(done, p).allow, true, "all-done is bookkeeping");

    const query = { tool_name: "TodoList", tool_input: {} };
    assert.equal(preCreateGate(query, p).allow, true, "reading the list creates nothing");
  });
});

describe("session resolution", () => {
  it("kimi carries no env var — none was observed on the real install", () => {
    const kimi = harnessById("kimi");
    assert.deepEqual(kimi.sessionEnv, [], "KIMI_SESSION_ID is a skill-template placeholder, not a variable the CLI sets");
    assert.equal(SESSION_ENV.includes("KIMI_SESSION_ID"), false, "an invented name reads as support and never matches");
    assert.equal(currentHarness({ KIMI_SESSION_ID: "k-1" }), null, "so it must not detect a harness either");
  });

  it("keeps the existing SESSION_ENV chain exactly, TM_SESSION_ID first", () => {
    assert.deepEqual(SESSION_ENV, [
      "TM_SESSION_ID",
      "CLAUDE_CODE_SESSION_ID",
      "CLAUDE_SESSION_ID",
      "CODEX_THREAD_ID",
      "GROK_SESSION_ID",
    ]);
  });

  it("resolves a Kimi session through the TM_SESSION_ID override, set off the hook payload", () => {
    withSessionEnv({ TM_SESSION_ID: "session_00000000-0000-4000-8000-000000000000" }, () => {
      assert.equal(sessionId(), "session_00000000-0000-4000-8000-000000000000");
    });
    assert.equal(sessionId({}), null, "unknown/absent vars fall through cleanly");
  });
});

describe("finding the Kimi transcript", () => {
  const cwd = "/repo";

  /** A ~/.kimi-code tree the way the real CLI writes it. */
  function kimiHome({ withWorkspace = true } = {}) {
    const h = home();
    const ws = "wd_repo_0123456789ab";
    if (withWorkspace) {
      mkdirSync(join(h, ".kimi-code"), { recursive: true });
      writeFileSync(
        join(h, ".kimi-code", "workspaces.json"),
        JSON.stringify({ version: 1, workspaces: { [ws]: { root: cwd, name: "repo" } } }),
      );
    }
    const sessionDir = join(h, ".kimi-code", "sessions", ws, "session_abc");
    mkdirSync(join(sessionDir, "agents", "main"), { recursive: true });
    writeFileSync(join(sessionDir, "agents", "main", "wire.jsonl"), '{"type":"metadata"}\n');
    return { h, sessionDir };
  }

  it("locates a session's main wire by id, across workspace dirs", () => {
    const { h, sessionDir } = kimiHome();
    assert.equal(
      harnessById("kimi").transcript(cwd, "session_abc", h),
      join(sessionDir, "agents", "main", "wire.jsonl"),
    );
  });

  it("falls back to the project's newest session when no id is given", () => {
    const { h, sessionDir } = kimiHome();
    assert.equal(harnessById("kimi").transcript(cwd, null, h), join(sessionDir, "agents", "main", "wire.jsonl"));
  });

  it("prefers the main agent's wire over a subagent's", () => {
    const { h, sessionDir } = kimiHome();
    mkdirSync(join(sessionDir, "agents", "agent-0"), { recursive: true });
    writeFileSync(join(sessionDir, "agents", "agent-0", "wire.jsonl"), '{"type":"metadata"}\n');
    assert.equal(harnessById("kimi").transcript(cwd, "session_abc", h), join(sessionDir, "agents", "main", "wire.jsonl"));
  });

  it("returns null rather than guessing when Kimi has written nothing", () => {
    assert.equal(harnessById("kimi").transcript(cwd, "nope", home()), null);
    assert.equal(harnessById("kimi").transcript(cwd, null, kimiHome({ withWorkspace: false }).h), null, "no workspaces.json mapping, no answer");
  });

  it("keeps every harness answering null for an unknown session on an empty home", () => {
    for (const h of HARNESSES) assert.equal(h.transcript("/repo", "nope", home()), null);
  });
});

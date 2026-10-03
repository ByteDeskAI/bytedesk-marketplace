/**
 * End to end through bin/tm with TM_STORAGE=nats: the sync bridge, the store routing, and the
 * leaf-node offline path. The server is a real nats-server that this test kills and restarts.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, tempStore } from "./helpers.mjs";
import { startServer } from "./nats-helpers.mjs";
import { NatsBackend } from "../../lib/storage/nats-backend.mjs";
import { repoKey } from "../../lib/storage/index.mjs";
import { writeConfig } from "../../lib/store.mjs";

const TM = fileURLToPath(new URL("../../bin/tm", import.meta.url));
let srv, p, cache, env;

const tm = (...args) => {
  const t0 = Date.now();
  const r = spawnSync("node", [TM, ...args], { env, encoding: "utf8", timeout: 60_000 });
  return { code: r.status, out: r.stdout, err: r.stderr, ms: Date.now() - t0 };
};

before(async () => {
  srv = await startServer();
  cache = mkdtempSync(join(tmpdir(), "tm-off-cache-"));
  p = tempStore();
  writeConfig({ enforce: false, requireEpic: false, requireAcceptance: false }, p);
  env = { ...process.env, TM_ROOT: p.root, TM_STORAGE: "nats", TM_NATS_URL: srv.url, TM_CACHE_DIR: cache, TM_LOCK_TIMEOUT_MS: "5000" };
  for (const k of Object.keys(env)) if (/^NATS_/.test(k)) delete env[k];
});
after(async () => {
  await srv.cleanup();
  cleanup(p.root, cache);
});

describe("tm over NATS, online and offline", () => {
  it("creates, lists and comments through the bridge; nothing lands in the markdown dir", () => {
    const made = tm("task", "new", "first task", "--body", "hello");
    console.log("task new:", made.code, made.out.trim(), made.err.trim());
    assert.equal(made.code, 0, made.err);
    const board = tm("board");
    assert.equal(board.code, 0, board.err);
    assert.match(board.out, /first task/);
    assert.doesNotMatch(board.err, /offline/);
    assert.equal(existsSync(join(p.tasks, "TM-001-first-task.md")), false, "task is in NATS, not on disk");
    const c = tm("comment", "TM-001", "online note");
    assert.equal(c.code, 0, c.err);
  });

  let queueCopy;
  it("server killed: tm board fails fast with the offline message and still shows the cached board", async () => {
    await srv.stop();
    const board = tm("board");
    console.log(`offline board: exit=${board.code} ${board.ms}ms stderr=${JSON.stringify(board.err.trim())} first-line=${JSON.stringify(board.out.split("\n")[0])}`);
    assert.ok(board.ms < 15_000, `took ${board.ms}ms`);
    assert.match(board.err, /offline: read-only, writes queued/);
    assert.match(board.out, /first task/);
  });

  it("a write while offline is queued as a proposal, not dropped and not hung", () => {
    const c = tm("comment", "TM-001", "queued note");
    console.log("offline comment:", c.code, c.ms + "ms", JSON.stringify(c.err.trim()));
    assert.equal(c.code, 0, c.err);
    assert.match(c.err, /offline: read-only, writes queued/);
    const dir = join(cache, repoKey(p));
    const q = readFileSync(join(dir, "queue.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    console.log("queue ops:", JSON.stringify(q.map((r) => [r.op, r.type, r.id, r.proposalId])));
    assert.ok(q.some((r) => r.op === "put" && r.id === "TM-001"));
    copyFileSync(join(dir, "queue.jsonl"), join(dir, "queue.copy"));
  });

  it("server back: state returns, the queued write replays once, and replaying the same queue again changes nothing", async () => {
    srv = await srv.restart();
    const board = tm("board");
    assert.equal(board.code, 0, board.err);
    assert.doesNotMatch(board.err, /offline/);
    const b = new NatsBackend({ repo: repoKey(p), url: srv.url });
    const comments = async () => (await b.get("tm/task", "TM-001")).envelope.data.comments.map((c) => c.text ?? c.body ?? JSON.stringify(c));
    const first = await comments();
    console.log("comments after replay:", JSON.stringify(first));
    assert.deepEqual(first.filter((t) => /queued note/.test(t)).length, 1);
    assert.equal(readFileSync(join(cache, repoKey(p), "queue.jsonl"), "utf8"), "", "queue drained");
    // someone else edits the task after the replay; replaying the old queue must not clobber it
    const cur = await b.get("tm/task", "TM-001");
    await b.put("tm/task", "TM-001", { ...cur.envelope, data: { ...cur.envelope.data, title: "edited elsewhere" } }, { ifRev: cur.rev });
    // put the same proposals back and reconnect: idempotent, no second copy
    copyFileSync(join(cache, repoKey(p), "queue.copy"), join(cache, repoKey(p), "queue.jsonl"));
    const again = tm("board");
    assert.equal(again.code, 0, again.err);
    const second = await comments();
    console.log("comments after second replay:", JSON.stringify(second));
    assert.equal(second.filter((t) => /queued note/.test(t)).length, 1);
    const title = (await b.get("tm/task", "TM-001")).envelope.data.title;
    console.log("title after second replay:", title);
    assert.equal(title, "edited elsewhere", "a replayed proposal must not overwrite a newer remote change");
    await b.close();
  });
});

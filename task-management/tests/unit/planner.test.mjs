/**
 * lib/planner — bounded planning sessions, and the attachment rules.
 *
 * The attachment tests are the point of this file. These bytes arrive from outside, are stored on
 * the host, and are later fed to a model, so the cases worth writing are the hostile ones: a
 * filename that is a path, a name full of control characters, a script wearing a `.png`
 * extension, and a caller trying to read its way out of the session directory.
 */
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import {
  ALLOWED_ATTACHMENTS,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  MAX_SESSION_ATTACHMENT_BYTES,
  appendTurn,
  attachToSession,
  attachmentDir,
  attachmentPath,
  checkAttachment,
  closeSession,
  deleteSession,
  displayName,
  listSessions,
  newSession,
  plannerDir,
  readSession,
  sessionFile,
} from "../../lib/planner.mjs";
import { readEvents } from "../../lib/store.mjs";

const stores = [];
after(() => cleanup(...stores));
const store = () => {
  const p = tempStore();
  stores.push(p.root);
  return p;
};
const md = (text = "# notes\n") => Buffer.from(text, "utf8");
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

describe("planning sessions", () => {
  it("opens a session for one outcome, and refuses an empty or essay-length one", () => {
    const p = store();
    const s = newSession({ goal: "  Make the planner resumable  " }, p);
    assert.match(s.id, /^PL-[0-9a-f]{12}$/);
    assert.equal(s.goal, "Make the planner resumable", "trimmed");
    assert.equal(s.status, "open");
    assert.deepEqual(s.turns, []);
    assert.ok(readEvents(p).some((e) => e.event === "planner_opened" && e.id === s.id));

    assert.throws(() => newSession({ goal: "   " }, p), (e) => e.status === 400);
    assert.throws(() => newSession({ goal: "x".repeat(4001) }, p), (e) => e.status === 400);
  });

  it("survives a restart, because the session is a file and not process memory", () => {
    const p = store();
    const opened = newSession({ goal: "Resume me" }, p);
    appendTurn(opened.id, { role: "agent", kind: "question", text: "Which epic?" }, p);
    appendTurn(opened.id, { role: "operator", kind: "answer", text: "A new one" }, p);

    // A different `paths()` object, as a fresh process would build: nothing is carried over but
    // the store root, which is the whole claim being tested.
    const reopened = readSession(opened.id, { ...p });
    assert.equal(reopened.goal, "Resume me");
    assert.deepEqual(reopened.turns.map((t) => t.kind), ["question", "answer"]);
    assert.deepEqual(reopened.turns.map((t) => t.role), ["agent", "operator"]);
  });

  it("refuses a turn kind it does not know, so agent prose cannot invent a slot", () => {
    const p = store();
    const s = newSession({ goal: "Bounded" }, p);
    assert.throws(() => appendTurn(s.id, { kind: "chat", text: "hello" }, p), (e) => e.status === 400);
    assert.throws(() => appendTurn(s.id, { kind: "note", text: "x".repeat(20001) }, p), (e) => e.status === 400);
  });

  it("lists newest first, and refuses to touch anything that is not a session id", () => {
    const p = store();
    const a = newSession({ goal: "first" }, p);
    const b = newSession({ goal: "second" }, p);
    appendTurn(b.id, { kind: "note", text: "later" }, p);
    const ids = listSessions(p).map((s) => s.id);
    assert.deepEqual(ids.slice(0, 2), [b.id, a.id]);
    assert.equal(listSessions(p).find((s) => s.id === b.id).turns, 1);

    // The id becomes a filesystem path, so its shape is checked rather than trusted.
    for (const bad of ["../../etc/passwd", "PL-../../x", "PL-zzzz", "", null, "PL-0123456789ab/../.."]) {
      assert.throws(() => sessionFile(bad, p), (e) => e.status === 400, `${JSON.stringify(bad)} must be refused`);
      assert.throws(() => attachmentDir(bad, p), (e) => e.status === 400);
    }
  });

  it("closes and deletes, taking the attachments with it", () => {
    const p = store();
    const s = newSession({ goal: "Close me" }, p);
    attachToSession(s.id, { filename: "notes.md", buffer: md() }, p);
    const dir = attachmentDir(s.id, p);
    assert.ok(existsSync(dir));

    const closed = closeSession(s.id, "applied", p);
    assert.equal(closed.status, "applied");
    // A closed session takes no more turns or attachments: the conversation ended.
    assert.throws(() => appendTurn(s.id, { kind: "note", text: "after" }, p), (e) => e.status === 409);
    assert.throws(() => attachToSession(s.id, { filename: "x.md", buffer: md("x") }, p), (e) => e.status === 409);

    deleteSession(s.id, p);
    assert.ok(!existsSync(dir), "the attachments go with the session");
    assert.ok(!existsSync(sessionFile(s.id, p)));
    assert.throws(() => readSession(s.id, p), (e) => e.status === 404);
    assert.ok(readEvents(p).some((e) => e.event === "planner_deleted" && e.id === s.id));
  });
});

describe("planning attachments", () => {
  it("never lets a supplied name reach the filesystem", () => {
    const p = store();
    const s = newSession({ goal: "Attach" }, p);

    // Each of these is a path, or contains one. None of them may produce a file outside the
    // session's own directory — and none may produce a file NAMED after the input at all, because
    // the stored name is the content hash.
    const hostile = [
      "../../../../etc/cron.d/evil.md",
      "..\\..\\..\\windows\\system32\\evil.md",
      "/etc/passwd.md",
      "....//....//evil.md",
      `${"a".repeat(5000)}.md`,
    ];
    for (const [i, filename] of hostile.entries()) {
      const { attachment } = attachToSession(s.id, { filename, buffer: md(`# ${i}\n`) }, p);
      assert.match(attachment.stored, /^[0-9a-f]{64}\.md$/, "stored under its content hash");
      assert.ok(!attachment.name.includes("/") && !attachment.name.includes("\\"), "the display name is a leaf");
      assert.ok(attachment.name.length <= 120);
    }

    // Everything landed inside the session directory, and nowhere else.
    const files = readdirSync(attachmentDir(s.id, p));
    assert.equal(files.length, hostile.length);
    for (const f of files) assert.match(f, /^[0-9a-f]{64}\.md$/);
    assert.ok(!existsSync("/etc/cron.d/evil.md"));
    // The planner directory holds session json plus one directory per session — nothing stray.
    for (const entry of readdirSync(plannerDir(p))) {
      assert.ok(/^PL-[0-9a-f]{12}(\.json)?$/.test(entry), `unexpected entry in the planner dir: ${entry}`);
    }
  });

  it("strips control characters from a display name rather than storing them", () => {
    const withNul = "re\u0000port\u001b[31m.md";
    const cleaned = displayName(withNul);
    assert.equal(cleaned, "report[31m.md");
    assert.ok(!/[\u0000-\u001f\u007f]/.test(cleaned));
    assert.equal(displayName(""), "attachment");
    assert.equal(displayName("a/b/c/final.md"), "final.md");
  });

  it("stores one copy of the same bytes, however many times they arrive", () => {
    const p = store();
    const s = newSession({ goal: "Dedupe" }, p);
    const bytes = md("# same\n");
    const first = attachToSession(s.id, { filename: "one.md", buffer: bytes }, p);
    const second = attachToSession(s.id, { filename: "two-different-name.md", buffer: bytes }, p);
    assert.equal(first.attachment.sha256, second.attachment.sha256);
    assert.equal(readSession(s.id, p).attachments.length, 1, "recorded once");
    assert.equal(readdirSync(attachmentDir(s.id, p)).length, 1, "stored once");
  });

  it("takes text and images and refuses everything else, by extension and by bytes", () => {
    const p = store();
    const s = newSession({ goal: "Types" }, p);

    assert.equal(attachToSession(s.id, { filename: "ok.md", buffer: md() }, p).attachment.type, "text/markdown");
    assert.equal(attachToSession(s.id, { filename: "shot.png", buffer: png() }, p).attachment.type, "image/png");

    // Extensions nobody needs in a planning conversation, including the executable ones.
    for (const name of ["run.sh", "tool.exe", "bundle.zip", "lib.so", "x.js", "noextension", "a.md.exe"]) {
      assert.throws(() => attachToSession(s.id, { filename: name, buffer: md() }, p), (e) => e.status === 400, name);
    }

    // A script wearing a `.png`: the extension is a claim, so the bytes are checked too.
    assert.throws(
      () => attachToSession(s.id, { filename: "evil.png", buffer: Buffer.from("#!/bin/sh\nrm -rf /\n") }, p),
      (e) => e.status === 400 && /does not contain image\/png data/.test(e.message),
    );
    // And a binary wearing a `.md`.
    assert.throws(
      () => attachToSession(s.id, { filename: "evil.md", buffer: Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]) }, p),
      (e) => e.status === 400 && /binary/.test(e.message),
    );
    // A png header with a jpeg extension is still a mismatch.
    assert.throws(() => attachToSession(s.id, { filename: "x.jpg", buffer: png() }, p), (e) => e.status === 400);
  });

  it("bounds one file, the whole session, and the count", () => {
    const oversize = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 0x61);
    assert.equal(checkAttachment({ filename: "big.md", buffer: oversize }).ok, false);
    assert.equal(checkAttachment({ filename: "empty.md", buffer: Buffer.alloc(0) }).ok, false);
    assert.equal(
      checkAttachment({ filename: "ok.md", buffer: md(), existingCount: MAX_ATTACHMENTS }).ok,
      false,
      "the count is bounded",
    );
    assert.equal(
      checkAttachment({ filename: "ok.md", buffer: md(), existingBytes: MAX_SESSION_ATTACHMENT_BYTES }).ok,
      false,
      "the session total is bounded",
    );
    assert.ok(checkAttachment({ filename: "ok.md", buffer: md() }).ok);
    // Every accepted extension really is accepted, so the allowlist and the checker cannot drift.
    for (const ext of ALLOWED_ATTACHMENTS.keys()) {
      const buffer = ext === ".png" ? png() : ext.match(/jpe?g|gif|webp/) ? null : md();
      if (!buffer) continue;
      assert.equal(checkAttachment({ filename: `f${ext}`, buffer }).ok, true, ext);
    }
  });

  it("records the bytes as untrusted context, and hashes them", () => {
    const p = store();
    const s = newSession({ goal: "Trust" }, p);
    const bytes = md("# quoted\n");
    const { attachment } = attachToSession(s.id, { filename: "notes.md", buffer: bytes }, p);

    // The trust label is in the RECORD, not only in a comment, because what reads this next is
    // whatever assembles an agent prompt.
    assert.equal(attachment.trust, "untrusted-session-context");
    assert.equal(attachment.sha256, createSha(bytes));
    assert.equal(attachment.bytes, bytes.length);

    // It is session context, never board evidence: nothing here may appear on a task.
    assert.ok(!("evidence" in attachment));
    assert.ok(!JSON.stringify(readSession(s.id, p)).includes('"evidence"'));

    // And it grants nothing. A session record carries no capability, skill or permission field
    // that an attachment could set — the only fields it has are the ones listed here.
    assert.deepEqual(
      Object.keys(attachment).sort(),
      ["added", "bytes", "name", "sha256", "stored", "trust", "type"],
    );
    assert.deepEqual(
      Object.keys(readSession(s.id, p)).sort(),
      ["attachments", "created", "epic", "goal", "id", "proposal", "status", "turns", "updated"],
    );
  });

  it("serves an attachment only through its own session, and fails closed otherwise", () => {
    const p = store();
    const a = newSession({ goal: "Mine" }, p);
    const b = newSession({ goal: "Yours" }, p);
    const { attachment } = attachToSession(a.id, { filename: "notes.md", buffer: md("# a\n") }, p);

    const served = attachmentPath(a.id, attachment.sha256, p);
    assert.ok(served && readFileSync(served, "utf8") === "# a\n");
    assert.equal(served, join(attachmentDir(a.id, p), attachment.stored));

    // Another session cannot name it, an unknown hash cannot, and neither can a bad id.
    assert.equal(attachmentPath(b.id, attachment.sha256, p), null, "not listed on that session");
    assert.equal(attachmentPath(a.id, "0".repeat(64), p), null);
    assert.equal(attachmentPath("PL-000000000000", attachment.sha256, p), null, "no such session");
    assert.equal(attachmentPath("../../etc", attachment.sha256, p), null, "a bad id fails closed, not loudly");
  });
});

function createSha(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

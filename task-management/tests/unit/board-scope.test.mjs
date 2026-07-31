/**
 * TM-036 — an entity belongs to the board it was created on.
 *
 * The bug this pins is not hypothetical. `tm` resolves its store from CLAUDE_PROJECT_DIR while a
 * shell sits in whatever checkout it sits in, so a write aimed at one project could land in
 * another's store and look entirely normal afterwards: bytedesk-persona's TM-001 carries 25
 * bytedesk-marketplace pull-request urls, and nothing on either the read or the write path
 * noticed.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { cleanup, tempStore } from "./helpers.mjs";
import { boardIdentity, create, read, storeBoard, write, writeConfig } from "../../lib/store.mjs";
import { addLink, foreignRef } from "../../lib/issue.mjs";
import { boardId, gitBoardId } from "../../lib/paths.mjs";
import { diagnose } from "../../lib/doctor.mjs";
import { boardPayload } from "../../lib/dashboard-api.mjs";

const stores = [];
function store(board = "acme/one") {
  const p = tempStore();
  stores.push(p.root);
  writeConfig({ boardId: board }, p);
  return p;
}
after(() => cleanup(...stores));

describe("board identity", () => {
  it("names a repo by its origin remote, so a clone is the same board", () => {
    const p = tempStore();
    stores.push(p.root);
    execFileSync("git", ["init", "-q", p.root]);
    execFileSync("git", ["-C", p.root, "remote", "add", "origin", "git@github.com:Acme/Widgets.git"]);
    assert.equal(boardId(p.root), "acme/widgets", "the path is per-machine; the remote is not");
  });

  it("falls back to the directory name when there is no remote", () => {
    const p = tempStore();
    stores.push(p.root);
    assert.ok(boardId(p.root), "a project with no remote still needs a name");
  });
});

describe("identity is derived, not declared (TM-041)", () => {
  const withRemote = (url) => {
    const p = tempStore();
    stores.push(p.root);
    execFileSync("git", ["init", "-q", p.root]);
    execFileSync("git", ["-C", p.root, "remote", "add", "origin", url]);
    return p;
  };

  it("reads the identity from git, ignoring whatever the file says", () => {
    const p = withRemote("git@github.com:Acme/Widgets.git");
    writeConfig({ boardId: "someone/else" }, p);

    const identity = boardIdentity(p);
    assert.equal(identity.id, "acme/widgets", "a value anyone can edit cannot be the guard's answer");
    assert.equal(identity.source, "git");
    assert.equal(storeBoard(p), "acme/widgets");
  });

  it("says when the stored copy has drifted from git, rather than re-labelling silently", () => {
    const p = withRemote("git@github.com:Acme/Widgets.git");
    writeConfig({ boardId: "acme/old-name" }, p); // the repo was renamed or moved owners

    const identity = boardIdentity(p);
    assert.equal(identity.drifted, true);
    assert.equal(diagnose(p).some((f) => f.code === "board-renamed"), true, "everything created before the move still carries the old id");
  });

  it("keeps a renamed board's own history writable", () => {
    const p = withRemote("git@github.com:Acme/Widgets.git");
    writeConfig({ boardId: "acme/old-name" }, p);
    // Everything created before the move carries the old id. Refusing those would make a rename
    // brick the board — every existing task unwritable — which is worse than the leak the guard
    // exists to stop. The drift is reported; the history stays writable.
    const t = write({ id: "TM-700", kind: "task", title: "from before the move", board: "acme/old-name", status: "open" }, p);
    assert.ok(t.file);
    assert.equal(read("TM-700", p).title, "from before the move");
    assert.equal(
      diagnose(p).some((f) => f.code === "foreign-entity" && f.id === "TM-700"),
      false,
      "its own history is not somebody else's work",
    );
    assert.throws(() => write({ id: "TM-701", kind: "task", title: "genuinely elsewhere", board: "other/repo", status: "open" }, p));
  });

  it("marks a directory-derived identity as the guess it is", () => {
    const p = tempStore(); // no git, no remote
    stores.push(p.root);
    const identity = boardIdentity(p);
    assert.equal(identity.source, "directory", "two clones in differently-named directories would disagree");
    assert.ok(identity.id);
  });

  it("prefers a recorded identity over a directory guess when git is silent", () => {
    const p = tempStore();
    stores.push(p.root);
    writeConfig({ boardId: "acme/no-remote-here" }, p);
    const identity = boardIdentity(p);
    assert.equal(identity.id, "acme/no-remote-here");
    assert.equal(identity.source, "config", "recorded, not derived — and labelled as such");
  });

  it("separates what git says from the fallback", () => {
    const p = tempStore();
    stores.push(p.root);
    assert.equal(gitBoardId(p.root), null, "no remote means git has no answer");
    assert.ok(boardId(p.root), "the fallback still produces a name");
  });
});

describe("writes stay on their own board", () => {
  it("stamps the board on everything it creates", () => {
    const p = store("acme/one");
    const t = create("task", { title: "mine" }, "", p);
    assert.equal(read(t.id, p).board, "acme/one");
  });

  it("refuses to file an entity from another board", () => {
    const p = store("acme/one");
    const stray = { id: "TM-900", kind: "task", title: "from the other repo", board: "acme/two", status: "open" };

    assert.throws(() => write(stray, p), /belongs to acme\/two.*this store is acme\/one/s);
  });

  it("names the link that would express the relationship honestly", () => {
    const p = store("acme/one");
    assert.throws(
      () => write({ id: "TM-900", kind: "task", title: "x", board: "acme/two", status: "open" }, p),
      /tm link .* relates-to acme\/two#TM-900/,
    );
  });

  it("still accepts an entity written before boards existed", () => {
    const p = store("acme/one");
    // Every store that predates this carries no `board`. Refusing those would break each of them
    // to catch a bug that has already happened.
    const old = write({ id: "TM-901", kind: "task", title: "grandfathered", status: "open" }, p);
    assert.equal(read("TM-901", p).title, "grandfathered");
    assert.ok(old.file);
  });
});

describe("cross-repo references", () => {
  it("reads owner/repo#ID as a reference to another board", () => {
    assert.deepEqual(foreignRef("ByteDeskAI/bytedesk-marketplace#TM-007"), {
      board: "bytedeskai/bytedesk-marketplace",
      id: "TM-007",
    });
    assert.equal(foreignRef("TM-007"), null, "a bare id is not a cross-board reference");
  });

  it("records a link to another board without trying to write that board", () => {
    const p = store("acme/one");
    const t = create("task", { title: "ours" }, "", p);

    addLink(t.id, "relates to", "acme/two#TM-004", p);

    const [link] = read(t.id, p).links;
    assert.deepEqual(link, { type: "relates to", id: "acme/two#TM-004", board: "acme/two" });
  });

  it("refuses a bare id that does not exist here, rather than inventing it", () => {
    const p = store("acme/one");
    const t = create("task", { title: "ours" }, "", p);
    assert.throws(() => addLink(t.id, "relates to", "TM-404", p));
  });
});

describe("the board renders only its own work", () => {
  it("leaves out an entity filed here from another board", () => {
    const p = store("acme/one");
    const mine = create("task", { title: "ours" }, "", p);
    const stray = create("task", { title: "theirs" }, "", p);
    const file = read(stray.id, p).file;
    writeFileSync(file, readFileSync(file, "utf8").replace('board: "acme/one"', 'board: "acme/two"'));

    const ids = boardPayload(p).tasks.map((t) => t.id);
    assert.deepEqual(ids, [mine.id], "one project's board must not be quietly wrong about another's");
  });

  it("still shows work written before boards existed", () => {
    const p = store("acme/one");
    write({ id: "TM-800", kind: "task", title: "grandfathered", status: "open" }, p);
    assert.ok(boardPayload(p).tasks.some((t) => t.id === "TM-800"));
  });
});

describe("doctor", () => {
  it("finds a stray already filed on the wrong board", () => {
    const p = store("acme/one");
    const t = create("task", { title: "stray" }, "", p);
    // Written by hand, the way the old code would have written it.
    const file = read(t.id, p).file;
    writeFileSync(file, readFileSync(file, "utf8").replace('board: "acme/one"', 'board: "acme/two"'));

    const f = diagnose(p).find((x) => x.code === "foreign-entity");
    assert.ok(f, "a store carrying someone else's work has to be able to find it");
    assert.equal(f.level, "error");
    assert.match(f.message, /acme\/two/);
  });
});

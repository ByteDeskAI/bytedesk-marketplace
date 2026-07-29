/**
 * The board as MCP resources.
 *
 * Almost every way this feature breaks is SILENT — the client shows an empty picker or a
 * blank mention and no error appears anywhere, so it looks like it works. Those are the
 * cases this file exists for:
 *
 *   - `initialize` not declaring the `resources` capability → resources/list never called
 *   - returning `content` (the tools/call key) instead of `contents` → success, no content
 *   - a content entry missing its own `uri`, or echoing a normalised one → dropped
 *   - -32601 for an unknown resource → client concludes the server has no resources at all
 *   - resources/list throwing → retried, then abandoned for the session
 *   - a duplicate uri → the picker collapses them, one becomes unreachable
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, tempStore } from "./helpers.mjs";
import { create, update, writeState } from "../../lib/store.mjs";
import { HANDOFF, MAX_CHARS, SCHEME, listResources, readResource } from "../../lib/resources.mjs";
import { handleRequest } from "../../lib/mcp.mjs";

const stores = [];
function store() {
  const p = tempStore();
  stores.push(p.root);
  return p;
}
after(() => cleanup(...stores));

const req = (method, params, p) => handleRequest({ jsonrpc: "2.0", id: 1, method, params }, { p });
const uris = (p) => listResources(p).map((r) => r.uri);

function seeded() {
  const p = store();
  const epic = create("epic", { title: "Ship it" }, "", p);
  writeState({ activeEpic: epic.id }, p);
  const blocker = create("task", { title: "the blocker", blocks: [] }, "", p);
  const blocked = create("task", { title: "the blocked one", blockedBy: [blocker.id] }, "", p);
  update(blocked.id, { status: "blocked" }, p);
  update(blocker.id, { blocks: [blocked.id], status: "parked", parkedReason: "waiting on counsel" }, p);
  create("adr", { title: "markdown is the source of truth", status: "accepted", date: "2026-07-29" }, "## Context\n\nBecause git.", p);
  return { p, epic: epic.id, blocker: blocker.id, blocked: blocked.id };
}

describe("the capability declaration", () => {
  it("declares resources, or the client never asks for them", () => {
    const res = req("initialize", {}, store());
    // THE silent failure: implement list and read, leave capabilities empty, and Claude Code
    // never calls resources/list. `@` shows nothing and nothing is logged anywhere.
    assert.deepEqual(res.result.capabilities.resources, {}, "must be an object; `true` is not the schema");
  });

  it("declares tools too, which was missing entirely", () => {
    const res = req("initialize", {}, store());
    assert.deepEqual(res.result.capabilities.tools, {});
  });

  it("declares neither subscribe nor listChanged, because neither is implemented", () => {
    const { resources } = req("initialize", {}, store()).result.capabilities;
    assert.equal("subscribe" in resources, false, "promising subscribe means resources/subscribe must answer");
    assert.equal("listChanged" in resources, false);
  });
});

describe("resources/list", () => {
  it("offers the standing views", () => {
    const { p } = seeded();
    for (const uri of ["board", "session", "blocked", "graph", "standup"].map((n) => `${SCHEME}${n}`)) {
      assert.ok(uris(p).includes(uri), `${uri} missing`);
    }
  });

  it("offers only computed views, never an alias for a file on disk", () => {
    // A task, epic or ADR is a markdown file that Read and @ already reach. A resource that
    // is a URI for a file path competes with the real file in the picker and adds nothing.
    const { p } = seeded();
    const aliases = uris(p).filter((u) => /^tm:\/\/(task|epic|adr|plan)\b/.test(u));
    assert.deepEqual(aliases, []);
  });

  it("does not offer a third view of the rows board and session already carry", () => {
    const { p } = seeded();
    assert.ok(!uris(p).includes(`${SCHEME}next`), "tm_next plus board plus session is enough");
  });

  it("carries exactly the four fields protocol 2024-11-05 defines", () => {
    const { p } = seeded();
    for (const r of listResources(p)) {
      assert.deepEqual(Object.keys(r).sort(), ["description", "mimeType", "name", "uri"]);
      assert.ok(r.description.length > 10, `${r.uri} needs a description a user can choose from`);
    }
  });

  it("keeps ids in the path, never the authority", () => {
    const { p, blocked } = seeded();
    void blocked;
    // RFC 3986 lowercases the authority during normalisation, so `tm://TM-001` becomes
    // `tm://tm-001` and the read lookup misses.
    assert.ok(!uris(p).some((u) => /^tm:\/\/TM-\d/.test(u)), "an id in the authority gets case-folded away");
    assert.ok(uris(p).every((u) => u.startsWith(SCHEME)));
  });

  it("emits no duplicate uri, which would make one resource unreachable", () => {
    const { p } = seeded();
    const all = uris(p);
    assert.equal(new Set(all).size, all.length);
  });

  it("enumerates work in flight and startable work, not finished work", () => {
    const { p } = seeded();
    const running = create("task", { title: "being worked on" }, "", p);
    update(running.id, { status: "in_progress" }, p);
    const shipped = create("task", { title: "already shipped" }, "", p);
    update(shipped.id, { status: "done" }, p);

    assert.ok(uris(p).includes(`${HANDOFF}${running.id}`));
    assert.ok(!uris(p).includes(`${HANDOFF}${shipped.id}`), "a closed task is not what you pull into context");
  });

  it("caps enumeration so the picker stays usable", () => {
    const p = store();
    for (let i = 0; i < 40; i += 1) create("task", { title: `distinct subject number ${i}` }, "", p);

    assert.ok(uris(p).filter((u) => u.startsWith(HANDOFF)).length <= 20);
  });

  it("returns an empty list rather than throwing when there is no store", () => {
    // A throw on a discovery call is retried and then abandoned for the session, taking
    // every resource with it.
    const res = handleRequest({ jsonrpc: "2.0", id: 1, method: "resources/list" }, { p: { root: null, base: null } });
    assert.deepEqual(res.result, { resources: [] });
    assert.equal(res.error, undefined);
  });
});

describe("resources/read", () => {
  it("returns `contents` — plural — because `content` is the tools/call key", () => {
    const { p } = seeded();
    const res = req("resources/read", { uri: `${SCHEME}board` }, p);

    assert.ok(Array.isArray(res.result.contents), "the wrong key is a well-formed success carrying nothing");
    assert.equal("content" in res.result, false);
  });

  it("echoes the requested uri verbatim in the entry", () => {
    const { p } = seeded();
    const res = req("resources/read", { uri: `${SCHEME}board` }, p);
    // A client that pairs content blocks back to its request drops anything it cannot match.
    assert.equal(res.result.contents[0].uri, `${SCHEME}board`);
    assert.equal(typeof res.result.contents[0].text, "string");
    assert.equal(res.result.contents[0].mimeType, "text/markdown");
  });

  it("renders the board from the same function the CLI uses", () => {
    const { p } = seeded();
    const text = readResource(`${SCHEME}board`, p).contents[0].text;
    assert.match(text, /# Board/);
    assert.match(text, /the blocked one/);
  });

  it("renders a task's handoff brief", () => {
    const { p, blocked } = seeded();
    const text = readResource(`${HANDOFF}${blocked}`, p).contents[0].text;
    assert.match(text, /# Handoff/);
    assert.match(text, new RegExp(blocked));
  });

  it("walks the blocked report to the root of each chain", () => {
    const { p, blocker } = seeded();
    const text = readResource(`${SCHEME}blocked`, p).contents[0].text;
    // The point of this resource over a bare list: it names what to actually go and do.
    assert.match(text, /startable: no/);
    assert.match(text, new RegExp(blocker));
    assert.match(text, /waiting on counsel/);
  });

  it("says so plainly when nothing is blocked", () => {
    const p = store();
    create("task", { title: "all fine" }, "", p);
    assert.match(readResource(`${SCHEME}blocked`, p).contents[0].text, /Nothing is blocked/);
  });

  it("fences the graph so it renders as Mermaid", () => {
    const { p } = seeded();
    assert.match(readResource(`${SCHEME}graph`, p).contents[0].text, /^```mermaid/);
  });

  it("reads a handoff that was never listed — the picker is bounded, the capability is not", () => {
    const { p, blocker } = seeded();
    // blocker is parked, so it gets no listed row.
    assert.ok(!uris(p).includes(`${HANDOFF}${blocker}`));
    assert.match(readResource(`${HANDOFF}${blocker}`, p).contents[0].text, /# Handoff/);
  });

  it("renders the session brief, the one view compaction destroys and no tool rebuilds", () => {
    const { p } = seeded();
    assert.match(readResource(`${SCHEME}session`, p).contents[0].text, /task-management/);
  });

  it("says something rather than nothing when the store is empty", () => {
    // sessionContext() returns "" with no open tasks and no active epic; an empty resource
    // reads as a broken one.
    const text = readResource(`${SCHEME}session`, store()).contents[0].text;
    assert.ok(text.length > 20);
  });

  it("truncates loudly rather than dropping an unbounded payload into context", () => {
    const p = store();
    create("task", { title: "a big one" }, "x".repeat(MAX_CHARS + 5000), p);
    const text = readResource(`${SCHEME}board`, p).contents[0].text;
    void text;
    const brief = readResource(`${HANDOFF}TM-001`, p).contents[0].text;
    assert.ok(brief.length <= MAX_CHARS + 200);
    assert.match(brief, /truncated at/);
  });

  it("answers -32002 for an unknown resource, not -32601", () => {
    const { p } = seeded();
    const res = req("resources/read", { uri: `${HANDOFF}TM-999` }, p);

    // -32601 means the METHOD is missing; a client can read it as "no resources here" and
    // stop asking, losing the whole surface over one bad id.
    assert.equal(res.error.code, -32002);
    assert.equal(res.error.message, "Resource not found");
    assert.equal(res.error.data.uri, `${HANDOFF}TM-999`);
    assert.equal(res.result, undefined, "an error must not also carry a result");
  });

  it("answers -32002 for a uri in another scheme", () => {
    const { p } = seeded();
    assert.equal(req("resources/read", { uri: "file:///etc/passwd" }, p).error.code, -32002);
  });

  it("answers -32002 for a missing uri parameter", () => {
    const { p } = seeded();
    assert.equal(req("resources/read", {}, p).error.code, -32002);
  });

  it("returns null from readResource for an unknown uri rather than inventing a success", () => {
    const { p } = seeded();
    assert.equal(readResource(`${SCHEME}nope`, p), null);
  });

  it("every listed resource is readable — a listing you cannot read is worse than no listing", () => {
    const { p, epic } = seeded();
    mkdirSync(p.plans, { recursive: true });
    writeFileSync(join(p.plans, "plan.md"), "# Plan\n");
    update(epic, { plan: ".bytedesk/task-management/plans/plan.md" }, p);

    for (const r of listResources(p)) {
      const got = readResource(r.uri, p);
      assert.ok(got, `${r.uri} is listed but not readable`);
      assert.ok(got.contents[0].text.length > 0, `${r.uri} reads as empty`);
    }
  });
});

describe("the method still behaves like the rest of the protocol", () => {
  it("keeps handleRequest pure — no process, no stdout", () => {
    const { p } = seeded();
    const a = req("resources/list", {}, p);
    const b = req("resources/list", {}, p);
    assert.deepEqual(a, b, "same request in, same response out");
  });

  it("leaves genuinely unknown methods as -32601", () => {
    assert.equal(req("completion/complete", {}, store()).error.code, -32601);
  });
});
